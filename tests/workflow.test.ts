import { describe, expect, it } from "vitest";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { presentationSchema } from "../src/schemas/presentation.schema.js";
import { briefingSchema } from "../src/schemas/briefing.schema.js";
import {
  approveScript,
  generatePresentation,
  generateScript,
} from "../src/services/generation.service.js";

describe("simulated generation workflow", () => {
  it("accepts a valid briefing", () => {
    expect(briefingSchema.safeParse(briefingMock).success).toBe(true);
  });

  it("rejects an invalid briefing", () => {
    expect(
      briefingSchema.safeParse({ ...briefingMock, slideCount: 0 }).success,
    ).toBe(false);
    expect(
      briefingSchema.safeParse({ ...briefingMock, prompt: " " }).success,
    ).toBe(false);
  });

  it("generates a deterministic draft script with the six layouts", () => {
    const script = generateScript(briefingMock);

    expect(script.status).toBe("draft");
    expect(script.revision).toBe(1);
    expect(script.plannedSlides).toHaveLength(6);
    expect(script.plannedSlides.map((slide) => slide.layout)).toEqual([
      "cover",
      "text_image",
      "two_columns",
      "metrics",
      "case",
      "closing",
    ]);
    expect(script.plannedSlides[0].keyPoints).toContain(
      `Pedido: ${briefingMock.prompt}`,
    );
    expect(script.plannedSlides[0].keyPoints).toContain(
      `Público: ${briefingMock.audience}; tom: ${briefingMock.tone}; idioma: ${briefingMock.language}`,
    );
    expect(generateScript(briefingMock)).toEqual(script);
  });

  it("blocks presentation generation for a draft script", () => {
    const draft = generateScript(briefingMock);

    expect(() => generatePresentation(draft)).toThrow(
      "ainda não foi aprovado",
    );
  });

  it("approves the script explicitly", () => {
    const draft = generateScript(briefingMock);
    const approved = approveScript(draft);

    expect(approved.status).toBe("approved");
    expect(draft.status).toBe("draft");
  });

  it("generates a presentation that passes the existing schema", () => {
    const approved = approveScript(generateScript(briefingMock));
    const presentation = generatePresentation(approved);

    expect(presentationSchema.safeParse(presentation).success).toBe(true);
    expect(presentation.slides).toHaveLength(briefingMock.slideCount);
    expect(presentation.slides.map((slide) => slide.layout)).toEqual([
      "cover",
      "text_image",
      "two_columns",
      "metrics",
      "case",
      "closing",
    ]);
  });
});
