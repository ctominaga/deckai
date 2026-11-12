import { z } from "zod";

export const regenerationRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  revision: z.number().int().positive(),
  slideId: z.string().trim().min(1).max(200),
  instruction: z.string().trim().max(1000).default(""),
  provider: z.enum(["deepseek", "mock", "gemini"]),
}).strict();

// Also identifies in-flight work, so closing the preview cancels delayed responses.
export const regenerationActionSchema = z.object({ requestId: z.string().uuid() }).strict();
export type RegenerationRequest = z.infer<typeof regenerationRequestSchema>;
