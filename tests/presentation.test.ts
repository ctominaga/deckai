import { describe, expect, it } from "vitest";
import { presentationMock } from "../src/mocks/presentation.mock.js";
import { presentationSchema } from "../src/schemas/presentation.schema.js";

describe("presentationSchema", () => {
  it("accepts the complete demonstration presentation", () => {
    expect(() => presentationSchema.parse(presentationMock)).not.toThrow();
  });

  it("contains exactly six slides", () => {
    expect(presentationMock.slides).toHaveLength(6);
  });

  it("represents all six supported layouts", () => {
    expect(new Set(presentationMock.slides.map((slide) => slide.layout))).toEqual(
      new Set([
        "cover",
        "text_image",
        "two_columns",
        "metrics",
        "case",
        "closing",
      ]),
    );
  });

  it("rejects unknown layouts", () => {
    const invalidPresentation = {
      ...presentationMock,
      slides: [{ ...presentationMock.slides[0], layout: "unknown" }],
    };

    expect(presentationSchema.safeParse(invalidPresentation).success).toBe(
      false,
    );
  });

  it("rejects missing required fields", () => {
    const { title: _title, ...slideWithoutTitle } = presentationMock.slides[0];
    const invalidPresentation = {
      ...presentationMock,
      slides: [slideWithoutTitle],
    };

    expect(presentationSchema.safeParse(invalidPresentation).success).toBe(
      false,
    );
  });

  it("rejects duplicate IDs", () => {
    const [firstSlide, secondSlide, ...remainingSlides] =
      presentationMock.slides;
    const invalidPresentation = {
      ...presentationMock,
      slides: [
        firstSlide,
        { ...secondSlide, id: firstSlide.id },
        ...remainingSlides,
      ],
    };

    expect(presentationSchema.safeParse(invalidPresentation).success).toBe(
      false,
    );
  });
});
