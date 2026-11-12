import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewServer } from "../src/dev-preview/server.js";
import { GeminiOutlineGenerationProvider } from "../src/providers/gemini-outline-generation.provider.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { geminiSlides } from "./support/gemini-fixtures.js";

beforeEach(() => vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "true"));

let server: Server | undefined;
let baseUrl: string;

async function startServer(factory?: Parameters<typeof createPreviewServer>[0]): Promise<void> {
  server = createPreviewServer(factory);
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }
  server = undefined;
});

describe("dev preview HTTP workflow", () => {
  it("serves the local interface and exposes no Gemini credentials", async () => {
    await startServer();

    const response = await fetch(baseUrl);
    const html = await response.text();
    const stateResponse = await fetch(`${baseUrl}/api/state`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(html).toContain("DeckAI Dev Preview");
    expect(html).toContain("Modo mock");
    expect(await stateResponse.json()).toEqual({
      provider: null,
      scriptEdited: false,
      briefing: null,
      presentationProvider: null,
      script: null,
      presentation: null,
      presentationRevision: null,
    });
  });

  it("generates a draft, blocks premature presentation generation, approves, then generates", async () => {
    await startServer();
    const briefing = {
      prompt: "Apresentação de demonstração fictícia",
      objective: "Apresentar uma iniciativa inventada",
      audience: "público de demonstração",
      tone: "claro",
      language: "pt-BR",
      slideCount: 6,
    };

    const draftResponse = await postJson("/api/scripts", briefing);
    const { script: draft } = await draftResponse.json();
    expect(draftResponse.status).toBe(201);
    expect(draft.status).toBe("draft");
    expect(draft.plannedSlides).toHaveLength(6);

    const blockedResponse = await postJson(
      `/api/scripts/${draft.id}/presentation`,
      {},
    );
    expect(blockedResponse.status).toBe(409);
    expect((await blockedResponse.json()).error).toContain("Aprove o roteiro");

    const approvalResponse = await postJson(
      `/api/scripts/${draft.id}/approve`,
      {},
    );
    const { script: approved } = await approvalResponse.json();
    expect(approvalResponse.status).toBe(200);
    expect(approved.status).toBe("approved");

    const presentationResponse = await postJson(
      `/api/scripts/${approved.id}/presentation`,
      {},
    );
    const { presentation } = await presentationResponse.json();
    expect(presentationResponse.status).toBe(201);
    expect(presentation.slides).toHaveLength(6);
  });

  it("reports invalid briefings and invalidates the previously approved flow", async () => {
    await startServer();
    const validBriefing = {
      prompt: "Briefing fictício válido",
      objective: "Demonstração",
      audience: "Público fictício",
      tone: "neutro",
      language: "pt-BR",
      slideCount: 1,
    };
    const initialResponse = await postJson("/api/scripts", validBriefing);
    const { script } = await initialResponse.json();
    await postJson(`/api/scripts/${script.id}/approve`, {});

    const invalidResponse = await postJson("/api/scripts", {
      ...validBriefing,
      slideCount: 13,
    });
    expect(invalidResponse.status).toBe(400);

    const staleApproval = await postJson(
      `/api/scripts/${script.id}/presentation`,
      {},
    );
    expect(staleApproval.status).toBe(409);
    expect((await staleApproval.json()).error).toContain("briefing atual");
    expect(await (await fetch(`${baseUrl}/api/state`)).json()).toEqual({
      provider: null,
      scriptEdited: false,
      briefing: null,
      presentationProvider: null,
      script: null,
      presentation: null,
      presentationRevision: null,
    });
  });

  it("rejects malformed JSON and routes outside the preview API", async () => {
    await startServer();

    const malformed = await fetch(`${baseUrl}/api/scripts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid",
    });
    const missingRoute = await fetch(`${baseUrl}/not-found`);

    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toContain("JSON válido");
    expect(missingRoute.status).toBe(404);
  });

  it("only calls Gemini on explicit generation requests and reuses it for approved slides", async () => {
    const generateContent = vi.fn(async () => ({ text: JSON.stringify({
      title: "Roteiro personalizado",
      plannedSlides: [{
        title: "Comparação personalizada",
        objective: "Explorar o briefing recebido",
        layout: "two_columns",
        keyPoints: ["Um único tópico válido"],
      }],
    }) }));
    const factory = vi.fn(() => new GeminiOutlineGenerationProvider({
      apiKey: "test-key-not-real", generateContent,
    }));
    await startServer(factory);
    await fetch(baseUrl);
    await fetch(`${baseUrl}/api/state`);
    await postJson("/api/scripts", { ...briefingMock, provider: "mock" });
    expect(factory).not.toHaveBeenCalled();

    const briefing = { ...briefingMock, prompt: "Minha proposta personalizada", slideCount: 1 };
    const response = await postJson("/api/scripts", { ...briefing, provider: "gemini" });
    const { script, provider } = await response.json();
    expect(response.status).toBe(201);
    expect(provider).toBe("gemini");
    expect(script.title).toBe("Roteiro personalizado");
    expect(script.status).toBe("draft");
    expect(generateContent.mock.calls[0][0]).toMatchObject({
      contents: expect.stringContaining(JSON.stringify(briefing)),
    });
    expect((await postJson(`/api/scripts/${script.id}/presentation`, {})).status).toBe(409);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await postJson(`/api/scripts/${script.id}/approve`, {});
    expect(generateContent).toHaveBeenCalledTimes(1);
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ slides: geminiSlides(script) }) });
    const presentationResponse = await postJson(`/api/scripts/${script.id}/presentation`, {});
    const { presentation } = await presentationResponse.json();
    expect(presentationResponse.status).toBe(201);
    expect(presentation.title).toBe(script.title);
    expect(presentation.slides[0].title).toBe(script.plannedSlides[0].title);
    expect(presentation.slides[0].layout).toBe("two_columns");
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect((await (await fetch(`${baseUrl}/api/state`)).json()).presentationProvider).toBe("gemini");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(await (await fetch(`${baseUrl}/api/state`)).json()).toMatchObject({ provider: "gemini" });
  });

  it("validates provider and briefing before constructing Gemini", async () => {
    const factory = vi.fn(() => { throw new Error("Must not be constructed"); });
    await startServer(factory);
    expect((await postJson("/api/scripts", { ...briefingMock, provider: "unknown" })).status).toBe(400);
    expect((await postJson("/api/scripts", { ...briefingMock, provider: "gemini", slideCount: 13 })).status).toBe(400);
    expect(factory).not.toHaveBeenCalled();
  });

  it("reports missing credentials without breaking default Mock", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await startServer();
    const response = await postJson("/api/scripts", { ...briefingMock, provider: "gemini" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("GEMINI_API_KEY não está configurada");
    expect((await postJson("/api/scripts", briefingMock)).status).toBe(201);
  });

  it("rejects invalid Gemini output without replacing it with mock data", async () => {
    await startServer(() => new GeminiOutlineGenerationProvider({
      apiKey: "test-key-not-real",
      generateContent: async () => ({ text: '{"title":"Incompleto"}' }),
    }));
    const response = await postJson("/api/scripts", { ...briefingMock, provider: "gemini" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("incompatível");
    expect(await (await fetch(`${baseUrl}/api/state`)).json()).toEqual({
      provider: null, scriptEdited: false, script: null, presentation: null, presentationRevision: null, briefing: null, presentationProvider: null,
    });
  });

  it("assigns fresh IDs so older approval cannot approve a newer script", async () => {
    await startServer();
    const first = await (await postJson("/api/scripts", briefingMock)).json();
    const second = await (await postJson("/api/scripts", briefingMock)).json();
    expect(first.script.id).not.toBe(second.script.id);
    expect((await postJson(`/api/scripts/${first.script.id}/approve`, {})).status).toBe(409);
  });
});
