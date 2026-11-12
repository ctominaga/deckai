import { z } from "zod";
import { presentationContentSchema } from "./ai-presentation-contract.js";
export { presentationContentSchema, presentationMetadata } from "./ai-presentation-contract.js";

// The model supplies content; application-owned IDs and reference metadata are
// specified in the prompt and checked again after parsing. No external sources.

export function presentationResponseJsonSchema(slideCount: number): unknown {
  return toGeminiJsonSchema(z.toJSONSchema(presentationContentSchema(slideCount)));
}

function toGeminiJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiJsonSchema);
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    // @google/genai 2.32 documents enum, not const/minLength. Zod still
    // enforces non-empty strings locally after the structured response.
    if (key === "$schema" || key === "minLength") continue;
    if (key === "const") result.enum = [child];
    else result[key] = toGeminiJsonSchema(child);
  }
  return result;
}
