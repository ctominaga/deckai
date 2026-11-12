import { ApiError } from "@google/genai";

export interface GenerationDiagnostic {
  stage: "outline.request" | "outline.json" | "outline.zod" | "presentation.input" | "presentation.approval" |
    "presentation.request" | "presentation.json" | "presentation.zod" |
    "presentation.fidelity" | "rewrite.request" | "rewrite.json" | "rewrite.zod" |
    "regeneration.request" | "regeneration.json" | "regeneration.zod" | "http.input" | "http.approval" | "http.workflow";
  origin: "local" | "gemini_sdk" | "google_api" | "gemini_response" | "deepseek_api" | "deepseek_response";
  category: "local_validation" | "approval" | "provider" | "json" | "zod" | "fidelity" | "workflow";
  code: string;
  upstreamStatus?: number;
  reason?: "response_schema" | "unspecified";
}

// Contains only application messages and sanitized metadata; never retain the
// original SDK error as `cause` (its message can contain credentials or data).
export class GenerationFailure extends Error {
  constructor(message: string, readonly diagnostic: GenerationDiagnostic) {
    super(message);
    this.name = "GenerationFailure";
  }
}

const providerCodes = new Set([
  "INVALID_ARGUMENT", "FAILED_PRECONDITION", "OUT_OF_RANGE", "UNAUTHENTICATED",
  "PERMISSION_DENIED", "NOT_FOUND", "RESOURCE_EXHAUSTED", "INTERNAL",
  "UNAVAILABLE", "DEADLINE_EXCEEDED", "CANCELLED", "UNKNOWN", "API_KEY_INVALID",
  "ETIMEDOUT", "ABORT_ERR", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN",
]);

export function geminiRequestDiagnostic(
  error: unknown,
  stage: "outline.request" | "presentation.request",
): GenerationDiagnostic {
  const details = typeof error === "object" && error !== null
    ? error as { status?: unknown; code?: unknown; message?: unknown } : {};
  let code = details.code;
  const message = typeof details.message === "string" ? details.message : "";
  // The installed SDK stores the Google JSON error envelope in ApiError.message.
  // Read only the canonical status; never print this envelope or its details.
  if (error instanceof ApiError) {
    try { code = JSON.parse(message)?.error?.status ?? code; } catch { /* Non-JSON API error. */ }
  }
  const numericStatus = typeof details.status === "number" ? details.status : details.code;
  const upstreamStatus = error instanceof ApiError && typeof numericStatus === "number" &&
    Number.isInteger(numericStatus) && numericStatus >= 400 && numericStatus <= 599
    ? numericStatus : undefined;
  return {
    stage,
    origin: error instanceof ApiError ? "google_api" : "gemini_sdk",
    category: "provider",
    code: typeof code === "string" && providerCodes.has(code) ? code :
      error instanceof ApiError ? "API_ERROR" : "SDK_ERROR",
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    reason: /response[_\s]?(?:json[_\s]?)?schema/i.test(message) ? "response_schema" : "unspecified",
  };
}

export function logGenerationDiagnostic(diagnostic: GenerationDiagnostic): void {
  // All fields are controlled labels, allowlisted codes or a numeric HTTP status.
  // Do not add error objects, stack traces, prompts, model output or request headers.
  console.error("[DeckAI generation]", JSON.stringify(diagnostic));
}
