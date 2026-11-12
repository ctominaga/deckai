import { briefingSchema, type Briefing } from "../schemas/briefing.schema.js";
import { presentationSchema, slideSchema, type Presentation, type Slide } from "../schemas/presentation.schema.js";
import { scriptSchema, type Script, type PlannedSlide } from "../schemas/script.schema.js";
import { regenerationRequestSchema, type RegenerationRequest } from "../schemas/slide-regeneration.schema.js";
import { GenerationFailure } from "./generation-diagnostics.js";
import { validatePresentationAgainstScript } from "./presentation-validation.js";

export interface SlideRegenerationInput {
  presentationId: string;
  revision: number;
  slideId: string;
  briefing: Briefing;
  approvedScript: { id: string; revision: number; title: string };
  approvedSlide: PlannedSlide;
  currentSlide: Slide;
  references: Presentation["references"];
  instruction: string;
  provider: RegenerationRequest["provider"];
  classification: "DEMONSTRATION";
}
export interface AiSlideRegenerationProvider {
  regenerateSlide(input: SlideRegenerationInput): Promise<unknown>;
}

export function prepareSlideRegeneration(presentation: Presentation, revision: number, script: Script,
  briefing: Briefing, request: RegenerationRequest): SlideRegenerationInput {
  const valid = regenerationRequestSchema.parse(request);
  const source = presentationSchema.parse(presentation);
  const approved = scriptSchema.parse(script);
  if (valid.revision !== revision) throw new Error("A revisão da apresentação mudou.");
  if (approved.status !== "approved") throw new Error("A regeneração exige o roteiro aprovado correspondente.");
  validatePresentationAgainstScript(source, approved);
  const index = source.slides.findIndex(slide => slide.id === valid.slideId);
  if (index < 0) throw new Error("O slide selecionado não existe na apresentação atual.");
  const currentSlide = source.slides[index];
  const input: SlideRegenerationInput = {
    presentationId: source.id, revision, slideId: currentSlide.id,
    briefing: briefingSchema.parse(briefing),
    approvedScript: { id: approved.id, revision: approved.revision, title: approved.title },
    approvedSlide: approved.plannedSlides[index], currentSlide,
    references: source.references.filter(ref => currentSlide.referenceIds.includes(ref.id)),
    instruction: valid.instruction, provider: valid.provider, classification: "DEMONSTRATION",
  };
  if (JSON.stringify(input).length > 24000) throw new Error("O contexto do slide excede o limite de 24.000 caracteres.");
  return input;
}

export function validateRegeneratedSlide(response: unknown, input: SlideRegenerationInput): Slide {
  const result = slideSchema.safeParse(response);
  if (!result.success) throw invalidSlide("A resposta deve conter somente um slide válido para o layout aprovado.");
  const slide = result.data;
  if (slide.id !== input.slideId || slide.title !== input.approvedSlide.title || slide.layout !== input.approvedSlide.layout ||
      JSON.stringify(slide.referenceIds) !== JSON.stringify(input.currentSlide.referenceIds) ||
      ("imageId" in slide && (!("imageId" in input.currentSlide) || slide.imageId !== input.currentSlide.imageId))) {
    throw invalidSlide("O slide diverge do ID, título, layout, referências ou imagem original permitidos.");
  }
  // Application-owned labels cannot be removed by model output or user instructions.
  const label = (text: string) => /demonstra[çc][ãa]o fict[íi]cia/i.test(text) ? text : `Demonstração fictícia — ${text}`;
  switch (slide.layout) {
    case "cover": slide.subtitle = label(slide.subtitle); break;
    case "text_image": slide.body = label(slide.body); break;
    case "two_columns": slide.left.body = label(slide.left.body); slide.right.body = label(slide.right.body); break;
    case "metrics": slide.metrics.forEach(metric => { metric.context = label(metric.context); }); break;
    case "case": slide.organization = label(slide.organization); slide.result = label(slide.result); break;
    case "closing": slide.message = label(slide.message); break;
  }
  return slideSchema.parse(slide);
}

export async function suggestSlideRegeneration(provider: AiSlideRegenerationProvider, input: SlideRegenerationInput): Promise<Slide> {
  return validateRegeneratedSlide(await provider.regenerateSlide(structuredClone(input)), input);
}

export function applyRegeneratedSlide(presentation: Presentation, script: Script, input: SlideRegenerationInput, suggestion: Slide): Presentation {
  if (presentation.id !== input.presentationId || JSON.stringify(presentation.slides.find(s => s.id === input.slideId)) !== JSON.stringify(input.currentSlide)) {
    throw new Error("A apresentação mudou. Solicite uma nova versão.");
  }
  const slide = validateRegeneratedSlide(suggestion, input);
  const updated = { ...presentation, slides: presentation.slides.map(original => original.id === input.slideId ? slide : original) };
  presentationSchema.parse(updated);
  validatePresentationAgainstScript(updated, script);
  return updated;
}

function invalidSlide(message: string) {
  return new GenerationFailure(message, { stage: "regeneration.zod", origin: "local", category: "fidelity", code: "INVALID_SLIDE" });
}
