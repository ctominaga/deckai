import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import { assertGeminiEnabled, GeminiOutlineGenerationProvider } from "../providers/gemini-outline-generation.provider.js";
import { assertDeepSeekEnabled, DeepSeekGenerationProvider } from "../providers/deepseek-generation.provider.js";
import type { AiGenerationProvider } from "../providers/ai-generation-provider.js";
import { briefingSchema } from "../schemas/briefing.schema.js";
import type { Briefing } from "../schemas/briefing.schema.js";
import { MockAiGenerationProvider } from "../providers/mock-ai-generation.provider.js";
import { AiGenerationService } from "../services/ai-generation.service.js";
import { updateScript } from "../services/generation.service.js";
import { GenerationFailure, logGenerationDiagnostic } from "../services/generation-diagnostics.js";
import type { Presentation } from "../schemas/presentation.schema.js";
import { scriptEditRequestSchema } from "../schemas/script.schema.js";
import { adaptPresentation } from "../integration/presentation-adapter.js";
import type { Script } from "../schemas/script.schema.js";
import { rewriteRequestSchema, suggestionActionSchema, type RewriteTarget } from "../schemas/rewrite.schema.js";
import { applyRewrite, prepareRewrite, selectedText, validateRewrite, type AiRewriteProvider } from "../services/rewrite.service.js";
import { regenerationRequestSchema, regenerationActionSchema } from "../schemas/slide-regeneration.schema.js";
import { applyRegeneratedSlide, prepareSlideRegeneration, suggestSlideRegeneration, type SlideRegenerationInput } from "../services/slide-regeneration.service.js";
import type { Slide } from "../schemas/presentation.schema.js";

const maxRequestBytes = 32 * 1024;
const scriptRequestSchema = briefingSchema.extend({
  provider: z.enum(["mock", "gemini", "deepseek"]).default("mock"),
});
const actionRequestSchema = z.object({ revision: z.number().int().positive().optional() }).strict();
const previewDirectory = new URL("./", import.meta.url);
const assets = new Map([
  ["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
]);

interface PreviewState {
  provider: "mock" | "gemini" | "deepseek" | null;
  scriptEdited: boolean;
  script: Script | null;
  presentation: Presentation | null;
  presentationRevision: number | null;
  regenerationRequestId: string | null;
  regenerationSequence: number;
  regenerationSuggestion: { requestId: string; generation: number; input: SlideRegenerationInput; slide: Slide; expires: number } | null;
  generation: number;
  briefing: Briefing | null;
  presentationProvider: "mock" | "gemini" | "deepseek" | null;
  approval: { scriptId: string; revision: number; snapshot: string } | null;
  outlinePending: boolean;
  pendingPresentations: Set<string>;
  suggestions: Map<string, { scriptId: string; revision: number; generation: number; target: RewriteTarget; original: string; text: string; expires: number }>;
  rewriteRequests: Map<string, string>;
}

export function createPreviewServer(
  createGeminiProvider: () => AiGenerationProvider = () => new GeminiOutlineGenerationProvider(),
  createDeepSeekProvider: () => AiGenerationProvider = () => new DeepSeekGenerationProvider(),
): Server {
  const generationService = new AiGenerationService(
    new MockAiGenerationProvider(),
  );
  let geminiService: AiGenerationService | undefined;
  const getGeminiService = () => {
    assertGeminiEnabled();
    geminiService ??= new AiGenerationService(createGeminiProvider());
    return geminiService;
  };
  let deepSeekService: AiGenerationService | undefined;
  let deepSeekProvider: AiGenerationProvider | undefined;
  const getDeepSeekProvider = () => {
    assertDeepSeekEnabled();
    return deepSeekProvider ??= createDeepSeekProvider();
  };
  const getRewriteProvider = (): AiRewriteProvider => {
    const provider = state.provider === "mock" ? new MockAiGenerationProvider() : getDeepSeekProvider();
    if (!provider.suggestRewrite) throw new Error("O provedor não oferece reescrita de campos.");
    return { suggestRewrite: provider.suggestRewrite.bind(provider) };
  };
  const getService = (provider: PreviewState["provider"]) => {
    if (provider === "gemini") return getGeminiService();
    if (provider === "deepseek") {
      assertDeepSeekEnabled();
      deepSeekService ??= new AiGenerationService(getDeepSeekProvider());
      return deepSeekService;
    }
    if (provider === "mock") return generationService;
    throw new Error("Provedor de geração não definido. Gere um novo roteiro.");
  };
  const state: PreviewState = {
    provider: null,
    scriptEdited: false,
    script: null,
    presentation: null,
    presentationRevision: null,
    regenerationRequestId: null,
    regenerationSequence: 0,
    regenerationSuggestion: null,
    generation: 0,
    briefing: null,
    presentationProvider: null,
    approval: null,
    outlinePending: false,
    pendingPresentations: new Set(),
    suggestions: new Map(),
    rewriteRequests: new Map(),
  };

  return createServer((request, response) => {
    void handleRequest(request, response, generationService, state, getService, getRewriteProvider, getDeepSeekProvider).catch(
      (error: unknown) => {
        sendError(
          response,
          500,
          error instanceof Error
            ? error.message
            : "Erro interno ao processar a solicitação.",
        );
      },
    );
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  generationService: AiGenerationService,
  state: PreviewState,
  getService: (provider: PreviewState["provider"]) => AiGenerationService,
  getRewriteProvider: () => AiRewriteProvider,
  getDeepSeekProvider: () => AiGenerationProvider,
): Promise<void> {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

  if (method === "GET" && pathname === "/api/presentation/shared") {
    if (!state.presentation) {
      sendError(response, 409, "Gere uma apresentação aprovada antes de consultar o contrato oficial.");
      return;
    }
    try {
      // Explicit local theme configuration; not a claim of an approved institutional kit.
      sendJson(response, 200, adaptPresentation(state.presentation, "jump-default"));
    } catch (error) {
      sendWorkflowError(response, error);
    }
    return;
  }

  if (method === "GET" && pathname === "/api/state") {
    sendJson(response, 200, {
      provider: state.provider,
      scriptEdited: state.scriptEdited,
      presentationProvider: state.presentationProvider,
      briefing: state.briefing,
      script: state.script,
      presentation: state.presentation,
      presentationRevision: state.presentationRevision,
    });
    return;
  }

  if (method === "GET") {
    await serveAsset(pathname, response);
    return;
  }

  if (method !== "POST") {
    sendError(response, 405, "Método não permitido.");
    return;
  }

  const regenerationRoute = pathname.match(/^\/api\/presentations\/([^/]+)\/(regenerate-slide|regeneration-accept|regeneration-discard)$/);
  if (regenerationRoute) {
    try {
      const body = await readJsonBody(request);
      const presentationId = decodeURIComponent(regenerationRoute[1]);
      const action = regenerationRoute[2];
      const presentation = state.presentation;
      const script = state.script;
      if (!presentation || presentation.id !== presentationId || !state.presentationRevision || !script || !state.briefing ||
          script.status !== "approved" || state.approval?.scriptId !== script.id ||
          state.approval.revision !== script.revision || state.approval.snapshot !== JSON.stringify(script)) {
        throw new RequestError(409, "A regeneração exige uma apresentação válida e seu roteiro aprovado correspondente.");
      }
      if (action === "regenerate-slide") {
        const request = regenerationRequestSchema.parse(body);
        if (request.revision !== state.presentationRevision) throw new RequestError(409, "A revisão da apresentação mudou. Atualize a página e solicite uma nova versão.");
        if (request.provider === "gemini") throw new RequestError(400, "Regeneração individual com Gemini não está disponível. Selecione DeepSeek ou Mock.");
        const input = prepareSlideRegeneration(presentation, state.presentationRevision, script, state.briefing, request);
        const provider = request.provider === "mock" ? new MockAiGenerationProvider() : getDeepSeekProvider();
        if (!provider.regenerateSlide) throw new RequestError(400, "O provedor selecionado não oferece regeneração individual.");
        const requestId = request.requestId ?? randomUUID();
        const sequence = ++state.regenerationSequence;
        const generation = state.generation;
        state.regenerationRequestId = requestId;
        state.regenerationSuggestion = null;
        try {
          const slide = await suggestSlideRegeneration({ regenerateSlide: provider.regenerateSlide.bind(provider) }, input);
          if (state.generation !== generation || state.presentation !== presentation || state.script !== script ||
              state.presentationRevision !== input.revision || state.regenerationRequestId !== requestId || state.regenerationSequence !== sequence) {
            throw new RequestError(409, "A resposta ficou desatualizada ou foi descartada. Solicite uma nova versão.");
          }
          state.regenerationSuggestion = { requestId, generation, input, slide, expires: Date.now() + 10 * 60_000 };
          sendJson(response, 200, { requestId, presentationId, revision: input.revision, original: input.currentSlide, slide, provider: request.provider });
        } finally {
          if (state.regenerationRequestId === requestId && state.regenerationSequence === sequence) state.regenerationRequestId = null;
        }
        return;
      }
      const { requestId } = regenerationActionSchema.parse(body);
      if (action === "regeneration-discard") {
        if (state.regenerationRequestId === requestId) state.regenerationRequestId = null;
        if (state.regenerationSuggestion?.requestId === requestId) state.regenerationSuggestion = null;
        sendJson(response, 200, { discarded: true });
        return;
      }
      const suggestion = state.regenerationSuggestion;
      if (!suggestion || suggestion.requestId !== requestId || suggestion.expires < Date.now() ||
          suggestion.generation !== state.generation || suggestion.input.presentationId !== presentationId ||
          suggestion.input.revision !== state.presentationRevision) {
        throw new RequestError(409, "A sugestão expirou ou a revisão da apresentação mudou. Atualize a página e solicite uma nova versão.");
      }
      const updated = applyRegeneratedSlide(presentation, script, suggestion.input, suggestion.slide);
      state.presentation = updated;
      state.presentationRevision++;
      state.regenerationSuggestion = null;
      state.regenerationRequestId = null;
      sendJson(response, 200, { presentation: updated, presentationRevision: state.presentationRevision, provider: state.presentationProvider });
    } catch (error) { sendWorkflowError(response, error); }
    return;
  }

  if (pathname === "/api/scripts") {
    if (state.outlinePending) {
      sendError(response, 409, "Já existe uma geração de roteiro em andamento. Aguarde.");
      return;
    }
    state.outlinePending = true;
    const generation = ++state.generation;
    clearWorkflow(state);

    try {
      const { provider, ...briefing } = scriptRequestSchema.parse(await readJsonBody(request));
      const outlineService = getService(provider);
      const proposal = await outlineService.generateScriptProposal(briefing);
      const script = { ...proposal, id: randomUUID() };
      if (generation !== state.generation) {
        sendError(response, 409, "Um briefing mais recente substituiu este.");
        return;
      }

      state.script = script;
      state.provider = provider;
      state.scriptEdited = false;
      state.briefing = briefing;
      sendJson(response, 201, { script, provider, scriptEdited: false });
    } catch (error) {
      sendWorkflowError(response, error);
    } finally {
      state.outlinePending = false;
    }
    return;
  }

  if (pathname === "/api/briefing/invalidate") {
    try {
      const body = z.object({ scriptId: z.string().min(1) }).strict().parse(await readJsonBody(request));
      if (body.scriptId !== state.script?.id) {
        throw new RequestError(409, "Este roteiro não é o briefing atual.");
      }
      ++state.generation;
      clearWorkflow(state);
      sendJson(response, 200, { invalidated: true });
    } catch (error) {
      sendWorkflowError(response, error);
    }
    return;
  }

  const routeMatch = pathname.match(
    /^\/api\/scripts\/([^/]+)\/(edit|approve|presentation|rewrite|rewrite-accept|rewrite-discard)$/,
  );
  if (routeMatch === null) {
    sendError(response, 404, "Rota não encontrada.");
    return;
  }

  const [, encodedScriptId, action] = routeMatch;
  const scriptId = decodeURIComponent(encodedScriptId);
  if (action?.startsWith("rewrite")) {
    try {
      const body = await readJsonBody(request);
      const script = state.script;
      if (!script || script.id !== scriptId || !state.briefing) throw new RequestError(409, "Este roteiro não é o briefing atual.");
      // Prune transient tokens without touching the saved workflow.
      for (const [id, suggestion] of state.suggestions) if (suggestion.expires < Date.now()) state.suggestions.delete(id);
      if (action === "rewrite") {
        const input = rewriteRequestSchema.parse(body);
        if (input.revision !== script.revision) throw new RequestError(409, "A revisão mudou. Solicite uma nova sugestão para a revisão atual.");
        const context = prepareRewrite(script, state.briefing, input);
        const generation = state.generation;
        const key = JSON.stringify(input.target);
        const requestId = randomUUID();
        // Bound transient memory and supersede older suggestions for this field.
        if (state.rewriteRequests.size >= 20 && !state.rewriteRequests.has(key)) throw new RequestError(429, "Há muitas sugestões em andamento. Aguarde ou salve uma revisão.");
        state.rewriteRequests.set(key, requestId);
        for (const [id, suggestion] of state.suggestions) if (JSON.stringify(suggestion.target) === key) state.suggestions.delete(id);
        try {
          const result = await getRewriteProvider().suggestRewrite(context);
          if (state.generation !== generation || state.script?.id !== scriptId || state.script.revision !== script.revision ||
              selectedText(state.script, input.target) !== context.original || state.rewriteRequests.get(key) !== requestId) {
            throw new RequestError(409, "A sugestão ficou desatualizada. Solicite uma nova sugestão.");
          }
          const text = validateRewrite(result, input.target, context);
          const suggestionId = randomUUID();
          if (state.suggestions.size >= 20) state.suggestions.delete(state.suggestions.keys().next().value!);
          state.suggestions.set(suggestionId, { scriptId, revision: script.revision, generation, target: input.target,
            original: context.original, text, expires: Date.now() + 10 * 60_000 });
          sendJson(response, 200, { suggestionId, original: context.original, text, target: input.target, revision: script.revision,
            provider: state.provider === "mock" ? "mock" : "deepseek" });
        } finally {
          if (state.rewriteRequests.get(key) === requestId) state.rewriteRequests.delete(key);
        }
        return;
      }
      const { suggestionId } = suggestionActionSchema.parse(body);
      const suggestion = state.suggestions.get(suggestionId);
      if (action === "rewrite-discard") {
        state.suggestions.delete(suggestionId);
        sendJson(response, 200, { discarded: true });
        return;
      }
      if (!suggestion || suggestion.scriptId !== scriptId || suggestion.generation !== state.generation ||
          suggestion.revision !== script.revision || selectedText(script, suggestion.target) !== suggestion.original) {
        throw new RequestError(409, "A sugestão expirou ou a revisão mudou. Atualize a página e solicite uma nova sugestão.");
      }
      const edited = applyRewrite(script, suggestion.target, suggestion.text);
      ++state.generation;
      state.script = edited;
      state.scriptEdited = true;
      state.approval = null;
      state.presentation = null;
      invalidateSlideRegeneration(state);
      state.presentationProvider = null;
      state.suggestions.clear();
      state.rewriteRequests.clear();
      sendJson(response, 200, { script: edited, provider: state.provider, scriptEdited: true });
    } catch (error) { sendWorkflowError(response, error); }
    return;
  }
  let expectedRevision: number | undefined;
  let editRequest: ReturnType<typeof scriptEditRequestSchema.parse> | undefined;
  try {
    if (action === "edit") {
      editRequest = scriptEditRequestSchema.parse(await readJsonBody(request));
      expectedRevision = editRequest.revision;
    } else {
      ({ revision: expectedRevision } = actionRequestSchema.parse(await readJsonBody(request)));
    }
  } catch (error) {
    sendWorkflowError(response, error);
    return;
  }
  if (state.script === null || state.script.id !== scriptId) {
    sendApprovalError(
      response,
      "SCRIPT_NOT_CURRENT",
      "Este roteiro não é o briefing atual. Gere um novo roteiro antes de continuar.",
    );
    return;
  }
  if (expectedRevision !== undefined && state.script.revision !== expectedRevision) {
    sendApprovalError(response, "STALE_REVISION", "A revisão do roteiro mudou. Gere e aprove a revisão atual.");
    return;
  }

  if (action === "edit") {
    try {
      if (editRequest === undefined) {
        throw new RequestError(400, "A edição do roteiro é obrigatória.");
      }
      const editedScript = updateScript(state.script, editRequest);
      ++state.generation;
      state.script = editedScript;
      state.scriptEdited = true;
      state.approval = null;
      state.presentation = null;
      invalidateSlideRegeneration(state);
      state.presentationProvider = null;
      state.suggestions.clear();
      state.rewriteRequests.clear();
      sendJson(response, 200, {
        script: editedScript,
        provider: state.provider,
        scriptEdited: true,
      });
    } catch (error) {
      sendWorkflowError(response, error);
    }
    return;
  }

  if (action === "approve") {
    if (state.script.status === "approved") {
      sendError(response, 409, "Este roteiro já foi aprovado.");
      return;
    }

    state.script = generationService.approveScript(state.script);
    state.approval = {
      scriptId: state.script.id,
      revision: state.script.revision,
      snapshot: JSON.stringify(state.script),
    };
    state.presentation = null;
    invalidateSlideRegeneration(state);
    sendJson(response, 200, {
      script: state.script,
      provider: state.provider,
      scriptEdited: state.scriptEdited,
    });
    return;
  }

  if (state.script.status !== "approved" ||
      state.approval?.scriptId !== scriptId ||
      state.approval.revision !== state.script.revision ||
      state.approval.snapshot !== JSON.stringify(state.script)) {
    sendApprovalError(
      response,
      "APPROVAL_REQUIRED",
      "Aprove o roteiro antes de gerar a apresentação.",
    );
    return;
  }

  const script = state.script;
  const provider = state.provider;
  const generation = state.generation;
  const operationKey = `${scriptId}:${script.revision}`;
  if (state.pendingPresentations.has(operationKey) || state.presentation !== null) {
    sendError(response, 409, "A apresentação já foi gerada ou está em processamento. Aguarde ou gere um novo roteiro.");
    return;
  }
  state.pendingPresentations.add(operationKey);

  try {
    const service = getService(provider);
    const presentation = await service.generatePresentation(
      script, state.briefing ?? undefined,
    );
    if (state.generation !== generation || state.script?.id !== scriptId ||
        state.script.revision !== script.revision || state.script.status !== "approved" ||
        state.approval?.snapshot !== JSON.stringify(state.script)) {
      sendError(
        response,
        409,
        "O briefing mudou durante a geração. Gere e aprove o roteiro atual.",
      );
      return;
    }

    state.presentation = presentation;
    invalidateSlideRegeneration(state);
    state.presentationRevision = 1;
    state.presentationProvider = provider;
    sendJson(response, 201, {
      presentation,
      presentationRevision: state.presentationRevision,
      provider,
      scriptEdited: state.scriptEdited,
    });
  } catch (error) {
    sendWorkflowError(response, error);
  } finally {
    state.pendingPresentations.delete(operationKey);
  }
}

function clearWorkflow(state: PreviewState): void {
  invalidateSlideRegeneration(state);
  state.suggestions.clear();
  state.rewriteRequests.clear();
  state.script = null;
  state.presentation = null;
  state.provider = null;
  state.scriptEdited = false;
  state.presentationProvider = null;
  state.briefing = null;
  state.approval = null;
}

function invalidateSlideRegeneration(state: PreviewState): void {
  ++state.regenerationSequence;
  state.presentationRevision = null;
  state.regenerationRequestId = null;
  state.regenerationSuggestion = null;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxRequestBytes) {
      throw new RequestError(413, "A solicitação excede o limite de tamanho.");
    }
    chunks.push(buffer);
  }

  if (!request.headers["content-type"]?.includes("application/json")) {
    throw new RequestError(
      415,
      "Content-Type deve ser application/json.",
    );
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "O corpo da solicitação não contém JSON válido.");
  }
}

async function serveAsset(
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const asset = assets.get(pathname);
  if (asset === undefined) {
    sendError(response, 404, "Recurso não encontrado.");
    return;
  }

  const content = await readFile(new URL(asset.file, previewDirectory));
  response.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(content);
}

function sendWorkflowError(response: ServerResponse, error: unknown): void {
  logGenerationDiagnostic(error instanceof GenerationFailure ? error.diagnostic : {
    stage: error instanceof ZodError || error instanceof RequestError ? "http.input" : "http.workflow",
    origin: "local",
    category: error instanceof ZodError || error instanceof RequestError ? "local_validation" : "workflow",
    code: error instanceof ZodError ? "INVALID_REQUEST" : error instanceof RequestError ? "INVALID_HTTP_REQUEST" : "WORKFLOW_ERROR",
  });
  if (error instanceof RequestError) {
    sendError(response, error.statusCode, error.message);
    return;
  }

  if (error instanceof ZodError) {
    sendError(
      response,
      400,
      error.issues
        .map((issue) => {
          const path =
            issue.path.length > 0 ? issue.path.join(".") : "briefing";
          return `${path}: ${issue.message}`;
        })
        .join("; "),
    );
    return;
  }

  sendError(
    response,
    400,
    error instanceof Error ? error.message : "Não foi possível concluir a operação.",
  );
}

function sendApprovalError(
  response: ServerResponse,
  code: "SCRIPT_NOT_CURRENT" | "STALE_REVISION" | "APPROVAL_REQUIRED",
  message: string,
): void {
  logGenerationDiagnostic({ stage: "http.approval", origin: "local", category: "approval", code });
  sendError(response, 409, message);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  message: string,
): void {
  sendJson(response, statusCode, { error: message });
}

class RequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

async function startPreviewServer(): Promise<void> {
  const rawPort = process.env.PREVIEW_PORT ?? "4173";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PREVIEW_PORT deve ser um inteiro entre 0 e 65535.");
  }

  const server = createPreviewServer();
  server.once("error", (error: NodeJS.ErrnoException) => {
    console.error(`Não foi possível iniciar o preview: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      console.error("O servidor iniciou sem um endereço TCP disponível.");
      process.exitCode = 1;
      server.close();
      return;
    }

    console.log(`DeckAI Dev Preview: http://127.0.0.1:${address.port}`);
    console.log("Mock por padrão. Gemini e DeepSeek exigem ativação no ambiente do backend, seleção explícita, aprovação e cliques de geração.");
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void startPreviewServer();
}
