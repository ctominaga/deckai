import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const plannedSlideSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    objective: nonEmptyString,
    layout: z.enum([
      "cover",
      "text_image",
      "two_columns",
      "metrics",
      "case",
      "closing",
    ]),
    keyPoints: z.array(nonEmptyString).min(1),
  })
  .strict();

export const scriptSchema = z
  .object({
    id: nonEmptyString,
    title: nonEmptyString,
    status: z.enum(["draft", "approved"]),
    revision: z.number().int().min(1),
    plannedSlides: z.array(plannedSlideSchema).min(1),
  })
  .strict();

export const scriptEditRequestSchema = z
  .object({
    revision: z.number().int().min(1),
    title: nonEmptyString,
    plannedSlides: z.array(plannedSlideSchema).min(1),
  })
  .strict();

export type Script = z.infer<typeof scriptSchema>;
export type PlannedSlide = z.infer<typeof plannedSlideSchema>;
