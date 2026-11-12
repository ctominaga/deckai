import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewServer } from "../src/dev-preview/server.js";
import { GeminiOutlineGenerationProvider } from "../src/providers/gemini-outline-generation.provider.js";
import type { AiGenerationProvider } from "../src/providers/ai-generation-provider.js";
import type { Script } from "../src/schemas/script.schema.js";
import type { Presentation } from "../src/schemas/presentation.schema.js";
import { presentationMetadata } from "../src/providers/gemini-presentation-contract.js";
import { generateScript } from "../src/services/generation.service.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { geminiSlides } from "./support/gemini-fixtures.js";

let server: Server;
let baseUrl: string;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "true");
  // HTTP tests may only contact their local test server, never Gemini.
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname !== "127.0.0.1") throw new Error("External network forbidden in tests");
    return originalFetch(input, init);
  });
});
afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function content(script: Script): Presentation {
  return { ...presentationMetadata(script), slides: geminiSlides(script) };
}

function fakeProvider(): AiGenerationProvider {
  return {
    generateScriptProposal: vi.fn(async (briefing) => generateScript(briefing)),
    generatePresentation: vi.fn(async (script) => content(script)),
  };
}

async function start(factory: () => AiGenerationProvider = () => fakeProvider()) {
  server = createPreviewServer(factory);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function post(path: string, body: unknown = {}) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function state() { return (await fetch(`${baseUrl}/api/state`)).json(); }
async function draft(provider = "gemini", objective = briefingMock.objective) {
  const response = await post("/api/scripts", { ...briefingMock, objective, provider });
  expect(response.status).toBe(201);
  return (await response.json()).script as Script;
}
async function approve(script: Script) {
  const response = await post(`/api/scripts/${script.id}/approve`, { revision: script.revision });
  expect(response.status).toBe(200);
  return (await response.json()).script as Script;
}

describe("approved presentation HTTP generation", () => {
  it("requires recorded approval of the current revision and sends the original briefing", async () => {
    const provider = fakeProvider();
    await start(() => provider);
    const script = await draft();
    expect((await post(`/api/scripts/${script.id}/presentation`)).status).toBe(409);
    expect((await post(`/api/scripts/${script.id}/approve`, { revision: 2 })).status).toBe(409);
    const approved = await approve(script);
    expect(provider.generatePresentation).not.toHaveBeenCalled();
    expect((await post(`/api/scripts/${script.id}/presentation`, { revision: 2 })).status).toBe(409);
    const response = await post(`/api/scripts/${script.id}/presentation`, { revision: 1 });
    expect(response.status).toBe(201);
    expect(provider.generatePresentation).toHaveBeenCalledWith(approved, briefingMock);
    expect((await response.json()).provider).toBe("gemini");
    expect((await post(`/api/scripts/${script.id}/presentation`)).status).toBe(409);
    expect(provider.generatePresentation).toHaveBeenCalledTimes(1);
  });

  it("blocks Gemini when disabled and leaves Mock available", async () => {
    vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "false");
    const factory = vi.fn(() => fakeProvider());
    await start(factory);
    const disabled = await post("/api/scripts", { ...briefingMock, provider: "gemini" });
    expect(disabled.status).toBe(400);
    expect((await disabled.json()).error).toContain("Gemini desativado");
    expect(factory).not.toHaveBeenCalled();
    const approved = await approve(await draft("mock"));
    const response = await post(`/api/scripts/${approved.id}/presentation`);
    expect(response.status).toBe(201);
    expect((await response.json()).provider).toBe("mock");
    expect((await state()).presentationProvider).toBe("mock");
    expect(factory).not.toHaveBeenCalled();
  });

  it("rechecks the flag for slides and preserves approval for an explicit retry", async () => {
    const provider = fakeProvider();
    await start(() => provider);
    const approved = await approve(await draft());
    vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "false");
    expect((await post(`/api/scripts/${approved.id}/presentation`)).status).toBe(400);
    expect(provider.generatePresentation).not.toHaveBeenCalled();
    expect((await state()).script.status).toBe("approved");
    vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "true");
    expect((await post(`/api/scripts/${approved.id}/presentation`)).status).toBe(201);
  });

  it("preserves approval on failure with no silent Mock fallback", async () => {
    const provider = fakeProvider();
    provider.generatePresentation = vi.fn().mockRejectedValueOnce(new Error("Resposta Gemini inválida")).mockImplementationOnce(async (script) => content(script));
    await start(() => provider);
    const approved = await approve(await draft());
    const failure = await post(`/api/scripts/${approved.id}/presentation`);
    expect(failure.status).toBe(400);
    expect((await failure.json()).error).toContain("Resposta Gemini inválida");
    expect(await state()).toMatchObject({ script: { status: "approved", revision: 1 }, presentation: null, presentationProvider: null });
    expect(provider.generatePresentation).toHaveBeenCalledTimes(1);
    const retry = await post(`/api/scripts/${approved.id}/presentation`);
    expect(retry.status).toBe(201);
    expect((await retry.json()).provider).toBe("gemini");
    expect(provider.generatePresentation).toHaveBeenCalledTimes(2);
  });

  it("invalidates approval immediately when briefing or mode changes", async () => {
    const provider = fakeProvider();
    await start(() => provider);
    const approved = await approve(await draft());
    expect((await post("/api/briefing/invalidate", { scriptId: approved.id })).status).toBe(200);
    expect((await post(`/api/scripts/${approved.id}/presentation`)).status).toBe(409);
    expect(await state()).toMatchObject({ script: null, presentation: null, provider: null });
    expect(provider.generatePresentation).not.toHaveBeenCalled();
    const newer = await draft("mock");
    expect((await post("/api/briefing/invalidate", { scriptId: approved.id })).status).toBe(409);
    expect((await state()).script.id).toBe(newer.id);
  });

  it("blocks duplicate calls and discards an older result after a newer presentation", async () => {
    let release!: (result: Presentation) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const delayed = new Promise<Presentation>((resolve) => { release = resolve; });
    const provider = fakeProvider();
    provider.generatePresentation = vi.fn().mockImplementationOnce(async () => { signalStarted(); return delayed; }).mockImplementation(async (script) => content(script));
    await start(() => provider);
    const first = await approve(await draft());
    const oldRequest = post(`/api/scripts/${first.id}/presentation`);
    await started;
    try {
      expect((await post(`/api/scripts/${first.id}/presentation`)).status).toBe(409);
      expect(provider.generatePresentation).toHaveBeenCalledTimes(1);
      const second = await approve(await draft("gemini", "Uma apresentação mais recente"));
      const newerResponse = await post(`/api/scripts/${second.id}/presentation`);
      const { presentation: newer } = await newerResponse.json();
      expect(newerResponse.status).toBe(201);
      release(content(first));
      expect((await oldRequest).status).toBe(409);
      expect((await state()).presentation).toEqual(newer);
    } finally { release(content(first)); }
  });

  it("blocks duplicate outline requests while the first is in progress", async () => {
    let release!: (script: Script) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const delayed = new Promise<Script>((resolve) => { release = resolve; });
    const provider = fakeProvider();
    provider.generateScriptProposal = vi.fn(async () => { signalStarted(); return delayed; });
    await start(() => provider);
    const first = post("/api/scripts", { ...briefingMock, provider: "gemini" });
    await started;
    try {
      expect((await post("/api/scripts", { ...briefingMock, provider: "gemini" })).status).toBe(409);
      expect(provider.generateScriptProposal).toHaveBeenCalledTimes(1);
    } finally { release(generateScript(briefingMock)); }
    expect((await first).status).toBe(201);
  });

  it("keeps credentials out of assets, state, errors and unknown routes", async () => {
    const secret = "TEST_PRIVATE_GEMINI_KEY_NEVER_DISPLAY";
    vi.stubEnv("GEMINI_API_KEY", secret);
    await start(() => new GeminiOutlineGenerationProvider({ generateContent: async () => { throw { status: 403, message: secret }; } }));
    for (const path of ["/", "/app.js", "/styles.css", "/api/state", "/.env"]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(await response.text()).not.toContain(secret);
      if (path === "/.env") expect(response.status).toBe(404);
    }
    const failure = await post("/api/scripts", { ...briefingMock, provider: "gemini" });
    expect(failure.status).toBe(400);
    const error = await failure.text();
    expect(error).toContain("rejeitou a credencial");
    expect(error).not.toContain(secret);
  });
});
