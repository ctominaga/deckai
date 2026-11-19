import http from "node:http";
import { randomUUID } from "node:crypto";
import { apiError, createSession, hashPassword, requirePermission, rolePermissions, verifyPassword } from "./security.mjs";

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "http://localhost:5173",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,idempotency-key"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw apiError(413, "BODY_TOO_LARGE", "Corpo da requisição muito grande.");
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw apiError(400, "INVALID_JSON", "JSON inválido."); }
}

const id = (prefix) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const publicUser = ({ passwordHash, ...user }) => user;

function validatePresentation(content) {
  if (content?.schemaVersion !== "1.0" || !Array.isArray(content?.slides) || content.slides.length === 0) {
    throw apiError(400, "INVALID_PRESENTATION", "A apresentação deve usar schemaVersion 1.0 e possuir slides.");
  }
}

function audit(db, actorId, action, entityType, entityId) {
  db.auditEvents.push({ eventId: id("audit"), actorId, action, entityType, entityId, occurredAt: now() });
}

export function createApp(database) {
  const db = database.data;

  function authenticate(req) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const session = db.sessions.find((item) => item.token === token && Date.parse(item.expiresAt) > Date.now());
    const user = session && db.users.find((item) => item.userId === session.userId && item.status === "active");
    if (!user) throw apiError(401, "UNAUTHORIZED", "Faça login para continuar.");
    return user;
  }

  return http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") return json(res, 204);
    const requestUrl = new URL(req.url, "http://localhost");
    const path = requestUrl.pathname;

    try {
      if (req.method === "GET" && path === "/health") {
        return json(res, 200, { status: "ok", service: "deckai-api", persistence: "json-development" });
      }

      if (req.method === "POST" && path === "/api/auth/bootstrap") {
        if (db.users.length) throw apiError(409, "BOOTSTRAP_COMPLETED", "O usuário inicial já foi criado.");
        const body = await readBody(req);
        if (!body.name?.trim() || !body.email?.trim()) throw apiError(400, "REQUIRED_FIELDS", "Nome e e-mail são obrigatórios.");
        const user = { userId: id("usr"), name: body.name.trim(), email: body.email.trim().toLowerCase(), passwordHash: hashPassword(body.password), role: "owner", status: "active", createdAt: now() };
        database.mutate(() => { db.users.push(user); audit(db, user.userId, "user.bootstrap", "user", user.userId); });
        return json(res, 201, { user: publicUser(user) });
      }

      if (req.method === "POST" && path === "/api/auth/login") {
        const body = await readBody(req);
        const user = db.users.find((item) => item.email === String(body.email).trim().toLowerCase());
        if (!user || !verifyPassword(body.password ?? "", user.passwordHash)) throw apiError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
        const session = createSession(user.userId);
        database.mutate(() => db.sessions.push(session));
        return json(res, 200, { token: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
      }

      const actor = authenticate(req);

      if (req.method === "GET" && path === "/api/auth/me") return json(res, 200, { user: publicUser(actor), permissions: rolePermissions[actor.role] });
      if (req.method === "POST" && path === "/api/auth/logout") {
        const token = req.headers.authorization.slice(7);
        database.mutate(() => { db.sessions = db.sessions.filter((item) => item.token !== token); });
        return json(res, 204);
      }

      if (req.method === "GET" && path === "/api/presentations") {
        requirePermission(actor, "presentation:read");
        return json(res, 200, { items: db.presentations.filter((item) => item.status !== "deleted").map(({ versions, ...item }) => ({ ...item, versionCount: versions.length })) });
      }

      if (req.method === "POST" && path === "/api/presentations") {
        requirePermission(actor, "presentation:write");
        const body = await readBody(req); validatePresentation(body.content);
        if (!body.title?.trim()) throw apiError(400, "TITLE_REQUIRED", "Título obrigatório.");
        const versionId = id("ver");
        const item = { presentationId: id("pres"), title: body.title.trim(), status: "draft", currentVersionId: versionId, createdBy: actor.userId, createdAt: now(), updatedAt: now(), versions: [{ versionId, versionNumber: 1, schemaVersion: "1.0", content: body.content, createdBy: actor.userId, createdAt: now() }] };
        database.mutate(() => { db.presentations.push(item); audit(db, actor.userId, "presentation.create", "presentation", item.presentationId); });
        return json(res, 201, item);
      }

      const presentationMatch = path.match(/^\/api\/presentations\/([^/]+)(?:\/versions)?$/);
      if (presentationMatch) {
        requirePermission(actor, req.method === "GET" ? "presentation:read" : "presentation:write");
        const item = db.presentations.find((entry) => entry.presentationId === presentationMatch[1] && entry.status !== "deleted");
        if (!item) throw apiError(404, "PRESENTATION_NOT_FOUND", "Apresentação não encontrada.");
        if (req.method === "GET") return json(res, 200, item);
        if (req.method === "POST" && path.endsWith("/versions")) {
          const body = await readBody(req); validatePresentation(body.content);
          if (body.baseVersionId !== item.currentVersionId) throw apiError(409, "VERSION_CONFLICT", "A apresentação foi alterada. Recarregue antes de salvar.");
          const version = { versionId: id("ver"), versionNumber: item.versions.length + 1, schemaVersion: "1.0", content: body.content, createdBy: actor.userId, createdAt: now() };
          database.mutate(() => { item.versions.push(version); item.currentVersionId = version.versionId; item.updatedAt = now(); audit(db, actor.userId, "presentation.version.create", "presentation", item.presentationId); });
          return json(res, 201, version);
        }
        if (req.method === "DELETE") {
          database.mutate(() => { item.status = "deleted"; item.updatedAt = now(); audit(db, actor.userId, "presentation.delete", "presentation", item.presentationId); });
          return json(res, 204);
        }
      }

      if (req.method === "GET" && path === "/api/jump-contents") {
        requirePermission(actor, "jump:read");
        const aiOnly = requestUrl.searchParams.get("availability") === "ai";
        const current = Date.now();
        const items = db.jumpContents.filter((item) => !aiOnly || (item.status === "approved" && (!item.validUntil || Date.parse(item.validUntil) >= current)));
        return json(res, 200, { items });
      }

      if (req.method === "POST" && path === "/api/jump-contents") {
        requirePermission(actor, "jump:write");
        const body = await readBody(req);
        if (!body.title?.trim() || !body.content?.trim() || !body.source?.trim()) throw apiError(400, "SOURCE_REQUIRED", "Título, conteúdo e fonte são obrigatórios.");
        const item = { contentId: id("jump"), title: body.title.trim(), category: body.category ?? "other", content: body.content.trim(), source: body.source.trim(), tags: body.tags ?? [], status: "draft", version: 1, validUntil: body.validUntil ?? null, createdBy: actor.userId, createdAt: now(), updatedAt: now() };
        database.mutate(() => { db.jumpContents.push(item); audit(db, actor.userId, "jump.create", "jump_content", item.contentId); });
        return json(res, 201, item);
      }

      const jumpMatch = path.match(/^\/api\/jump-contents\/([^/]+)\/(submit|approve|reject|archive)$/);
      if (req.method === "POST" && jumpMatch) {
        const [, contentId, action] = jumpMatch;
        requirePermission(actor, action === "submit" ? "jump:write" : "jump:approve");
        const item = db.jumpContents.find((entry) => entry.contentId === contentId);
        if (!item) throw apiError(404, "JUMP_CONTENT_NOT_FOUND", "Conteúdo não encontrado.");
        const allowed = { submit: ["draft", "rejected"], approve: ["in_review"], reject: ["in_review"], archive: ["draft", "in_review", "approved", "rejected"] };
        if (!allowed[action].includes(item.status)) throw apiError(409, "INVALID_STATUS_TRANSITION", `Não é possível executar ${action} a partir de ${item.status}.`);
        const nextStatus = { submit: "in_review", approve: "approved", reject: "rejected", archive: "archived" }[action];
        database.mutate(() => { item.status = nextStatus; item.updatedAt = now(); item[`${action}By`] = actor.userId; item[`${action}At`] = now(); audit(db, actor.userId, `jump.${action}`, "jump_content", item.contentId); });
        return json(res, 200, item);
      }

      throw apiError(404, "NOT_FOUND", "Endpoint não encontrado.");
    } catch (error) {
      return json(res, error.status ?? 500, { error: { code: error.code ?? "INTERNAL_ERROR", message: error.status ? error.message : "Erro interno.", details: error.details } });
    }
  });
}
