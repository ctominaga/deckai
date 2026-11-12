import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewServer } from "../src/dev-preview/server.js";
import type { AiGenerationProvider } from "../src/providers/ai-generation-provider.js";
import { presentationMetadata } from "../src/providers/gemini-presentation-contract.js";
import { generateScript } from "../src/services/generation.service.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import type { Script } from "../src/schemas/script.schema.js";
import type { Presentation } from "../src/schemas/presentation.schema.js";
import { geminiSlides } from "./support/gemini-fixtures.js";

const originalFetch = globalThis.fetch;
const allowedLayouts = ["cover", "text_image", "two_columns", "metrics", "case", "closing"];
let server: Server | undefined;
let baseUrl: string;

beforeEach(() => {
  vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI", "true");
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname !== "127.0.0.1") throw new Error("External network forbidden in tests");
    return originalFetch(input, init);
  });
});
afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function fakeProvider(): AiGenerationProvider {
  return {
    generateScriptProposal: vi.fn(async (briefing) => generateScript(briefing)),
    generatePresentation: vi.fn(async (script) => ({
      ...presentationMetadata(script),
      slides: geminiSlides(script),
    })),
  };
}

async function start(
  provider = fakeProvider(),
  createProvider = vi.fn(() => provider),
) {
  server = createPreviewServer(createProvider);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { provider, createProvider };
}

function post(path: string, body: unknown = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getState() {
  return (await (await fetch(`${baseUrl}/api/state`)).json()) as {
    provider: "mock" | "gemini" | null;
    scriptEdited: boolean;
    script: Script | null;
    presentation: Presentation | null;
    presentationProvider: "mock" | "gemini" | null;
    briefing: unknown;
  };
}

async function draft(provider: "mock" | "gemini" = "gemini") {
  const response = await post("/api/scripts", { ...briefingMock, provider });
  expect(response.status).toBe(201);
  return (await response.json()).script as Script;
}

async function edit(script: Script, changes: Partial<Pick<Script, "title" | "plannedSlides">>) {
  return post(`/api/scripts/${script.id}/edit`, {
    revision: script.revision,
    title: changes.title ?? script.title,
    plannedSlides: changes.plannedSlides ?? script.plannedSlides,
  });
}

async function approve(script: Script) {
  return post(`/api/scripts/${script.id}/approve`, { revision: script.revision });
}

describe("manual script editing", () => {
  it("edits the general title and a slide title/objective while preserving other fields", async () => {
    await start();
    const original = await draft();
    const slides = structuredClone(original.plannedSlides);
    slides[1].title = "Título revisado";
    slides[1].objective = "Objetivo revisado";
    const response = await edit(original, { title: "Novo título geral", plannedSlides: slides });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.script).toMatchObject({
      title: "Novo título geral",
      status: "draft",
      revision: 2,
      plannedSlides: [
        original.plannedSlides[0],
        { ...original.plannedSlides[1], title: "Título revisado", objective: "Objetivo revisado" },
        ...original.plannedSlides.slice(2),
      ],
    });
    expect(body.scriptEdited).toBe(true);
    expect(body.provider).toBe("gemini");
  });

  it("supports changing, adding and removing a topic without changing other topics", async () => {
    await start();
    const original = await draft();
    const slides = structuredClone(original.plannedSlides);
    const originalSecondSlideTopics = [...slides[1].keyPoints];
    slides[0].keyPoints[0] = "Tópico atualizado";
    slides[0].keyPoints.push("Tópico adicionado");
    slides[1].keyPoints.splice(0, 1);
    const response = await edit(original, { plannedSlides: slides });
    expect(response.status).toBe(200);
    const saved = (await response.json()).script as Script;
    expect(saved.plannedSlides[0].keyPoints).toEqual([
      "Tópico atualizado",
      ...original.plannedSlides[0].keyPoints.slice(1),
      "Tópico adicionado",
    ]);
    expect(saved.plannedSlides[1].keyPoints).toEqual(originalSecondSlideTopics.slice(1));
  });

  it("accepts only known layouts and preserves slide IDs, count and order", async () => {
    await start();
    const original = await draft();
    const slides = structuredClone(original.plannedSlides);
    slides[0].layout = "case";
    const changedLayout = await edit(original, { plannedSlides: slides });
    expect(changedLayout.status).toBe(200);
    const changed = (await changedLayout.json()).script as Script;
    expect(changed.plannedSlides.map(({ id }) => id)).toEqual(original.plannedSlides.map(({ id }) => id));
    expect(changed.plannedSlides.map(({ layout }) => layout)[0]).toBe("case");
    expect(allowedLayouts).toContain(changed.plannedSlides[0].layout);

    const invalidLayout = structuredClone(changed.plannedSlides);
    (invalidLayout[0] as { layout: string }).layout = "unknown";
    expect((await edit(changed, { plannedSlides: invalidLayout })).status).toBe(400);

    const reordered = structuredClone(changed.plannedSlides);
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    expect((await edit(changed, { plannedSlides: reordered })).status).toBe(400);
    expect((await edit(changed, { plannedSlides: changed.plannedSlides.slice(1) })).status).toBe(400);
    expect((await approve(changed)).status).toBe(200);
    const generated = await post(`/api/scripts/${changed.id}/presentation`, { revision: changed.revision });
    expect(generated.status).toBe(201);
    expect((await generated.json()).presentation.slides[0]).toMatchObject({
      id: changed.plannedSlides[0].id,
      layout: "case",
      title: changed.plannedSlides[0].title,
    });
  });

  it("rejects invalid text and empty topics atomically", async () => {
    const { provider } = await start();
    const original = await draft();
    await approve(original);
    expect((await post(`/api/scripts/${original.id}/presentation`, { revision: original.revision })).status).toBe(201);
    const beforeInvalidEdits = await getState();
    const invalidSlides = structuredClone(original.plannedSlides);
    invalidSlides[0].objective = " ";
    expect((await edit(original, { title: " ", plannedSlides: invalidSlides })).status).toBe(400);
    const noTopics = structuredClone(original.plannedSlides);
    noTopics[0].keyPoints = [];
    expect((await edit(original, { plannedSlides: noTopics })).status).toBe(400);
    expect(await getState()).toEqual(beforeInvalidEdits);
    expect(provider.generatePresentation).toHaveBeenCalledTimes(1);
  });

  it("increments revision, clears previous approval and presentation, and requires reapproval", async () => {
    const { provider } = await start();
    const initial = await draft();
    expect((await approve(initial)).status).toBe(200);
    expect((await post(`/api/scripts/${initial.id}/presentation`, { revision: initial.revision })).status).toBe(201);
    const approvedPresentation = (await getState()).presentation;
    expect(approvedPresentation).not.toBeNull();

    const nextSlides = structuredClone(initial.plannedSlides);
    nextSlides[0].title = "Após aprovação";
    const savedResponse = await edit(initial, { plannedSlides: nextSlides });
    expect(savedResponse.status).toBe(200);
    const saved = (await savedResponse.json()).script as Script;
    expect(saved.revision).toBe(initial.revision + 1);
    expect(saved.status).toBe("draft");
    expect(await getState()).toMatchObject({
      script: saved,
      scriptEdited: true,
      presentation: null,
      presentationProvider: null,
      provider: "gemini",
    });
    expect((await post(`/api/scripts/${saved.id}/presentation`, { revision: saved.revision })).status).toBe(409);
    expect(provider.generatePresentation).toHaveBeenCalledTimes(1);
    expect((await approve(saved)).status).toBe(200);
    const generated = await post(`/api/scripts/${saved.id}/presentation`, { revision: saved.revision });
    expect(generated.status).toBe(201);
    const presentation = (await generated.json()).presentation as Presentation;
    expect(presentation.slides.map(({ id, title, layout }) => ({ id, title, layout }))).toEqual(
      nextSlides.map(({ id, title, layout }) => ({ id, title, layout })),
    );
    expect(provider.generatePresentation).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: saved.revision, status: "approved", plannedSlides: nextSlides }),
      briefingMock,
    );
  });

  it("rejects stale revision edits without overwriting the latest content", async () => {
    await start();
    const original = await draft();
    const firstSlides = structuredClone(original.plannedSlides);
    firstSlides[0].title = "Versão atual";
    const first = await edit(original, { plannedSlides: firstSlides });
    expect(first.status).toBe(200);
    const latest = (await first.json()).script as Script;

    const staleSlides = structuredClone(original.plannedSlides);
    staleSlides[0].title = "Versão antiga";
    const stale = await edit(original, { plannedSlides: staleSlides });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/revisão/i);
    expect((await getState()).script).toEqual(latest);
  });

  it("does not allow a late presentation result to overwrite a saved newer revision", async () => {
    let releaseFirst!: (presentation: Presentation) => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const delayed = new Promise<Presentation>((resolve) => { releaseFirst = resolve; });
    const provider = fakeProvider();
    provider.generatePresentation = vi.fn()
      .mockImplementationOnce(async (script) => {
        firstStarted();
        return delayed.then((presentation) => ({
          ...presentation,
          ...presentationMetadata(script),
          slides: geminiSlides(script),
        }));
      })
      .mockImplementation(async (script) => ({
        ...presentationMetadata(script),
        slides: geminiSlides(script),
      }));
    await start(provider);
    const firstDraft = await draft();
    await approve(firstDraft);
    const oldRequest = post(`/api/scripts/${firstDraft.id}/presentation`, { revision: firstDraft.revision });
    await started;
    const slides = structuredClone(firstDraft.plannedSlides);
    slides[0].title = "Revisão recente";
    const editResponse = await edit(firstDraft, { plannedSlides: slides });
    const edited = (await editResponse.json()).script as Script;
    await approve(edited);
    const newRequest = post(`/api/scripts/${edited.id}/presentation`, { revision: edited.revision });
    expect((await newRequest).status).toBe(201);
    releaseFirst({
      ...presentationMetadata(firstDraft),
      slides: geminiSlides({ ...firstDraft, status: "approved" }),
    });
    expect((await oldRequest).status).toBe(409);
    expect((await getState()).presentation?.slides[0].title).toBe("Revisão recente");
  });

  it("keeps the original Mock workflow and marks its manual edits accurately", async () => {
    const { createProvider } = await start();
    const initial = await draft("mock");
    const slides = structuredClone(initial.plannedSlides);
    slides[0].keyPoints[0] = "Tópico Mock personalizado";
    const saveResponse = await edit(initial, { title: "Roteiro Mock editado", plannedSlides: slides });
    const edited = (await saveResponse.json()).script as Script;
    expect(createProvider).not.toHaveBeenCalled();
    expect(await getState()).toMatchObject({ provider: "mock", scriptEdited: true });

    expect((await approve(edited)).status).toBe(200);
    const generated = await post(`/api/scripts/${edited.id}/presentation`, { revision: edited.revision });
    expect(generated.status).toBe(201);
    expect((await generated.json()).provider).toBe("mock");
    expect(createProvider).not.toHaveBeenCalled();
  });
});
