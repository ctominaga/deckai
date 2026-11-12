import type { Briefing } from "../schemas/briefing.schema.js";
import type { Script } from "../schemas/script.schema.js";
import type { AiRewriteProvider } from "../services/rewrite.service.js";
import type { AiSlideRegenerationProvider } from "../services/slide-regeneration.service.js";

export interface AiScriptGenerationProvider {
  generateScriptProposal(briefing: Briefing): Promise<unknown>;
}

export interface AiGenerationProvider extends AiScriptGenerationProvider, Partial<AiRewriteProvider>, Partial<AiSlideRegenerationProvider> {
  generatePresentation(approvedScript: Script, briefing?: Briefing): Promise<unknown>;
}
