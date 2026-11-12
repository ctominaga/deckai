import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";
import { createPreviewServer } from "../src/dev-preview/server.js";
import { GeminiOutlineGenerationProvider } from "../src/providers/gemini-outline-generation.provider.js";
import { presentationResponseJsonSchema } from "../src/providers/gemini-presentation-contract.js";
import { approveScript, generateScript } from "../src/services/generation.service.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { geminiSlides } from "./support/gemini-fixtures.js";

const approved = approveScript(generateScript(briefingMock));
const secret = "PRIVATE_TEST_KEY_NEVER_LOG";
const confidential = "CONFIDENTIAL_TEST_CONTENT_NEVER_LOG";
const realFetch = globalThis.fetch;
let server: Server | undefined;
let baseUrl: string;
let logger: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "true");
  logger = vi.spyOn(console, "error").mockImplementation(() => {});
  // No real network, even if a test accidentally constructs the default SDK.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden"); }));
});
afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
  expect(JSON.stringify(logger.mock.calls)).not.toContain(confidential);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function sdkResponse(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] }), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("presentation SDK transport regression (no external requests)", () => {
  it("serializes the real SDK request unchanged and validates six layouts", async () => {
    const transport = vi.fn(async () => sdkResponse(JSON.stringify({ slides: geminiSlides(approved) })));
    vi.stubGlobal("fetch", transport);
    // Exercise the installed SDK, not an injected generateContent implementation.
    const provider = new GeminiOutlineGenerationProvider({ apiKey: secret, model: "configured-test-model" });
    const result = await provider.generatePresentation(approved, briefingMock);
    expect(result.slides.map(({ layout }) => layout)).toEqual(approved.plannedSlides.map(({ layout }) => layout));
    expect(transport).toHaveBeenCalledTimes(1);
    const request = JSON.parse((transport.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.generationConfig.responseJsonSchema).toEqual(presentationResponseJsonSchema(6));
    expect(request.generationConfig.responseSchema).toBeUndefined();
    expect(logger).not.toHaveBeenCalled();
  });

  it.each([
    [400, "INVALID_ARGUMENT", "Invalid response_json_schema", "response_schema"],
    [503, "UNAVAILABLE", "Temporarily unavailable", "unspecified"],
  ])("preserves a real SDK ApiError HTTP %i without retrying", async (status, code, message, reason) => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ error: {
      code: status, status: code, message: `${message} ${secret} ${confidential}`,
    } }), { status, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", transport);
    const provider = new GeminiOutlineGenerationProvider({ apiKey: secret });
    await expect(provider.generatePresentation(approved)).rejects.toMatchObject({
      message: "Falha na solicitação ao Gemini. Nenhuma nova tentativa foi feita.",
      diagnostic: { stage: "presentation.request", origin: "google_api", category: "provider", code, upstreamStatus: status, reason },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

async function startPresentation(textOrError: string | Error) {
  const generateContent = vi.fn(async () => {
    if (textOrError instanceof Error) throw textOrError;
    return { text: textOrError };
  });
  const provider = new GeminiOutlineGenerationProvider({ apiKey: secret, generateContent });
  provider.generateScriptProposal = vi.fn(async () => generateScript(briefingMock));
  server = createPreviewServer(() => provider);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Obtain a Gemini draft without making even a simulated outline SDK call.
  const geminiResponse = await post("/api/scripts", { ...briefingMock, provider: "gemini" });
  return { script: (await geminiResponse.json()).script, generateContent };
}

function post(path: string, body: unknown = {}) {
  // Only the local preview server is contacted; SDK fetch remains forbidden.
  return realFetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("safe HTTP diagnostics", () => {
  it.each([
    ["Google HTTP 400", new ApiError({ status: 400, message: JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: `${secret} ${confidential}` } }) }),
      { stage: "presentation.request", origin: "google_api", category: "provider", code: "INVALID_ARGUMENT", upstreamStatus: 400 }],
    ["Google HTTP 503", new ApiError({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE", message: `${secret} ${confidential}` } }) }),
      { stage: "presentation.request", origin: "google_api", category: "provider", code: "UNAVAILABLE", upstreamStatus: 503 }],
    ["SDK local failure", new Error(`SDK serialization ${secret} ${confidential}`),
      { stage: "presentation.request", origin: "gemini_sdk", category: "provider", code: "SDK_ERROR" }],
    ["invalid JSON", `{invalid ${secret} ${confidential}`,
      { stage: "presentation.json", origin: "gemini_response", category: "json", code: "INVALID_JSON_RESPONSE" }],
    ["invalid Zod output", JSON.stringify({ slides: [{ [secret]: confidential }] }),
      { stage: "presentation.zod", origin: "gemini_response", category: "zod", code: "INVALID_PRESENTATION" }],
  ])("distinguishes %s without exposing the original error or retrying", async (_label, failure, diagnostic) => {
    const { script, generateContent } = await startPresentation(failure as string | Error);
    expect((await post(`/api/scripts/${script.id}/approve`)).status).toBe(200);
    const response = await post(`/api/scripts/${script.id}/presentation`);
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain(secret);
    expect(body).not.toContain(confidential);
    expect(body).not.toContain("diagnostic");
    expect(logger).toHaveBeenCalledTimes(1);
    const record = JSON.parse(logger.mock.calls[0][1]);
    expect(record).toMatchObject(diagnostic);
    if (diagnostic.origin !== "google_api") expect(record).not.toHaveProperty("upstreamStatus");
    const state = await (await realFetch(`${baseUrl}/api/state`)).json();
    expect(state).toMatchObject({ script: { status: "approved" }, presentation: null, presentationProvider: null });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("distinguishes approval and local input validation before calling Gemini", async () => {
    const { script, generateContent } = await startPresentation("unused");
    const unapproved = await post(`/api/scripts/${script.id}/presentation`);
    expect(unapproved.status).toBe(409);
    expect(JSON.parse(logger.mock.calls[0][1])).toMatchObject({ origin: "local", category: "approval", code: "APPROVAL_REQUIRED" });
    const invalid = await post(`/api/scripts/${script.id}/presentation`, { revision: "invalid" });
    expect(invalid.status).toBe(400);
    expect(JSON.parse(logger.mock.calls[1][1])).toMatchObject({ origin: "local", category: "local_validation", code: "INVALID_REQUEST" });
    expect((await post(`/api/scripts/${script.id}/approve`)).status).toBe(200);
    const stale = await post(`/api/scripts/${script.id}/presentation`, { revision: 2 });
    expect(stale.status).toBe(409);
    expect(JSON.parse(logger.mock.calls[2][1])).toMatchObject({ category: "approval", code: "STALE_REVISION" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("does not propagate arbitrary provider codes into logs", async () => {
    const { script } = await startPresentation(new ApiError({ status: 400, message: JSON.stringify({ error: { status: secret, message: confidential } }) }));
    await post(`/api/scripts/${script.id}/approve`);
    expect((await post(`/api/scripts/${script.id}/presentation`)).status).toBe(400);
    expect(JSON.parse(logger.mock.calls[0][1])).toMatchObject({ origin: "google_api", code: "API_ERROR", upstreamStatus: 400 });
  });
});
