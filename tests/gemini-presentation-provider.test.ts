import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiOutlineGenerationProvider } from "../src/providers/gemini-outline-generation.provider.js";
import { presentationSchema } from "../src/schemas/presentation.schema.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { approveScript, generateScript } from "../src/services/generation.service.js";
import { AiGenerationService } from "../src/services/ai-generation.service.js";
import { geminiSlides } from "./support/gemini-fixtures.js";

const approved = approveScript(generateScript(briefingMock));

beforeEach(() => {
  vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in unit tests"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function createProvider(text = JSON.stringify({ slides: geminiSlides(approved) })) {
  const generateContent = vi.fn(async () => ({ text }));
  const provider = new GeminiOutlineGenerationProvider({ apiKey: "test-key-not-real", model: "configured-test-model", generateContent });
  return { provider, generateContent };
}

describe("Gemini presentation generation", () => {
  it("generates and validates all six layouts with one request and stable IDs", async () => {
    const { provider, generateContent } = createProvider();
    const presentation = await new AiGenerationService(provider).generatePresentation(approved, briefingMock);
    expect(presentationSchema.safeParse(presentation).success).toBe(true);
    expect(presentation.slides.map(({ id, layout, title }) => ({ id, layout, title }))).toEqual(
      approved.plannedSlides.map(({ id, layout, title }) => ({ id, layout, title })),
    );
    expect(presentation.slides[0].subtitle).toContain("rede fictícia");
    expect(presentation.slides[2].right.body).toContain("Moradores fictícios");
    expect(presentation.slides[3].metrics[0].context).toContain("Demonstração fictícia");
    expect(presentation.slides[4].result).toContain("Demonstração fictícia");
    expect(presentation.references).toEqual([expect.objectContaining({ type: "demonstration" })]);
    expect(generateContent).toHaveBeenCalledTimes(1);
    const request = generateContent.mock.calls[0][0];
    expect(request).toMatchObject({ model: "configured-test-model", config: {
      responseMimeType: "application/json", automaticContinuation: false,
      responseJsonSchema: expect.objectContaining({ properties: expect.any(Object) }),
      httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } },
    } });
    expect(request.contents).toContain(JSON.stringify(approved));
    expect(request.contents).toContain(JSON.stringify(briefingMock));
    expect(request.contents).not.toContain("test-key-not-real");
    const schemaText = JSON.stringify(request.config.responseJsonSchema);
    expect(schemaText).toContain('"enum":["two_columns"]');
    expect(schemaText).not.toContain('"const":');
    expect(schemaText).not.toContain('"minLength":');
    const repeated = await provider.generatePresentation(approved);
    expect(repeated.id).toBe(presentation.id);
    expect(repeated.slides.map((slide) => slide.id)).toEqual(presentation.slides.map((slide) => slide.id));
  });

  it("rejects draft scripts before sending anything", async () => {
    const { provider, generateContent } = createProvider();
    await expect(provider.generatePresentation(generateScript(briefingMock))).rejects.toThrow("ainda não foi aprovado");
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("blocks both operations when Gemini is disabled", async () => {
    vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "false");
    const { provider, generateContent } = createProvider();
    await expect(provider.generatePresentation(approved)).rejects.toThrow("Gemini desativado");
    await expect(provider.generateScriptProposal(briefingMock)).rejects.toThrow("Gemini desativado");
    expect(generateContent).not.toHaveBeenCalled();
  });

  it.each([[""], ["{invalid-json"]])("rejects empty or malformed output %j", async (text) => {
    await expect(createProvider(text).provider.generatePresentation(approved)).rejects.toThrow(/resposta vazia|JSON válido/);
  });

  it.each([
    [0, "subtitle"], [1, "imageId"], [2, "right"], [3, "metrics"], [4, "approach"], [5, "callToAction"],
  ])("rejects missing required field %s.%s", async (index, field) => {
    const slides = geminiSlides(approved);
    delete slides[index][field];
    const { provider } = createProvider(JSON.stringify({ slides }));
    await expect(provider.generatePresentation(approved)).rejects.toThrow("incompatível com o schema");
  });

  it("rejects the wrong count, without repairing or completing it with mock content", async () => {
    const { provider } = createProvider(JSON.stringify({ slides: geminiSlides(approved).slice(0, 5) }));
    await expect(provider.generatePresentation(approved)).rejects.toThrow("incompatível");
  });

  it.each(["order", "layout", "id", "title"])("rejects a change to approved %s", async (change) => {
    const slides = geminiSlides(approved);
    if (change === "order") [slides[0], slides[1]] = [slides[1], slides[0]];
    if (change === "layout") slides[0] = { id: slides[0].id, title: slides[0].title, referenceIds: slides[0].referenceIds, layout: "closing", message: "Texto", callToAction: "Ação" };
    if (change === "id") slides[0].id = "invented-id";
    if (change === "title") slides[0].title = "Silently changed title";
    await expect(createProvider(JSON.stringify({ slides })).provider.generatePresentation(approved)).rejects.toThrow("roteiro aprovado");
  });

  it("rejects invented references and real image URLs", async () => {
    const slides = geminiSlides(approved);
    slides[0].referenceIds = ["invented-source"];
    await expect(createProvider(JSON.stringify({ slides })).provider.generatePresentation(approved)).rejects.toThrow();
    const imageSlides = geminiSlides(approved);
    imageSlides[0].imageId = "https://invented.example/image.png";
    await expect(createProvider(JSON.stringify({ slides: imageSlides })).provider.generatePresentation(approved)).rejects.toThrow("placeholder visual");
  });

  it("maps upstream failures without exposing credentials or retrying", async () => {
    const generateContent = vi.fn(async () => { throw { status: 429, message: "test-secret-key" }; });
    const provider = new GeminiOutlineGenerationProvider({ apiKey: "test-secret-key", generateContent });
    await expect(provider.generatePresentation(approved)).rejects.toThrow("limite de requisições");
    try { await provider.generatePresentation(approved); } catch (error) { expect(String(error)).not.toContain("test-secret-key"); }
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
