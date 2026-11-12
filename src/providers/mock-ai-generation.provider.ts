import type { AiGenerationProvider } from "./ai-generation-provider.js";
import {
  generatePresentation,
  generateScript,
} from "../services/generation.service.js";
import type { Briefing } from "../schemas/briefing.schema.js";
import type { Script } from "../schemas/script.schema.js";
import type { RewriteInput } from "../services/rewrite.service.js";
import type { SlideRegenerationInput } from "../services/slide-regeneration.service.js";

export class MockAiGenerationProvider implements AiGenerationProvider {
  async regenerateSlide(input: SlideRegenerationInput): Promise<unknown> {
    const slide = structuredClone(input.currentSlide);
    const text = `Nova versão demonstrativa: ${input.approvedSlide.objective} ${input.approvedSlide.keyPoints.join(". ")}`;
    switch (slide.layout) {
      case "cover": slide.subtitle = text; break;
      case "text_image": slide.body = text; break;
      case "two_columns": slide.left.body = text; slide.right.body = `Demonstração fictícia: ${input.approvedSlide.keyPoints.join(". ")}`; break;
      case "metrics": slide.metrics = slide.metrics.map(metric => ({ ...metric, context: text })); break;
      case "case": slide.approach = text; break;
      case "closing": slide.message = text; break;
    }
    return slide;
  }
  async suggestRewrite(input: RewriteInput): Promise<unknown> {
    const text = input.original;
    switch (input.operation) {
      case "summarize": return { text: text.split(/\s+/).slice(0, Math.max(1, Math.ceil(text.split(/\s+/).length / 2))).join(" ") };
      case "expand": return { text: `${text} — contexto ilustrativo para o público.` };
      case "tone": return { text: `[${input.tone}] ${text}` };
      case "custom": return { text: `Versão revisada: ${text}` };
    }
  }
  async generateScriptProposal(briefing: Briefing): Promise<unknown> {
    return generateScript(briefing);
  }

  async generatePresentation(approvedScript: Script): Promise<unknown> {
    return generatePresentation(approvedScript);
  }
}
