import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { presentationMock } from "../src/mocks/presentation.mock.js";
import type { AiGenerationProvider } from "../src/providers/ai-generation-provider.js";
import { GeminiOutlineGenerationProvider } from "../src/providers/gemini-outline-generation.provider.js";
import { MockAiGenerationProvider } from "../src/providers/mock-ai-generation.provider.js";
import { scriptSchema } from "../src/schemas/script.schema.js";
import {
  AiGenerationService,
  AiOutlineGenerationService,
} from "../src/services/ai-generation.service.js";
import { presentationSchema } from "../src/schemas/presentation.schema.js";
import { approveScript, generateScript } from "../src/services/generation.service.js";

beforeEach(() => vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "true"));
afterEach(() => vi.unstubAllEnvs());

const outlineResponse = {
  title: "Plano fictício de apresentação",
  plannedSlides: [
    {
      title: "Abertura",
      objective: "Apresentar o tema.",
      layout: "cover",
      keyPoints: ["Proposta fictícia", "Contexto demonstrativo"],
    },
    {
      title: "Encerramento",
      objective: "Concluir a apresentação.",
      layout: "closing",
      keyPoints: ["Síntese", "Obrigado"],
    },
  ],
};

function createProviderResponse(text: string) {
  const generateContent = vi.fn(async () => ({ text }));
  const provider = new GeminiOutlineGenerationProvider({
    apiKey: "test-key-not-real",
    model: "gemini-test-model",
    generateContent,
  });
  return { provider, generateContent };
}

describe("GeminiOutlineGenerationProvider", () => {
  it("generates a valid draft from a structured Gemini response", async () => {
    const { provider, generateContent } = createProviderResponse(
      JSON.stringify(outlineResponse),
    );
    const service = new AiOutlineGenerationService(provider);
    const briefing = { ...briefingMock, slideCount: 2 };
    const script = await service.generateScriptProposal(briefing);

    expect(scriptSchema.safeParse(script).success).toBe(true);
    expect(script.status).toBe("draft");
    expect(script.plannedSlides).toHaveLength(briefing.slideCount);
    expect(script.plannedSlides.map((slide) => slide.layout)).toEqual([
      "cover",
      "closing",
    ]);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0]).toMatchObject({
      model: "gemini-test-model",
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        httpOptions: {
          timeout: 30_000,
          retryOptions: { attempts: 1 },
        },
      },
    });
  });

  it("rejects invalid JSON", async () => {
    const { provider } = createProviderResponse("{not-json");

    await expect(
      provider.generateScriptProposal(briefingMock),
    ).rejects.toThrow("não é JSON válido");
  });

  it("rejects layouts outside the six supported layouts", async () => {
    const invalidResponse = {
      ...outlineResponse,
      plannedSlides: [
        { ...outlineResponse.plannedSlides[0], layout: "unknown-layout" },
        outlineResponse.plannedSlides[1],
      ],
    };
    const { provider } = createProviderResponse(JSON.stringify(invalidResponse));

    await expect(
      provider.generateScriptProposal(briefingMock),
    ).rejects.toThrow("Resposta do Gemini incompatível");
  });

  it("fails clearly when the API key is missing", () => {
    expect(
      () => new GeminiOutlineGenerationProvider({ apiKey: "" }),
    ).toThrow("GEMINI_API_KEY não está configurada");
  });

  it.each([
    [{ status: 401 }, "rejeitou a credencial"],
    [{ status: 404 }, "não está disponível"],
    [{ status: 429 }, "limite de requisições"],
    [{ name: "TimeoutError" }, "excedeu o tempo limite"],
    [{ code: "ECONNRESET" }, "Falha de conexão"],
  ])("maps external failure %o to a safe message", async (failure, message) => {
    const generateContent = vi.fn(async () => {
      throw failure;
    });
    const provider = new GeminiOutlineGenerationProvider({
      apiKey: "test-key-not-real",
      generateContent,
    });

    await expect(
      provider.generateScriptProposal(briefingMock),
    ).rejects.toThrow(message);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects empty responses and unexpected slide counts", async () => {
    const emptyProvider = createProviderResponse(" ").provider;
    const wrongSlideCount = {
      ...outlineResponse,
      plannedSlides: [outlineResponse.plannedSlides[0]],
    };
    const wrongCountProvider = createProviderResponse(
      JSON.stringify(wrongSlideCount),
    ).provider;

    await expect(
      emptyProvider.generateScriptProposal(briefingMock),
    ).rejects.toThrow("resposta vazia");
    await expect(
      wrongCountProvider.generateScriptProposal(briefingMock),
    ).rejects.toThrow("o briefing solicita exatamente");
  });

  it("preserves mock outline and presentation generation without credentials", async () => {
    const provider: AiGenerationProvider = new MockAiGenerationProvider();
    const service = new AiGenerationService(provider);
    const script = await service.generateScriptProposal(briefingMock);
    const presentation = await service.generatePresentation(
      service.approveScript(script),
    );

    expect(script.plannedSlides).toHaveLength(briefingMock.slideCount);
    expect(presentationSchema.safeParse(presentation).success).toBe(true);
    expect(presentationMock.slides).toHaveLength(6);
  });

  it("keeps local approval and mock presentation generation available", async () => {
    const draft = generateScript(briefingMock);
    const approved = approveScript(draft);

    expect(approved.status).toBe("approved");
    expect(approved).not.toBe(draft);
  });
});
