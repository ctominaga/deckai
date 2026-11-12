import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const slideBase = {
  id: nonEmptyString,
  title: nonEmptyString,
  referenceIds: z.array(nonEmptyString),
};

const coverSlideSchema = z
  .object({
    ...slideBase,
    layout: z.literal("cover"),
    subtitle: nonEmptyString,
    imageId: nonEmptyString,
  })
  .strict();

const textImageSlideSchema = z
  .object({
    ...slideBase,
    layout: z.literal("text_image"),
    body: nonEmptyString,
    imageId: nonEmptyString,
  })
  .strict();

const twoColumnsSlideSchema = z
  .object({
    ...slideBase,
    layout: z.literal("two_columns"),
    left: z.object({ heading: nonEmptyString, body: nonEmptyString }).strict(),
    right: z.object({ heading: nonEmptyString, body: nonEmptyString }).strict(),
  })
  .strict();

const metricsSlideSchema = z
  .object({
    ...slideBase,
    layout: z.literal("metrics"),
    dataClassification: z.literal("DEMONSTRATION"),
    metrics: z
      .array(
        z
          .object({
            label: nonEmptyString,
            value: nonEmptyString,
            context: nonEmptyString,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const caseSlideSchema = z
  .object({
    ...slideBase,
    layout: z.literal("case"),
    dataClassification: z.literal("DEMONSTRATION"),
    organization: nonEmptyString,
    challenge: nonEmptyString,
    approach: nonEmptyString,
    result: nonEmptyString,
  })
  .strict();

const closingSlideSchema = z
  .object({
    ...slideBase,
    layout: z.literal("closing"),
    message: nonEmptyString,
    callToAction: nonEmptyString,
  })
  .strict();

export const slideSchema = z.discriminatedUnion("layout", [
  coverSlideSchema,
  textImageSlideSchema,
  twoColumnsSlideSchema,
  metricsSlideSchema,
  caseSlideSchema,
  closingSlideSchema,
]);

const referenceSchema = z
  .object({
    id: nonEmptyString,
    label: nonEmptyString,
    type: z.literal("demonstration"),
  })
  .strict();

export const presentationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    id: nonEmptyString,
    title: nonEmptyString,
    aspectRatio: z.enum(["16:9", "4:3"]),
    slides: z.array(slideSchema).min(1),
    references: z.array(referenceSchema),
  })
  .strict()
  .superRefine((presentation, context) => {
    const ids = [
      presentation.id,
      ...presentation.slides.map((slide) => slide.id),
      ...presentation.references.map((reference) => reference.id),
    ];
    const seen = new Set<string>();

    ids.forEach((id, index) => {
      if (seen.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ID duplicado: ${id}`,
          path:
            index <= presentation.slides.length
              ? ["slides", index - 1, "id"]
              : ["references", index - presentation.slides.length - 1, "id"],
        });
      }
      seen.add(id);
    });

    const referenceIds = new Set(
      presentation.references.map((reference) => reference.id),
    );
    presentation.slides.forEach((slide, slideIndex) => {
      slide.referenceIds.forEach((referenceId, referenceIndex) => {
        if (!referenceIds.has(referenceId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Referência não encontrada: ${referenceId}`,
            path: ["slides", slideIndex, "referenceIds", referenceIndex],
          });
        }
      });
    });
  });

export type Presentation = z.infer<typeof presentationSchema>;
export type Slide = z.infer<typeof slideSchema>;
