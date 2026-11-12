import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const briefingSchema = z
  .object({
    prompt: nonEmptyString,
    objective: nonEmptyString,
    audience: nonEmptyString,
    tone: nonEmptyString,
    language: nonEmptyString,
    slideCount: z.number().int().min(1).max(12),
  })
  .strict();

export type Briefing = z.infer<typeof briefingSchema>;
