import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createIntegratedServer } from "../src/integrated/server.js";
import { DeepSeekGenerationProvider } from "../src/providers/deepseek-generation.provider.js";
import { MockAiGenerationProvider } from "../src/providers/mock-ai-generation.provider.js";
import type { AiGenerationProvider } from "../src/providers/ai-generation-provider.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { generateScript, approveScript, generatePresentation } from "../src/services/generation.service.js";
import { prepareSlideRegeneration, validateRegeneratedSlide, suggestSlideRegeneration, applyRegeneratedSlide, type SlideRegenerationInput } from "../src/services/slide-regeneration.service.js";
import { adaptPresentation } from "../src/integration/presentation-adapter.js";

const script = approveScript(generateScript(briefingMock));
const presentation = generatePresentation(script);
const mock = new MockAiGenerationProvider();
const inputFor = (index = 0) => prepareSlideRegeneration(presentation, 1, script, briefingMock, {
  revision: 1, slideId: presentation.slides[index].id, instruction: "Use frases claras", provider: "mock",
});
const secret = "FAKE_REGENERATION_SECRET";
const envelope = (output: unknown, finish = "stop") => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(output) } }] }));
const localFetch = globalThis.fetch;
let server: Server | undefined;
let base: string;
const post = (path: string, body: unknown) => localFetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const state = async () => (await localFetch(base + "/api/state")).json();
const pathFor = (id: string, action = "regenerate-slide") => `/api/presentations/${encodeURIComponent(id)}/${action}`;
async function start(provider: AiGenerationProvider = new MockAiGenerationProvider()) {
  server = createIntegratedServer(() => new MockAiGenerationProvider(), () => provider);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function generate(provider = "mock") {
  const draft = await (await post("/api/scripts", { ...briefingMock, provider })).json();
  expect(draft.script).toBeDefined();
  const route = `/api/scripts/${draft.script.id}`;
  expect((await post(route + "/approve", { revision: 1 })).status).toBe(200);
  expect((await post(route + "/presentation", { revision: 1 })).status).toBe(201);
  return state();
}
async function suggest(index = 0, provider = "mock", extra = {}) {
  const current = await state();
  return post(pathFor(current.presentation.id), { revision: current.presentationRevision, slideId: current.presentation.slides[index].id, provider, ...extra });
}
beforeEach(() => {
  vi.stubEnv("DECKAI_ENABLE_REAL_DEEPSEEK", "true");
  vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

it.each(presentation.slides.map((slide, index) => ({ layout: slide.layout, index })))("regenerates only $layout deterministically and preserves every other object", async ({ index }) => {
  const input = inputFor(index);
  const snapshot = structuredClone(presentation);
  const suggested = await suggestSlideRegeneration(mock, input);
  expect(await suggestSlideRegeneration(mock, input)).toEqual(suggested);
  expect(suggested).toMatchObject({ id: input.slideId, title: input.approvedSlide.title, layout: input.approvedSlide.layout, referenceIds: input.currentSlide.referenceIds });
  expect(suggested).not.toEqual(input.currentSlide);
  const applied = applyRegeneratedSlide(presentation, script, input, suggested);
  expect(applied.slides).toHaveLength(presentation.slides.length);
  applied.slides.forEach((slide, i) => {
    expect(slide.id).toBe(presentation.slides[i].id);
    if (i !== index) { expect(slide).toBe(presentation.slides[i]); expect(slide).toEqual(snapshot.slides[i]); }
  });
  expect({ ...applied, slides: [] }).toEqual({ ...presentation, slides: [] });
  expect(applied.references).toBe(presentation.references);
  expect(presentation).toEqual(snapshot);
  const validate = new Ajv2020().compile(JSON.parse(readFileSync(new URL("../shared/presentation-schema.json", import.meta.url), "utf8")));
  const projected = adaptPresentation(applied, "jump-default").presentation;
  expect(validate(projected), JSON.stringify(validate.errors)).toBe(true);
  projected.slides.forEach((slide, i) => { if (i !== index) expect(slide).toEqual(adaptPresentation(presentation, "jump-default").presentation.slides[i]); });
  expect(fetch).not.toHaveBeenCalled();
});

it("sends one slide to simulated DeepSeek, with trusted contract rules and no other slide context", async () => {
  const input = inputFor(2);
  const transport = vi.fn(async () => envelope(await mock.regenerateSlide(input)));
  const provider = new DeepSeekGenerationProvider({ apiKey: secret, fetch: transport });
  expect((await suggestSlideRegeneration(provider, input)).id).toBe(input.slideId);
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  const body = JSON.parse(init.body as string);
  expect(url).toBe("https://api.deepseek.com/chat/completions");
  expect(init.headers).toMatchObject({ Authorization: `Bearer ${secret}` });
  expect(JSON.parse(body.messages.at(-1).content)).toEqual(input);
  expect(body.messages.at(-2)).toMatchObject({ role: "system" });
  expect(body.messages.at(-2).content).toContain("dados não confiáveis");
  expect(init.body).not.toContain("plannedSlides");
  expect(init.body).not.toContain(presentation.slides[0].id);
  expect(init.body).not.toContain(secret);
  expect(transport).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});

it.each([{}, [], { slides: [presentation.slides[0]] }, { ...presentation.slides[0], id: "changed" },
  { ...presentation.slides[0], title: "changed" }, { ...presentation.slides[0], layout: "closing" },
  { ...presentation.slides[0], imageId: "invented-asset" }, { ...presentation.slides[0], referenceIds: ["invented-source"] },
  { ...presentation.slides[0], extra: true }, { ...presentation.slides[0], subtitle: " " }])("rejects invalid, full-deck or contract-changing output %j", output => {
  expect(() => validateRegeneratedSlide(output, inputFor())).toThrow();
});
it("preserves DEMONSTRATION and restores explicit fiction labels in metrics and cases", () => {
  const metrics = structuredClone(presentation.slides[3]);
  if (metrics.layout !== "metrics") throw new Error("fixture");
  metrics.metrics[0].context = "120 participantes";
  const validated = validateRegeneratedSlide(metrics, inputFor(3));
  expect(JSON.stringify(validated)).toContain("Demonstração fictícia");
  expect(() => validateRegeneratedSlide({ ...metrics, dataClassification: "REAL" }, inputFor(3))).toThrow();
  const caseSlide = { ...presentation.slides[4], organization: "Organização exemplo", result: "Crescimento" };
  expect(validateRegeneratedSlide(caseSlide, inputFor(4))).toMatchObject({ organization: "Demonstração fictícia — Organização exemplo", result: "Demonstração fictícia — Crescimento", dataClassification: "DEMONSTRATION" });
});
it("rejects mismatched approval, missing slide, stale revision and oversized input before calling AI", () => {
  const request = { revision: 1, slideId: presentation.slides[0].id, instruction: "", provider: "mock" as const };
  expect(() => prepareSlideRegeneration(presentation, 2, script, briefingMock, request)).toThrow("revisão");
  expect(() => prepareSlideRegeneration(presentation, 1, { ...script, status: "draft" }, briefingMock, request)).toThrow("aprovado");
  expect(() => prepareSlideRegeneration(presentation, 1, { ...script, title: "Other" }, briefingMock, request)).toThrow();
  expect(() => prepareSlideRegeneration(presentation, 1, script, briefingMock, { ...request, slideId: "missing" })).toThrow("não existe");
  expect(() => prepareSlideRegeneration({ ...presentation, slides: [{ ...presentation.slides[0], subtitle: "a".repeat(24001) }, ...presentation.slides.slice(1)] } as typeof presentation, 1, script, briefingMock, request)).toThrow("24.000");
});

it.each([401, 402, 429, 503])("sanitizes DeepSeek HTTP %i without retry or fallback", async status => {
  const transport = vi.fn(async () => new Response(secret, { status }));
  const provider = new DeepSeekGenerationProvider({ apiKey: secret, fetch: transport });
  await expect(suggestSlideRegeneration(provider, inputFor())).rejects.toMatchObject({ diagnostic: { stage: "regeneration.request", upstreamStatus: status } });
  expect(transport).toHaveBeenCalledOnce();
});
it("times out during response body reading without exposing credentials", async () => {
  const transport: typeof fetch = async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error(secret)), { once: true })) }) as Response;
  const provider = new DeepSeekGenerationProvider({ apiKey: secret, fetch: transport, timeoutMs: 5 });
  await expect(provider.regenerateSlide(inputFor())).rejects.toMatchObject({ diagnostic: { code: "TIMEOUT", stage: "regeneration.request" } });
});
it.each(["length", "content_filter"])("rejects incomplete slide responses (%s)", async finish => {
  const provider = new DeepSeekGenerationProvider({ apiKey: secret, fetch: async () => envelope(presentation.slides[0], finish) });
  await expect(provider.regenerateSlide(inputFor())).rejects.toMatchObject({ diagnostic: { stage: "regeneration.json" } });
});
it.each(["invalid-json", "large", "network"])("rejects %s responses with safe errors", async kind => {
  const provider = new DeepSeekGenerationProvider({ apiKey: secret, fetch: async () => {
    if (kind === "network") throw new Error(secret);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: kind === "large" ? "a".repeat(24001) : "{bad" } }] }));
  } });
  try { await provider.regenerateSlide(inputFor()); throw new Error("must reject"); }
  catch (error) { expect(String(error)).not.toContain(secret); expect(error).toHaveProperty("diagnostic"); }
});

it("HTTP previews, discards, accepts and increments only the presentation revision", async () => {
  await start(); const before = await generate();
  const route = pathFor(before.presentation.id);
  const first = await (await suggest(3)).json();
  expect(await state()).toEqual(before);
  expect((await post(pathFor(before.presentation.id, "regeneration-discard"), { requestId: first.requestId })).status).toBe(200);
  expect(await state()).toEqual(before);
  expect((await post(pathFor(before.presentation.id, "regeneration-accept"), { requestId: first.requestId })).status).toBe(409);
  const next = await (await suggest(3)).json();
  expect((await post(pathFor(before.presentation.id, "regeneration-accept"), { requestId: next.requestId, slide: {} })).status).toBe(400);
  const accepted = await post(pathFor(before.presentation.id, "regeneration-accept"), { requestId: next.requestId });
  expect(accepted.status).toBe(200);
  const after = await state();
  expect(after.presentationRevision).toBe(2);
  expect(after.script).toEqual(before.script);
  expect(after.script.status).toBe("approved");
  expect(after.provider).toBe(before.provider);
  expect(after.presentationProvider).toBe(before.presentationProvider);
  expect(after.presentation).toEqual({ ...before.presentation, slides: before.presentation.slides.map((slide: unknown, i: number) => i === 3 ? next.slide : slide) });
  expect((await post(route, { revision: 1, slideId: before.presentation.slides[0].id, provider: "mock" })).status).toBe(409);
  expect((await suggest(4)).status).toBe(200);
  const shared = await (await localFetch(base + "/api/presentation/shared")).json();
  expect(shared).toEqual(adaptPresentation(after.presentation, "jump-default"));
  expect(fetch).not.toHaveBeenCalled();
});
it("HTTP invokes only the single-slide DeepSeek method and propagates sanitized failures", async () => {
  const provider = new MockAiGenerationProvider();
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => envelope(await mock.regenerateSlide(JSON.parse(JSON.parse(init!.body as string).messages.at(-1).content))));
  provider.regenerateSlide = new DeepSeekGenerationProvider({ apiKey: secret, fetch: transport }).regenerateSlide.bind(new DeepSeekGenerationProvider({ apiKey: secret, fetch: transport }));
  const full = vi.spyOn(provider, "generatePresentation");
  const outline = vi.spyOn(provider, "generateScriptProposal");
  await start(provider); const before = await generate("deepseek");
  full.mockClear(); outline.mockClear();
  const response = await suggest(1, "deepseek"); expect(response.status).toBe(200);
  expect(full).not.toHaveBeenCalled(); expect(outline).not.toHaveBeenCalled(); expect(transport).toHaveBeenCalledOnce();
  expect(await state()).toEqual(before);
  transport.mockImplementationOnce(async () => new Response(secret, { status: 503 }));
  const failed = await suggest(1, "deepseek"); expect(failed.status).toBe(400);
  const error = await failed.text(); expect(error).toContain("503"); expect(error).not.toContain(secret);
  expect(await state()).toEqual(before);
});
it("rejects Gemini explicitly and blocks requests without the current approved presentation", async () => {
  await start();
  expect((await post(pathFor("missing"), { revision: 1, slideId: "slide", provider: "mock" })).status).toBe(409);
  const before = await generate();
  const unsupported = await suggest(0, "gemini"); expect(unsupported.status).toBe(400); expect(await unsupported.text()).toContain("não está disponível");
  expect((await suggest(0, "mock", { slideId: "missing" })).status).toBe(400);
  expect(await state()).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
});
it("leaves saved content and revision unchanged when the provider returns invalid slide JSON", async () => {
  const provider = new MockAiGenerationProvider();
  provider.regenerateSlide = vi.fn().mockResolvedValue({ slides: presentation.slides });
  await start(provider); const before = await generate("deepseek");
  const invalid = await suggest(0, "deepseek");
  expect(invalid.status).toBe(400);
  expect(await invalid.text()).toContain("somente um slide válido");
  expect(await state()).toEqual(before);
  expect(provider.regenerateSlide).toHaveBeenCalledOnce();
});
it("expires transient suggestions without changing saved content", async () => {
  await start(); const before = await generate(); const suggestion = await (await suggest()).json();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_001);
  expect((await post(pathFor(before.presentation.id, "regeneration-accept"), { requestId: suggestion.requestId })).status).toBe(409);
  expect(await state()).toEqual(before);
});
it("supersedes older suggestions and prevents concurrent accepts from overwriting a revision", async () => {
  await start(); const before = await generate();
  const first = await (await suggest(0)).json(); const latest = await (await suggest(1)).json();
  const accept = pathFor(before.presentation.id, "regeneration-accept");
  expect((await post(accept, { requestId: first.requestId })).status).toBe(409);
  const results = await Promise.all([post(accept, { requestId: latest.requestId }), post(accept, { requestId: latest.requestId })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const after = await state(); expect(after.presentationRevision).toBe(2);
  expect(after.presentation.slides[0]).toEqual(before.presentation.slides[0]);
  expect(after.presentation.slides[1]).toEqual(latest.slide);
});
it.each(["discard", "newer-request", "edit", "rewrite", "replacement"])("rejects delayed slide responses after %s", async change => {
  let release!: (value: unknown) => void; let entered!: () => void;
  const started = new Promise<void>(resolve => entered = resolve);
  const delayed = new Promise(resolve => release = resolve);
  const provider = new MockAiGenerationProvider();
  let delayedInput!: SlideRegenerationInput;
  provider.regenerateSlide = vi.fn().mockImplementationOnce((input: SlideRegenerationInput) => { delayedInput = input; entered(); return delayed; }).mockImplementation(input => mock.regenerateSlide(input));
  await start(provider); const before = await generate("deepseek"); const requestId = randomUUID();
  const pending = suggest(0, "deepseek", { requestId }); await started;
  if (change === "discard") await post(pathFor(before.presentation.id, "regeneration-discard"), { requestId });
  else if (change === "newer-request") expect((await suggest(1, "deepseek")).status).toBe(200);
  else if (change === "edit") await post(`/api/scripts/${before.script.id}/edit`, { revision: 1, title: "Atualizado", plannedSlides: before.script.plannedSlides });
  else if (change === "rewrite") {
    const suggestion = await (await post(`/api/scripts/${before.script.id}/rewrite`, { revision: 1, target: { field: "scriptTitle" }, operation: "expand" })).json();
    await post(`/api/scripts/${before.script.id}/rewrite-accept`, { suggestionId: suggestion.suggestionId });
  } else await generate("deepseek");
  const current = await state();
  release(await mock.regenerateSlide(delayedInput));
  expect((await pending).status).toBe(409);
  expect(await state()).toEqual(current);
  expect((await post(pathFor(before.presentation.id, "regeneration-accept"), { requestId })).status).toBe(409);
});
it("invalidates an existing suggestion when a new complete presentation replaces it", async () => {
  await start(); const before = await generate(); const suggestion = await (await suggest()).json();
  const replacement = await generate();
  expect(replacement.presentation.id).not.toBe(before.presentation.id);
  expect(replacement.presentationRevision).toBe(1);
  expect((await post(pathFor(before.presentation.id, "regeneration-accept"), { requestId: suggestion.requestId })).status).toBe(409);
  expect(await state()).toEqual(replacement);
});
