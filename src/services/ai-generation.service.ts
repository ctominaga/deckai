import { z } from "zod";
import { briefingSchema } from "../schemas/briefing.schema.js";
import type { Briefing } from "../schemas/briefing.schema.js";
import { presentationSchema } from "../schemas/presentation.schema.js";
import type { Presentation } from "../schemas/presentation.schema.js";
import { scriptSchema } from "../schemas/script.schema.js";
import type { Script } from "../schemas/script.schema.js";
import type {
  AiGenerationProvider,
  AiScriptGenerationProvider,
} from "../providers/ai-generation-provider.js";
import { approveScript as approveValidatedScript } from "./generation.service.js";
import { validatePresentationAgainstScript } from "./presentation-validation.js";

export class AiOutlineGenerationService {
  constructor(private readonly provider: AiScriptGenerationProvider) {}

  async generateScriptProposal(briefing: unknown): Promise<Script> {
    const validatedBriefing = briefingSchema.parse(briefing);
    const providerResponse =
      await this.provider.generateScriptProposal(validatedBriefing);
    const script = parseProviderResponse(
      scriptSchema,
      providerResponse,
      "roteiro",
    );

    if (script.status !== "draft") {
      throw new Error(
        "O provedor deve retornar o roteiro como rascunho; a aprovação precisa ser explícita.",
      );
    }

    return script;
  }

  approveScript(script: unknown): Script {
    return approveValidatedScript(scriptSchema.parse(script));
  }
}

export class AiGenerationService extends AiOutlineGenerationService {
  constructor(private readonly fullProvider: AiGenerationProvider) {
    super(fullProvider);
  }

  async generatePresentation(script: unknown, briefing?: Briefing): Promise<Presentation> {
    const validatedScript = scriptSchema.parse(script);
    if (validatedScript.status !== "approved") {
      throw new Error(
        `O roteiro "${validatedScript.id}" ainda não foi aprovado. Aprove o roteiro antes de gerar a apresentação.`,
      );
    }

    const providerResponse =
      await this.fullProvider.generatePresentation(
        validatedScript,
        briefing === undefined ? undefined : briefingSchema.parse(briefing),
      );
    const presentation = parseProviderResponse(
      presentationSchema,
      providerResponse,
      "apresentação",
    );
    validatePresentationAgainstScript(presentation, validatedScript);
    return presentation;
  }
}

function parseProviderResponse<Output>(
  schema: z.ZodType<Output>,
  response: unknown,
  outputName: string,
): Output {
  const result = schema.safeParse(response);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "resposta";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Resposta inválida do provedor para ${outputName}: ${details}`);
  }

  return result.data;
}
