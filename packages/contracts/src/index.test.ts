import { describe, expect, it } from "vitest";
import { PresentationContentSchema, initialPresentationContent } from "./index.js";

describe("contrato canônico", () => {
  it("rejeita IDs duplicados e propriedades desconhecidas", () => {
    const content = initialPresentationContent(crypto.randomUUID());
    content.slides.push(structuredClone(content.slides[0]!));
    expect(PresentationContentSchema.safeParse(content).success).toBe(false);
    const valid = initialPresentationContent(crypto.randomUUID()) as unknown as Record<string, unknown>;
    valid.campoDesconhecido = true;
    expect(PresentationContentSchema.safeParse(valid).success).toBe(false);
  });
});
