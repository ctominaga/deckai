import { z } from "zod";

export const rewriteLimits = { scriptTitle: 200, title: 200, objective: 2000, keyPoint: 1000 } as const;
export const rewriteTargetSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("scriptTitle") }).strict(),
  z.object({ field: z.enum(["title", "objective"]), slideId: z.string().min(1).max(200) }).strict(),
  z.object({ field: z.literal("keyPoint"), slideId: z.string().min(1).max(200), topicIndex: z.number().int().min(0).max(100) }).strict(),
]);
export const rewriteRequestSchema = z.object({
  revision: z.number().int().positive(),
  target: rewriteTargetSchema,
  operation: z.enum(["summarize", "expand", "tone", "custom"]),
  instruction: z.string().trim().max(1000).default(""),
  tone: z.string().trim().max(100).default(""),
}).strict().superRefine((value, ctx) => {
  if (value.operation === "custom" && !value.instruction) ctx.addIssue({ code: "custom", path: ["instruction"], message: "Informe a instrução personalizada." });
  if (value.operation === "tone" && !value.tone) ctx.addIssue({ code: "custom", path: ["tone"], message: "Informe o tom desejado." });
});
export const suggestionActionSchema = z.object({ suggestionId: z.string().uuid() }).strict();
export type RewriteTarget = z.infer<typeof rewriteTargetSchema>;
export type RewriteRequest = z.infer<typeof rewriteRequestSchema>;

export function rewriteTextSchema(target: RewriteTarget) {
  return z.string().trim().min(1).max(rewriteLimits[target.field])
    .refine(text => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text), "Texto contém caracteres inválidos.");
}
