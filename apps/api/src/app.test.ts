import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { createMemoryDatabase, type Database } from "./database.js";
import { runMigrations } from "./migrations.js";
import { hashPassword } from "./security.js";
import type { OutlineProvider } from "./ai-provider.js";
import { processNextExport } from "./export-worker.js";
import { renderPptx } from "./pptx-renderer.js";
import { loadPresentationImages } from "./presentation-images.js";

const resources: Array<{ app: Awaited<ReturnType<typeof buildApp>>; database: Database }> = [];
afterEach(async () => { while (resources.length) { const item = resources.pop()!; await item.app.close(); await item.database.close(); } });

async function setup(outlineProvider?: OutlineProvider) {
  const database = createMemoryDatabase();
  await runMigrations(database);
  const app = await buildApp(database, outlineProvider ? { outlineProvider } : {});
  resources.push({ app, database });
  return { app, database };
}

async function bootstrapAndLogin(app: Awaited<ReturnType<typeof buildApp>>) {
  await app.inject({ method: "POST", url: "/api/v1/bootstrap", payload: { organizationName: "Jump", name: "Gestor", email: "gestor@jump.local", password: "senha-segura-123" } });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "gestor@jump.local", password: "senha-segura-123" } });
  expect(login.statusCode).toBe(200);
  return `Bearer ${login.json().token as string}`;
}

const unusedProviderMethods: Pick<OutlineProvider, "generatePresentation" | "regenerateSlide" | "rewriteBlock"> = {
  async generatePresentation() { throw new Error("Chamada inesperada ao provedor no teste."); },
  async regenerateSlide() { throw new Error("Chamada inesperada ao provedor no teste."); },
  async rewriteBlock() { throw new Error("Chamada inesperada ao provedor no teste."); }
};

describe("imagens privadas", () => {
  it("persiste imagens válidas e restringe acesso à organização", async () => {
    const { app, database } = await setup();
    const url = "/api/v1/assets/images";
    const authorization = await bootstrapAndLogin(app);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=", "base64");
    const headers = { authorization, "content-type": "image/png", "x-asset-name": "exemplo.png" };
    expect((await app.inject({ method: "POST", url, headers, payload: Buffer.from("texto") })).json().error.code).toBe("IMAGE_SIGNATURE_INVALID");
    const unsupported = await app.inject({ method: "POST", url, headers: { authorization, "content-type": "image/svg+xml" }, payload: "<svg/>" });
    expect(unsupported.statusCode).toBe(415);
    const oversized = await app.inject({ method: "POST", url, headers, payload: Buffer.alloc(5 * 1024 * 1024 + 1) });
    expect(oversized.statusCode).toBe(413);

    const uploaded = await app.inject({ method: "POST", url, headers, payload: png });
    expect(uploaded.statusCode).toBe(201);
    const { asset } = uploaded.json();
    expect(asset).toMatchObject({ mediaType: "image/png", sizeBytes: png.length, name: "exemplo.png" });
    expect((await app.inject({ method: "GET", url, headers: { authorization } })).json()).toEqual({ items: [asset], nextCursor: null });
    expect((await app.inject({ method: "GET", url: `${url}?after=${asset.id}`, headers: { authorization } })).json().items).toEqual([]);
    const download = await app.inject({ method: "GET", url: `${url}/${asset.id}`, headers: { authorization } });
    expect(download.statusCode).toBe(200);
    expect(download.headers["cache-control"]).toBe("private, no-store");
    expect(download.rawPayload).toEqual(png);
    expect((await app.inject({ method: "GET", url: `${url}/${asset.id}` })).statusCode).toBe(401);

    const otherOrg = randomUUID();
    await database.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Outra','outra-imagens')", [otherOrg]);
    await database.query("INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES($1,$2,'Outra pessoa','outra@jump.local',$3,'viewer')", [randomUUID(), otherOrg, await hashPassword("senha-segura-456")]);
    const otherLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "outra@jump.local", password: "senha-segura-456" } });
    expect(otherLogin.statusCode).toBe(200);
    const otherHeaders = { authorization: `Bearer ${otherLogin.json().token}` };
    expect((await app.inject({ method: "GET", url, headers: otherHeaders })).json().items).toEqual([]);
    expect((await app.inject({ method: "GET", url: `${url}/${asset.id}`, headers: otherHeaders })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers: { ...headers, ...otherHeaders }, payload: png })).statusCode).toBe(403);

    const presentation = await app.inject({ method: "POST", url: "/api/v1/presentations", headers: { authorization }, payload: { title: "Imagem no slide" } });
    expect(presentation.statusCode).toBe(201);
    const path = `/api/v1/presentations/${presentation.json().presentationId}`;
    const opened = await app.inject({ method: "GET", url: path, headers: { authorization } });
    const { draft } = opened.json();
    draft.content.slides[0].blocks.push({ id: randomUUID(), type: "image", role: "illustration", assetId: asset.id, alt: "Imagem de teste" });
    const save = await app.inject({ method: "PUT", url: `${path}/draft`, headers: { authorization },
      payload: { baseVersionId: draft.baseVersionId, expectedRevision: draft.revision, clientMutationId: randomUUID(), content: draft.content } });
    expect(save.statusCode).toBe(200);
    expect((await loadPresentationImages(database, draft.content, otherOrg)).size).toBe(0);
    const preview = await app.inject({ method: "GET", url: `${path}/preview`, headers: { authorization } });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain(`src="data:image/png;base64,${png.toString("base64")}"`);
    const checkpoint = await app.inject({ method: "POST", url: `${path}/checkpoints`, headers: { authorization },
      payload: { baseVersionId: draft.baseVersionId, draftRevision: save.json().revision, clientMutationId: randomUUID() } });
    expect(checkpoint.statusCode).toBe(201);
    const requested = await app.inject({ method: "POST", url: `${path}/exports/pptx`, headers: { authorization },
      payload: { versionId: checkpoint.json().id, idempotencyKey: randomUUID() } });
    expect(requested.statusCode).toBe(202);
    expect(await processNextExport(database, "pptx", renderPptx)).toBe(true);
    const downloadPptx = await app.inject({ method: "GET", url: `/api/v1/exports/${requested.json().job.id}/download`, headers: { authorization } });
    expect(downloadPptx.statusCode).toBe(200);
    expect(downloadPptx.rawPayload.toString("latin1")).toMatch(/ppt\/media\/[^/]+\.png/);
  });
});

describe("primeira vertical slice", () => {
  it("aplica a migration de forma idempotente", async () => {
    const { database } = await setup();
    expect(await runMigrations(database)).toEqual([]);
    const result = await database.query<{ version: string }>("SELECT version FROM schema_migrations");
    expect(result.rows.map((row) => row.version)).toContain("001_initial.sql");
    const sql = await readFile("db/migrations/001_initial.sql", "utf8");
    const windowsSql = sql.replace(/\r?\n/g, "\r\n");
    const legacyChecksum = createHash("sha256").update(windowsSql).digest("hex");
    await database.query("UPDATE schema_migrations SET checksum=$1 WHERE version='001_initial.sql'", [legacyChecksum]);
    expect(await runMigrations(database)).toEqual([]);
    const alteredChecksum = createHash("sha256").update(windowsSql + "\r\nSELECT 1;").digest("hex");
    await database.query("UPDATE schema_migrations SET checksum=$1 WHERE version='001_initial.sql'", [alteredChecksum]);
    await expect(runMigrations(database)).rejects.toThrow("MIGRATION_CHECKSUM_MISMATCH:001_initial.sql");
  });

  it("cria organização, apresentação, autosave e checkpoint persistentes", async () => {
    const { app } = await setup();
    const authorization = await bootstrapAndLogin(app);
    const created = await app.inject({ method: "POST", url: "/api/v1/presentations", headers: { authorization }, payload: { title: "Proposta real" } });
    expect(created.statusCode).toBe(201);
    const presentationId = created.json().presentationId as string;
    const renamed = await app.inject({ method: "PATCH", url: `/api/v1/presentations/${presentationId}`, headers: { authorization }, payload: { title: "Proposta renomeada" } });
    expect(renamed.statusCode).toBe(200); expect(renamed.json().title).toBe("Proposta renomeada");
    const loaded = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization } });
    expect(loaded.statusCode).toBe(200);
    const payload = loaded.json();
    payload.draft.content.slides[0].blocks[0].text = "Título persistido";
    const autosave = await app.inject({ method: "PUT", url: `/api/v1/presentations/${presentationId}/draft`, headers: { authorization }, payload: { baseVersionId: payload.draft.baseVersionId, expectedRevision: payload.draft.revision, clientMutationId: randomUUID(), content: payload.draft.content } });
    expect(autosave.statusCode).toBe(200);
    expect(autosave.json().revision).toBe(2);
    const checkpoint = await app.inject({ method: "POST", url: `/api/v1/presentations/${presentationId}/checkpoints`, headers: { authorization }, payload: { baseVersionId: payload.draft.baseVersionId, draftRevision: 2, clientMutationId: randomUUID() } });
    expect(checkpoint.statusCode).toBe(201);
    expect(checkpoint.json().versionNumber).toBe(2);
    const history = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}/versions`, headers: { authorization } });
    expect(history.statusCode).toBe(200); expect(history.json().items).toHaveLength(2);
    const reloaded = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization } });
    expect(reloaded.json().draft.content.slides[0].blocks[0].text).toBe("Título persistido");
    const preview = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}/preview`, headers: { authorization } });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toContain("text/html");
    expect(preview.body).toContain("Título persistido");
  });

  it("rejeita autosave concorrente e esconde recursos de outra organização", async () => {
    const { app, database } = await setup();
    const authorization = await bootstrapAndLogin(app);
    const created = await app.inject({ method: "POST", url: "/api/v1/presentations", headers: { authorization }, payload: { title: "Restrita" } });
    const presentationId = created.json().presentationId as string;
    const loaded = (await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization } })).json();
    const first = { baseVersionId: loaded.draft.baseVersionId, expectedRevision: 1, clientMutationId: randomUUID(), content: loaded.draft.content };
    expect((await app.inject({ method: "PUT", url: `/api/v1/presentations/${presentationId}/draft`, headers: { authorization }, payload: first })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: `/api/v1/presentations/${presentationId}/draft`, headers: { authorization }, payload: { ...first, clientMutationId: randomUUID() } })).statusCode).toBe(409);

    const organizationId = randomUUID(), userId = randomUUID();
    await database.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Outra','outra')", [organizationId]);
    await database.query("INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES($1,$2,'Outro','outro@jump.local',$3,'owner')", [userId, organizationId, await hashPassword("senha-segura-456")]);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "outro@jump.local", password: "senha-segura-456" } });
    const otherAuthorization = `Bearer ${login.json().token as string}`;
    const forbidden = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization: otherAuthorization } });
    expect(forbidden.statusCode).toBe(404);
  });

  it("repete autosave antigo de forma idempotente e controla checkpoints concorrentes", async () => {
    const { app } = await setup(); const authorization = await bootstrapAndLogin(app);
    const created = await app.inject({ method: "POST", url: "/api/v1/presentations", headers: { authorization }, payload: { title: "Idempotente" } });
    const id = created.json().presentationId as string;
    const loaded = (await app.inject({ method: "GET", url: `/api/v1/presentations/${id}`, headers: { authorization } })).json();
    const mutationA = randomUUID();
    const requestA = { baseVersionId: loaded.draft.baseVersionId, expectedRevision: 1, clientMutationId: mutationA, content: loaded.draft.content };
    const first = await app.inject({ method: "PUT", url: `/api/v1/presentations/${id}/draft`, headers: { authorization }, payload: requestA });
    expect(first.statusCode).toBe(200);
    const changedContent = structuredClone(loaded.draft.content); changedContent.slides[0].blocks[0].text = "Segunda alteração";
    const second = await app.inject({ method: "PUT", url: `/api/v1/presentations/${id}/draft`, headers: { authorization }, payload: { ...requestA, expectedRevision: 2, clientMutationId: randomUUID(), content: changedContent } });
    expect(second.statusCode).toBe(200);
    const replay = await app.inject({ method: "PUT", url: `/api/v1/presentations/${id}/draft`, headers: { authorization }, payload: requestA });
    expect(replay.statusCode).toBe(200); expect(replay.json().revision).toBe(2);

    const checkpointBody = { baseVersionId: loaded.draft.baseVersionId, draftRevision: 3 };
    const attempts = await Promise.all([randomUUID(), randomUUID()].map(clientMutationId => app.inject({ method: "POST", url: `/api/v1/presentations/${id}/checkpoints`, headers: { authorization }, payload: { ...checkpointBody, clientMutationId } })));
    expect(attempts.map(result => result.statusCode).sort()).toEqual([201, 409]);
  });

  it("impede referências de autoria entre organizações no banco", async () => {
    const { app, database } = await setup(); const authorization = await bootstrapAndLogin(app);
    const me = (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization } })).json();
    const otherOrganizationId = randomUUID();
    await database.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Organização isolada','isolada')", [otherOrganizationId]);
    await expect(database.query("INSERT INTO presentations(id,organization_id,title,created_by) VALUES($1,$2,'Inválida',$3)", [randomUUID(), otherOrganizationId, me.user.id])).rejects.toBeTruthy();
  });
});

describe("gestão de membros", () => {
  it("cria acesso temporário, exige troca de senha e aplica permissão de owner", async () => {
    const { app } = await setup();
    const ownerAuthorization = await bootstrapAndLogin(app);
    const created = await app.inject({ method: "POST", url: "/api/v1/members", headers: { authorization: ownerAuthorization }, payload: { name: "Pessoa editora", email: "editor@jump.local", role: "editor", temporaryPassword: "temporaria-123" } });
    expect(created.statusCode).toBe(201);
    expect(created.json().mustChangePassword).toBe(true);

    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "editor@jump.local", password: "temporaria-123" } });
    const editorAuthorization = `Bearer ${login.json().token as string}`;
    expect(login.json().user.mustChangePassword).toBe(true);
    const temporaryMe = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: editorAuthorization } });
    expect(temporaryMe.statusCode).toBe(200);
    const blockedUntilPasswordChange = await app.inject({ method: "GET", url: "/api/v1/presentations", headers: { authorization: editorAuthorization } });
    expect(blockedUntilPasswordChange.statusCode).toBe(403);
    expect(blockedUntilPasswordChange.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await app.inject({ method: "GET", url: "/api/v1/members", headers: { authorization: editorAuthorization } })).statusCode).toBe(403);

    const change = await app.inject({ method: "POST", url: "/api/v1/auth/change-password", headers: { authorization: editorAuthorization }, payload: { currentPassword: "temporaria-123", newPassword: "nova-segura-456" } });
    expect(change.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: editorAuthorization } });
    expect(me.json().user.mustChangePassword).toBe(false);
  });

  it("não permite desativar o último proprietário", async () => {
    const { app } = await setup();
    const ownerAuthorization = await bootstrapAndLogin(app);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: ownerAuthorization } });
    const response = await app.inject({ method: "PATCH", url: `/api/v1/members/${me.json().user.id as string}`, headers: { authorization: ownerAuthorization }, payload: { status: "disabled" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CANNOT_DISABLE_SELF");
  });

  it("limita tentativas repetidas de login com erro padronizado", async () => {
    const { app } = await setup();
    for (let attempt = 0; attempt < 8; attempt++) await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "inexistente@jump.local", password: "senha-incorreta" } });
    const limited = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "inexistente@jump.local", password: "senha-incorreta" } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(limited.json().error.requestId).toBeTruthy();
  });
});

describe("biblioteca Jump", () => {
  it("versiona, aprova e entrega para a IA somente conteudo aprovado e valido", async () => {
    const { app } = await setup();
    const authorization = await bootstrapAndLogin(app);
    const payload = {
      kind: "service", title: "Modernizacao de plataformas",
      text: "A Jump apoia jornadas de modernizacao com times especializados.",
      sourceLabel: "Apresentacao institucional aprovada", sourceUrl: "https://jump.tec.br/sobre-nos/",
      sourceLocator: "Slide 4", validFrom: "2020-01-01", validUntil: "2099-12-31",
      tags: ["modernizacao", "servicos"]
    };
    const created = await app.inject({ method: "POST", url: "/api/v1/jump-contents", headers: { authorization }, payload });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect((await app.inject({ method: "GET", url: "/api/v1/jump-context", headers: { authorization } })).json().items).toHaveLength(0);

    expect((await app.inject({ method: "POST", url: `/api/v1/jump-contents/${id}/submit`, headers: { authorization }, payload: {} })).statusCode).toBe(200);
    const approved = await app.inject({ method: "POST", url: `/api/v1/jump-contents/${id}/approve`, headers: { authorization }, payload: { note: "Fonte conferida." } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("approved");
    const context = await app.inject({ method: "GET", url: "/api/v1/jump-context?q=modernizacao", headers: { authorization } });
    expect(context.json().items).toHaveLength(1);
    expect(context.json().items[0].sourceLabel).toBe(payload.sourceLabel);

    const approvedDetail = await app.inject({ method: "GET", url: `/api/v1/jump-contents/${id}`, headers: { authorization } });
    expect(approvedDetail.json().reviews[0].actorName).toBe("Gestor");
    expect(approvedDetail.json().content.approvedBy).toBe("Gestor");
    expect((await app.inject({ method: "POST", url: `/api/v1/jump-contents/${id}/archive`, headers: { authorization }, payload: {} })).json().status).toBe("archived");
    const restored = await app.inject({ method: "POST", url: `/api/v1/jump-contents/${id}/restore`, headers: { authorization }, payload: {} });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().status).toBe("draft");
    expect((await app.inject({ method: "GET", url: "/api/v1/jump-context", headers: { authorization } })).json().items).toHaveLength(0);

    const changed = await app.inject({ method: "PUT", url: `/api/v1/jump-contents/${id}`, headers: { authorization }, payload: { ...payload, text: `${payload.text} Conteudo revisado.` } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().status).toBe("draft");
    expect(changed.json().versionNumber).toBe(2);
    expect((await app.inject({ method: "GET", url: "/api/v1/jump-context", headers: { authorization } })).json().items).toHaveLength(0);
    const detail = await app.inject({ method: "GET", url: `/api/v1/jump-contents/${id}`, headers: { authorization } });
    expect(detail.json().versions).toHaveLength(2);
    expect(detail.json().reviews.map((review: { action: string }) => review.action)).toEqual(expect.arrayContaining(["submitted", "approved"]));
  });

  it("carrega exemplos publicos como rascunhos de forma idempotente", async () => {
    const { app } = await setup();
    const authorization = await bootstrapAndLogin(app);
    const first = await app.inject({ method: "POST", url: "/api/v1/jump-contents/examples", headers: { authorization }, payload: {} });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ created: 6, skipped: 0, status: "draft" });
    const replay = await app.inject({ method: "POST", url: "/api/v1/jump-contents/examples", headers: { authorization }, payload: {} });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ created: 0, skipped: 6, status: "draft" });
    const list = await app.inject({ method: "GET", url: "/api/v1/jump-contents", headers: { authorization } });
    expect(list.json().items).toHaveLength(6);
    expect(list.json().items.every((item: { status: string }) => item.status === "draft")).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/v1/jump-context", headers: { authorization } })).json().items).toHaveLength(0);
  });

  it("bloqueia gestao por editor e exclui conteudo vencido do contexto da IA", async () => {
    const { app, database } = await setup();
    const ownerAuthorization = await bootstrapAndLogin(app);
    const me = (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: ownerAuthorization } })).json();
    await database.query("INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES($1,$2,'Editor','editor-jump@jump.local',$3,'editor')", [randomUUID(), me.organization.id, await hashPassword("senha-editor-123")]);
    const editorLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "editor-jump@jump.local", password: "senha-editor-123" } });
    const editorAuthorization = `Bearer ${editorLogin.json().token as string}`;
    const payload = { kind: "metric", title: "Indicador vencido", text: "100 projetos.", sourceLabel: "Relatorio antigo", validFrom: "2020-01-01", validUntil: "2020-12-31", tags: ["indicador"] };
    expect((await app.inject({ method: "POST", url: "/api/v1/jump-contents", headers: { authorization: editorAuthorization }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/jump-contents", headers: { authorization: editorAuthorization } })).statusCode).toBe(403);
    const created = await app.inject({ method: "POST", url: "/api/v1/jump-contents", headers: { authorization: ownerAuthorization }, payload });
    const id = created.json().id as string;
    await app.inject({ method: "POST", url: `/api/v1/jump-contents/${id}/submit`, headers: { authorization: ownerAuthorization }, payload: {} });
    await app.inject({ method: "POST", url: `/api/v1/jump-contents/${id}/approve`, headers: { authorization: ownerAuthorization }, payload: {} });
    const list = await app.inject({ method: "GET", url: "/api/v1/jump-contents", headers: { authorization: ownerAuthorization } });
    expect(list.json().items[0].effectiveStatus).toBe("expired");
    const future = await app.inject({ method: "POST", url: "/api/v1/jump-contents", headers: { authorization: ownerAuthorization }, payload: { ...payload, title: "Indicador futuro", validFrom: "2099-01-01", validUntil: "2099-12-31" } });
    const futureId = future.json().id as string;
    await app.inject({ method: "POST", url: `/api/v1/jump-contents/${futureId}/submit`, headers: { authorization: ownerAuthorization }, payload: {} });
    await app.inject({ method: "POST", url: `/api/v1/jump-contents/${futureId}/approve`, headers: { authorization: ownerAuthorization }, payload: {} });
    const refreshed = await app.inject({ method: "GET", url: "/api/v1/jump-contents", headers: { authorization: ownerAuthorization } });
    expect(refreshed.json().items.find((item: { id: string }) => item.id === futureId).effectiveStatus).toBe("scheduled");
    expect((await app.inject({ method: "GET", url: "/api/v1/jump-context", headers: { authorization: ownerAuthorization } })).json().items).toHaveLength(0);
  });
});

describe("geracao de roteiro por IA", () => {
  it("prende o roteiro à versão aprovada da fonte e rejeita reaprovacão de outra versão", async () => {
    let presentationCalls = 0;
    const provider: OutlineProvider = { name: "deepseek", model: "deepseek-test", ...unusedProviderMethods,
      async generateOutline(briefing, context) { return { title: briefing.objective, slides: [{
        title: "Serviço Jump", objective: "Apresentar o serviço", layout: "cover", keyPoints: ["Fato aprovado"], referenceIds: [context[0]!.id]
      }] }; },
      async generatePresentation() { presentationCalls++; throw new Error("A fonte alterada não deve chegar ao provedor."); }
    };
    const { app, database } = await setup(provider);
    const authorization = await bootstrapAndLogin(app);
    const source = { kind: "service", title: "Serviço Jump", text: "Serviço original aprovado.", sourceLabel: "Fonte interna", validFrom: "2020-01-01", validUntil: "2099-12-31", tags: ["serviço"] };
    const created = await app.inject({ method: "POST", url: "/api/v1/jump-contents", headers: { authorization }, payload: source });
    expect(created.statusCode).toBe(201);
    const contentId = created.json().id as string;
    const originalVersionId = created.json().currentVersionId as string;
    expect((await app.inject({ method: "POST", url: `/api/v1/jump-contents/${contentId}/submit`, headers: { authorization }, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/jump-contents/${contentId}/approve`, headers: { authorization }, payload: {} })).statusCode).toBe(200);
    const generated = await app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload: {
      idempotencyKey: randomUUID(), provider: "deepseek", briefing: { prompt: "Crie proposta", objective: "Proposta", audience: "Diretoria", tone: "consultivo", language: "pt-BR", slideCount: 1 }
    } });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().outline.slides[0].referenceIds).toEqual([originalVersionId]);
    const outlineId = generated.json().outline.id as string;
    expect((await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${outlineId}/approve`, headers: { authorization }, payload: { expectedRevision: 1 } })).statusCode).toBe(200);
    const changed = await app.inject({ method: "PUT", url: `/api/v1/jump-contents/${contentId}`, headers: { authorization }, payload: { ...source, text: "Serviço atualizado e reaprovado." } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().currentVersionId).not.toBe(originalVersionId);
    expect((await app.inject({ method: "POST", url: `/api/v1/jump-contents/${contentId}/submit`, headers: { authorization }, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/jump-contents/${contentId}/approve`, headers: { authorization }, payload: {} })).statusCode).toBe(200);
    const rejected = await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${outlineId}/presentation`, headers: { authorization }, payload: { idempotencyKey: randomUUID(), provider: "deepseek" } });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("OUTLINE_SOURCE_CHANGED");
    expect(presentationCalls).toBe(0);
    const presentations = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM presentations");
    expect(presentations.rows[0]?.count).toBe(0);
  });

  it("serializa pedidos simultâneos com a mesma chave de idempotência", async () => {
    let calls = 0;
    const provider: OutlineProvider = { name: "deepseek", model: "deepseek-test", ...unusedProviderMethods, async generateOutline(briefing) {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 25));
      return { title: briefing.objective, slides: [{ title: "Capa", objective: "Abrir proposta", layout: "cover", keyPoints: ["Introdução"], referenceIds: [] }] };
    } };
    const { app, database } = await setup(provider);
    const authorization = await bootstrapAndLogin(app);
    const payload = { idempotencyKey: randomUUID(), provider: "deepseek", briefing: {
      prompt: "Crie uma proposta", objective: "Proposta", audience: "Diretoria", tone: "consultivo", language: "pt-BR", slideCount: 1
    } };
    const requestOutline = () => app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload });
    const responses = await Promise.all([requestOutline(), requestOutline()]);
    expect(responses.map(response => response.statusCode)).toContain(201);
    expect(responses.every(response => [200, 201, 409].includes(response.statusCode))).toBe(true);
    for (const response of responses) if (response.statusCode === 409) expect(response.json().error.code).toBe("AI_IDEMPOTENCY_CONFLICT");
    expect(calls).toBe(1);
    const jobs = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM ai_generation_jobs WHERE kind='outline'");
    expect(jobs.rows[0]?.count).toBe(1);
  });

  it("rejeita apresentação factual sem fonte antes de persistir", async () => {
    const provider: OutlineProvider = { name: "deepseek", model: "deepseek-test", ...unusedProviderMethods,
      async generateOutline() { return { title: "Proposta", slides: [{ title: "Capa", objective: "Abrir proposta", layout: "cover", keyPoints: ["Pendência"], referenceIds: [] }] }; },
      async generatePresentation() { return { slides: [{ layout: "cover", referenceIds: [], blocks: [
        { type: "text" as const, role: "title" as const, text: "Capa" },
        { type: "text" as const, role: "body" as const, text: "A Jump atende 100 clientes." }
      ] }] }; }
    };
    const { app, database } = await setup(provider); const authorization = await bootstrapAndLogin(app);
    const outline = await app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload: {
      idempotencyKey: randomUUID(), provider: "deepseek", briefing: { prompt: "Crie proposta", objective: "Proposta", audience: "Diretoria", tone: "consultivo", language: "pt-BR", slideCount: 1 }
    } });
    expect(outline.statusCode).toBe(201);
    const outlineId = outline.json().outline.id as string;
    await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${outlineId}/approve`, headers: { authorization }, payload: { expectedRevision: 1 } });
    const rejected = await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${outlineId}/presentation`, headers: { authorization }, payload: { idempotencyKey: randomUUID(), provider: "deepseek" } });
    expect(rejected.statusCode).toBe(502); expect(rejected.json().error.code).toBe("AI_CLAIM_WITHOUT_REFERENCE");
    const presentations = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM presentations");
    expect(presentations.rows[0]?.count).toBe(0);
    const jobs = await database.query<{ status: string }>("SELECT status FROM ai_generation_jobs WHERE kind='presentation'");
    expect(jobs.rows[0]?.status).toBe("failed");
  });

  it("recusa regeneração factual sem fonte sem alterar o rascunho", async () => {
    const provider: OutlineProvider = { name: "deepseek", model: "deepseek-test", ...unusedProviderMethods,
      async generateOutline() { return { title: "Nossa proposta", slides: [{ title: "Nossa proposta", objective: "Apresentar", layout: "cover", keyPoints: ["Introdução"], referenceIds: [] }] }; },
      async generatePresentation() { return { slides: [{ layout: "cover", referenceIds: [], blocks: [
        { type: "text" as const, role: "title" as const, text: "Nossa proposta" },
        { type: "text" as const, role: "body" as const, text: "Informação a confirmar" }
      ] }] }; },
      async regenerateSlide() { return { referenceIds: [], blocks: [
        { type: "text" as const, role: "title" as const, text: "Nossa proposta" },
        { type: "text" as const, role: "body" as const, text: "A Jump atende 100 clientes." }
      ] }; }
    };
    const { app, database } = await setup(provider);
    const authorization = await bootstrapAndLogin(app);
    const outline = await app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload: {
      idempotencyKey: randomUUID(), provider: "deepseek", briefing: { prompt: "Crie proposta", objective: "Nossa proposta", audience: "Diretoria", tone: "consultivo", language: "pt-BR", slideCount: 1 }
    } });
    expect(outline.statusCode).toBe(201);
    const outlineId = outline.json().outline.id as string;
    expect((await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${outlineId}/approve`, headers: { authorization }, payload: { expectedRevision: 1 } })).statusCode).toBe(200);
    const presentation = await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${outlineId}/presentation`, headers: { authorization }, payload: { idempotencyKey: randomUUID(), provider: "deepseek" } });
    expect(presentation.statusCode).toBe(201);
    const presentationId = presentation.json().presentation.id as string;
    const initial = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization } });
    const draft = initial.json().draft;
    const slideId = draft.content.slides[0].slideId as string;
    const rejected = await app.inject({ method: "POST", url: `/api/v1/presentations/${presentationId}/slides/${slideId}/regenerate`, headers: { authorization }, payload: {
      idempotencyKey: randomUUID(), baseVersionId: draft.baseVersionId, expectedRevision: draft.revision, instruction: "Inclua dados da Jump"
    } });
    expect(rejected.statusCode).toBe(502);
    expect(rejected.json().error.code).toBe("AI_CLAIM_WITHOUT_REFERENCE");
    const after = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization } });
    expect(after.json().draft).toEqual(draft);
    const jobs = await database.query<{ status: string }>("SELECT status FROM ai_generation_jobs WHERE kind='slide_regeneration'");
    expect(jobs.rows[0]?.status).toBe("failed");
  });

  it("usa somente contexto Jump aprovado, persiste o roteiro e respeita idempotencia", async () => {
    let calls = 0; let presentationCalls = 0; let regenerationCalls = 0; let rewriteCalls = 0; let receivedContext: Array<{ id: string }> = [];
    const provider: OutlineProvider = { name: "deepseek", model: "deepseek-test", async generateOutline(briefing, context) {
      calls++; receivedContext = context;
      return { title: briefing.objective, slides: Array.from({ length: briefing.slideCount }, (_, index) => ({
        title: `Slide ${index + 1}`, objective: "Apresentar conteúdo validado", layout: index === 0 ? "cover" : "text_image",
        keyPoints: ["Informação rastreável"], referenceIds: context[0] ? [context[0].id] : []
      })), usage: { total_tokens: 123 } };
    }, async generatePresentation(outline, context) {
      presentationCalls++;
      return { slides: outline.slides.map(slide => ({ layout: slide.layout, referenceIds: context[0] ? [context[0].id] : [], blocks: [
        { type: "text" as const, role: "title" as const, text: slide.title },
        { type: "text" as const, role: "body" as const, text: "Conteúdo desenvolvido com fonte aprovada." }
      ] })), usage: { total_tokens: 456 } };
    }, async regenerateSlide(slide, _instruction, context) {
      regenerationCalls++; const title = slide.blocks.find(block => block.type === "text" && block.role === "title");
      return { blocks: [
        { type: "text" as const, role: "title" as const, text: title?.type === "text" ? title.text : "Slide" },
        { type: "text" as const, role: "body" as const, text: "Conteúdo regenerado somente neste slide." }
      ], referenceIds: context[0] ? [context[0].id] : [], usage: { total_tokens: 78 } };
    }, async rewriteBlock(text, request) {
      rewriteCalls++;
      expect(text).toBe("Conteúdo regenerado somente neste slide.");
      expect(request.operation).toBe("summarize");
      return { text: "Conteúdo regenerado." };
    } };
    const { app } = await setup(provider); const authorization = await bootstrapAndLogin(app);
    const jumpPayload = { kind: "service", title: "Serviço aprovado", text: "Conteúdo institucional aprovado.", sourceLabel: "Fonte interna", validFrom: "2020-01-01", validUntil: "2099-12-31", tags: ["serviço"] };
    const jump = await app.inject({ method: "POST", url: "/api/v1/jump-contents", headers: { authorization }, payload: jumpPayload });
    const jumpId = jump.json().id as string;
    const jumpVersionId = jump.json().currentVersionId as string;
    await app.inject({ method: "POST", url: `/api/v1/jump-contents/${jumpId}/submit`, headers: { authorization }, payload: {} });
    await app.inject({ method: "POST", url: `/api/v1/jump-contents/${jumpId}/approve`, headers: { authorization }, payload: {} });
    await app.inject({ method: "POST", url: "/api/v1/jump-contents", headers: { authorization }, payload: { ...jumpPayload, title: "Rascunho não aprovado" } });

    const idempotencyKey = randomUUID(); const requestPayload = { idempotencyKey, provider: "deepseek", briefing: { prompt: "Crie uma proposta", objective: "Proposta executiva", audience: "Diretoria", tone: "consultivo", language: "pt-BR", slideCount: 2 } };
    const generated = await app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload: requestPayload });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().outline.slides).toHaveLength(2);
    expect(receivedContext.map(item => item.id)).toEqual([jumpId]);
    const replay = await app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload: requestPayload });
    expect(replay.statusCode).toBe(200); expect(replay.json().outline.id).toBe(generated.json().outline.id); expect(calls).toBe(1);
    const alteredBriefing = await app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload: { ...requestPayload, briefing: { ...requestPayload.briefing, objective: "Objetivo alterado" } } });
    expect(alteredBriefing.statusCode).toBe(409); expect(alteredBriefing.json().error.code).toBe("AI_IDEMPOTENCY_CONFLICT"); expect(calls).toBe(1);
    const approved = await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${generated.json().outline.id as string}/approve`, headers: { authorization }, payload: { expectedRevision: 1 } });
    expect(approved.statusCode).toBe(200); expect(approved.json().status).toBe("approved");
    const crossEndpoint = await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${generated.json().outline.id as string}/presentation`, headers: { authorization }, payload: { idempotencyKey, provider: "deepseek" } });
    expect(crossEndpoint.statusCode).toBe(409); expect(crossEndpoint.json().error.code).toBe("AI_IDEMPOTENCY_CONFLICT"); expect(presentationCalls).toBe(0);
    const presentationKey = randomUUID();
    const presentation = await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${generated.json().outline.id as string}/presentation`, headers: { authorization }, payload: { idempotencyKey: presentationKey, provider: "deepseek" } });
    expect(presentation.statusCode).toBe(201);
    const presentationId = presentation.json().presentation.id as string;
    const editor = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization } });
    expect(editor.statusCode).toBe(200); expect(editor.json().draft.content.slides).toHaveLength(2);
    expect(editor.json().draft.content.slides[0].references).toEqual([jumpVersionId]);
    const untouchedSlide = structuredClone(editor.json().draft.content.slides[1]); const firstSlideId = editor.json().draft.content.slides[0].slideId as string; const regenerationKey = randomUUID();
    const regenerationPath = `/api/v1/presentations/${presentationId}/slides/${firstSlideId}/regenerate`;
    const regenerationPayload = { idempotencyKey: regenerationKey, baseVersionId: editor.json().draft.baseVersionId, expectedRevision: 1, instruction: "Deixe o texto mais direto" };
    const regenerated = await app.inject({ method: "POST", url: regenerationPath, headers: { authorization }, payload: regenerationPayload });
    expect(regenerated.statusCode).toBe(200); expect(regenerated.json().draft.revision).toBe(2);
    expect(regenerated.json().draft.content.slides[0].blocks[1].text).toContain("regenerado");
    expect(regenerated.json().draft.content.slides[0].references).toEqual([jumpVersionId]);
    expect(regenerated.json().draft.content.slides[1]).toEqual(untouchedSlide);
    const regenerationReplay = await app.inject({ method: "POST", url: regenerationPath, headers: { authorization }, payload: regenerationPayload });
    expect(regenerationReplay.statusCode).toBe(200); expect(regenerationReplay.json().draft.revision).toBe(2); expect(regenerationCalls).toBe(1);
    const differentInput = await app.inject({ method: "POST", url: regenerationPath, headers: { authorization }, payload: { ...regenerationPayload, instruction: "Outra instrução" } });
    expect(differentInput.json().error.code).toBe("AI_IDEMPOTENCY_CONFLICT");
    const outdated = await app.inject({ method: "POST", url: regenerationPath, headers: { authorization }, payload: { ...regenerationPayload, idempotencyKey: randomUUID(), baseVersionId: randomUUID(), expectedRevision: 2 } });
    expect(outdated.json().error.code).toBe("AUTOSAVE_CONFLICT");
    expect(regenerationCalls).toBe(1);
    const regeneratedDraft = regenerated.json().draft;
    const blockId = regeneratedDraft.content.slides[0].blocks[1].id;
    const rewritePath = `/api/v1/presentations/${presentationId}/slides/${firstSlideId}/blocks/${blockId}/rewrite`;
    const rewritePayload = { idempotencyKey: randomUUID(), baseVersionId: regeneratedDraft.baseVersionId, expectedRevision: 2, operation: "summarize" };
    const rewritten = await app.inject({ method: "POST", url: rewritePath, headers: { authorization }, payload: rewritePayload });
    expect(rewritten.statusCode).toBe(200);
    expect(rewritten.json()).toMatchObject({ rewrittenBlockId: blockId, draft: { revision: 3 } });
    const expectedContent = structuredClone(regeneratedDraft.content);
    expectedContent.slides[0].blocks[1].text = "Conteúdo regenerado.";
    const reloaded = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization } });
    expect(reloaded.json().draft.content).toEqual(expectedContent);
    const rewriteReplay = await app.inject({ method: "POST", url: rewritePath, headers: { authorization }, payload: rewritePayload });
    expect(rewriteReplay.json()).toEqual(rewritten.json());
    const invalidTone = await app.inject({ method: "POST", url: rewritePath, headers: { authorization }, payload: { ...rewritePayload, idempotencyKey: randomUUID(), operation: "tone" } });
    expect(invalidTone.statusCode).toBe(422);
    const staleRewrite = await app.inject({ method: "POST", url: rewritePath, headers: { authorization }, payload: { ...rewritePayload, idempotencyKey: randomUUID() } });
    expect(staleRewrite.json().error.code).toBe("AUTOSAVE_CONFLICT");
    expect(rewriteCalls).toBe(1);
    const presentationReplay = await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${generated.json().outline.id as string}/presentation`, headers: { authorization }, payload: { idempotencyKey: presentationKey, provider: "deepseek" } });
    expect(presentationReplay.statusCode).toBe(200); expect(presentationReplay.json().presentation.id).toBe(presentationId); expect(presentationCalls).toBe(1);
    const reverseCrossEndpoint = await app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload: { ...requestPayload, idempotencyKey: presentationKey } });
    expect(reverseCrossEndpoint.statusCode).toBe(409); expect(reverseCrossEndpoint.json().error.code).toBe("AI_IDEMPOTENCY_CONFLICT");
    const editedJump = await app.inject({ method: "PUT", url: `/api/v1/jump-contents/${jumpId}`, headers: { authorization }, payload: { ...jumpPayload, text: "Conteúdo institucional atualizado." } });
    expect(editedJump.statusCode).toBe(200);
    expect(editedJump.json().currentVersionId).not.toBe(jumpVersionId);
    const afterSourceEdit = await app.inject({ method: "GET", url: `/api/v1/presentations/${presentationId}`, headers: { authorization } });
    expect(afterSourceEdit.json().draft.content.slides[0].references).toEqual([jumpVersionId]);
    const originalVersion = await app.inject({ method: "GET", url: `/api/v1/jump-contents/${jumpId}`, headers: { authorization } });
    expect(originalVersion.json().versions.find((version: { id: string }) => version.id === jumpVersionId).body.text).toBe(jumpPayload.text);
    const listed = await app.inject({ method: "GET", url: "/api/v1/ai/outlines", headers: { authorization } });
    expect(listed.json().items).toHaveLength(1); expect(listed.json().items[0].status).toBe("approved");
    const secondOutline = await app.inject({ method: "POST", url: "/api/v1/ai/outlines", headers: { authorization }, payload: { ...requestPayload, idempotencyKey: randomUUID() } });
    expect(secondOutline.statusCode).toBe(201);
    const secondOutlineId = secondOutline.json().outline.id as string;
    await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${secondOutlineId}/approve`, headers: { authorization }, payload: { expectedRevision: 1 } });
    const otherResource = await app.inject({ method: "POST", url: `/api/v1/ai/outlines/${secondOutlineId}/presentation`, headers: { authorization }, payload: { idempotencyKey: presentationKey, provider: "deepseek" } });
    expect(otherResource.statusCode).toBe(409); expect(otherResource.json().error.code).toBe("AI_IDEMPOTENCY_CONFLICT"); expect(presentationCalls).toBe(1);
  });
});

describe("fila de exportação PDF", () => {
  it("persiste a versão solicitada e evita duplicação com pedidos simultâneos", async () => {
    const { app, database } = await setup();
    const headers = { authorization: await bootstrapAndLogin(app) };
    const created = await app.inject({ method: "POST", url: "/api/v1/presentations", headers, payload: { title: "Exportação de teste" } });
    expect(created.statusCode).toBe(201);
    const { presentationId, versionId } = created.json();
    const url = `/api/v1/presentations/${presentationId}/exports/pdf`;
    const payload = { versionId, idempotencyKey: randomUUID() };
    const requestPdf = () => app.inject({ method: "POST", url, headers, payload });
    const responses = await Promise.all([requestPdf(), requestPdf()]);
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 202]);
    const { job } = responses[0]!.json();
    expect(responses[1]!.json().job).toEqual(job);
    expect(job).toMatchObject({ presentationId, versionId, format: "pdf", status: "queued", attempt: 0 });

    const statusUrl = `/api/v1/exports/${job.id}`;
    const restarted = await buildApp(database);
    try {
      expect((await restarted.inject({ method: "GET", url: statusUrl, headers })).json()).toEqual({ job });
      expect((await restarted.inject({ method: "GET", url: statusUrl })).statusCode).toBe(401);
    } finally {
      await restarted.close();
    }

    const incompatible = await app.inject({ method: "POST", url, headers, payload: { ...payload, versionId: randomUUID() } });
    expect(incompatible.json().error.code).toBe("EXPORT_IDEMPOTENCY_CONFLICT");
    const missing = await app.inject({ method: "POST", url, headers, payload: { versionId: randomUUID(), idempotencyKey: randomUUID() } });
    expect(missing.statusCode).toBe(404);

    const downloadUrl = statusUrl + "/download";
    expect((await app.inject({ method: "GET", url: downloadUrl, headers })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: downloadUrl })).statusCode).toBe(401);
    await processNextExport(database, "pdf", async () => { throw new Error("Renderer indisponível"); });
    expect((await app.inject({ method: "GET", url: statusUrl, headers })).json().job).toMatchObject({ status: "retrying", attempt: 1 });

    // Simula um processo interrompido na segunda tentativa.
    await database.query("UPDATE export_jobs SET status='running',attempt=2,locked_until=now()-interval '1 second' WHERE id=$1", [job.id]);
    const fixture = Buffer.from("%PDF-1.7 test fixture");
    const processors = await Promise.all([
      processNextExport(database, "pdf", async () => fixture),
      processNextExport(database, "pdf", async () => fixture)
    ]);
    expect(processors.sort()).toEqual([false, true]);
    expect((await app.inject({ method: "GET", url: statusUrl, headers })).json().job).toMatchObject({ status: "succeeded", attempt: 3 });
    const download = await app.inject({ method: "GET", url: downloadUrl, headers });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/pdf");
    expect(download.headers["cache-control"]).toBe("private, no-store");
    expect(download.rawPayload).toEqual(fixture);

    const pptxRequest = await app.inject({
      method: "POST", url: `/api/v1/presentations/${presentationId}/exports/pptx`, headers,
      payload: { versionId, idempotencyKey: randomUUID() }
    });
    expect(pptxRequest.statusCode).toBe(202);
    expect(await processNextExport(database, "pptx", renderPptx)).toBe(true);
    const pptxDownload = await app.inject({ method: "GET", url: `/api/v1/exports/${pptxRequest.json().job.id}/download`, headers });
    expect(pptxDownload.statusCode).toBe(200);
    expect(pptxDownload.headers["content-disposition"]).toMatch(/\.pptx"$/);
    expect(pptxDownload.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 3, 4]));
  });
});
