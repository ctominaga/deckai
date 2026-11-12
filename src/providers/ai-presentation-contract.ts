import { z } from "zod";
import { slideSchema, presentationSchema, type Presentation } from "../schemas/presentation.schema.js";
import type { Script } from "../schemas/script.schema.js";
import { validatePresentationAgainstScript } from "../services/presentation-validation.js";

export function presentationContentSchema(slideCount: number) {
  return z.object({ slides: z.array(slideSchema).length(slideCount) }).strict();
}

export function presentationMetadata(script: Script, provider: "gemini" | "deepseek" = "gemini") {
  const id = `${provider}-${script.id}-r${script.revision}`;
  return {
    schemaVersion: "1.0.0" as const, id, title: script.title, aspectRatio: "16:9" as const,
    references: [{ id: `${id}-ref-demonstration`,
      label: "Demonstração fictícia gerada por IA; não representa fatos, clientes ou resultados reais da Jump. Sem fontes externas verificadas.",
      type: "demonstration" as const }],
  };
}

export function enforceGeneratedContent(presentation: Presentation, script: Script, referenceId: string, provider: string): Presentation {
  validatePresentationAgainstScript(presentation, script, true);
  for (const slide of presentation.slides) {
    if (slide.referenceIds.length !== 1 || slide.referenceIds[0] !== referenceId) {
      throw new Error(`O ${provider} deve utilizar somente a referência de demonstração fornecida, sem inventar fontes.`);
    }
    if ((slide.layout === "cover" || slide.layout === "text_image") && slide.imageId !== `placeholder-${slide.id}`) {
      throw new Error(`O ${provider} deve utilizar somente o placeholder visual fornecido.`);
    }
    if (slide.layout === "metrics") slide.metrics.forEach(metric => { metric.context = `Demonstração fictícia — ${metric.context}`; });
    if (slide.layout === "case") {
      slide.organization = `Demonstração fictícia — ${slide.organization}`;
      slide.result = `Demonstração fictícia — ${slide.result}`;
    }
  }
  return presentationSchema.parse(presentation);
}
