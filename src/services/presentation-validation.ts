import type { Presentation } from "../schemas/presentation.schema.js";
import type { Script } from "../schemas/script.schema.js";

export function validatePresentationAgainstScript(
  presentation: Presentation,
  script: Script,
  preserveSlideIds = false,
): void {
  if (presentation.title !== script.title) {
    throw new Error("O título da apresentação difere do roteiro aprovado.");
  }
  if (presentation.slides.length !== script.plannedSlides.length) {
    throw new Error("A quantidade de slides difere do roteiro aprovado.");
  }
  presentation.slides.forEach((slide, index) => {
    const planned = script.plannedSlides[index];
    if (slide.layout !== planned.layout || slide.title !== planned.title ||
        (preserveSlideIds && slide.id !== planned.id)) {
      throw new Error(`O slide ${index + 1} difere da ordem, identidade ou layout do roteiro aprovado. Revise a resposta.`);
    }
  });
}
