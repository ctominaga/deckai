import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { BootstrapSchema, ChangePasswordSchema, LoginSchema } from "@deckai/contracts";
import type { Database } from "../database.js";
import { AppError } from "../errors.js";
import { audit } from "../audit.js";
import { authenticate } from "../auth.js";
import { createToken, hashPassword, hashToken, verifyPassword } from "../security.js";

const DEFAULT_TOKENS = { color: { background: "#f3f1e9", ink: "#171717", accent: "#d7ff45", muted: "#77766f" }, font: { family: "Arial, sans-serif" } };
const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "organizacao";

export function registerAuthRoutes(app: FastifyInstance, database: Database): void {
  app.post("/api/v1/bootstrap", async (request, reply) => {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_BOOTSTRAP !== "true") throw new AppError(403, "BOOTSTRAP_DISABLED", "Bootstrap desativado neste ambiente.");
    const body = BootstrapSchema.parse(request.body);
    const result = await database.transaction(async (tx) => {
      const state = await tx.query<{ bootstrapped: boolean }>("SELECT bootstrapped FROM installation_state WHERE id=1 FOR UPDATE");
      if (state.rows[0]?.bootstrapped) throw new AppError(409, "BOOTSTRAP_COMPLETED", "A instalação já possui um usuário inicial.");
      const organizationId = randomUUID(), userId = randomUUID(), themeId = randomUUID();
      const slug = `${slugify(body.organizationName)}-${organizationId.slice(0, 6)}`;
      await tx.query("INSERT INTO organizations (id,name,slug) VALUES ($1,$2,$3)", [organizationId, body.organizationName, slug]);
      await tx.query("INSERT INTO users (id,organization_id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5,'owner')", [userId, organizationId, body.name, body.email, await hashPassword(body.password)]);
      await tx.query("INSERT INTO themes (id,organization_id,name,tokens,is_default) VALUES ($1,$2,'Jump padrão',$3::jsonb,true)", [themeId, organizationId, JSON.stringify(DEFAULT_TOKENS)]);
      await tx.query("UPDATE installation_state SET bootstrapped=true WHERE id=1");
      await audit(tx, { organizationId, actorId: userId, action: "organization.bootstrap", entityType: "organization", entityId: organizationId, requestId: request.id });
      return { organization: { id: organizationId, name: body.organizationName, slug }, user: { id: userId, organizationId, name: body.name, email: body.email, role: "owner" }, themeId };
    });
    return reply.code(201).send(result);
  });

  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request) => {
    const body = LoginSchema.parse(request.body);
    const users = await database.query<{ id: string; organizationId: string; name: string; email: string; role: "owner" | "editor" | "reviewer" | "viewer"; passwordHash: string; mustChangePassword: boolean }>(`
      SELECT id, organization_id AS "organizationId", name, email, role, password_hash AS "passwordHash", must_change_password AS "mustChangePassword" FROM users WHERE lower(email)=lower($1) AND status='active'
    `, [body.email]);
    const user = users.rows[0];
    if (!user || !await verifyPassword(body.password, user.passwordHash)) throw new AppError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
    await database.query("DELETE FROM sessions WHERE expires_at <= now()");
    const token = createToken(), sessionId = randomUUID();
    await database.query("INSERT INTO sessions (id,organization_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '8 hours')", [sessionId, user.organizationId, user.id, hashToken(token)]);
    const { passwordHash: _, ...safeUser } = user;
    return { token, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), user: safeUser };
  });

  app.get("/api/v1/auth/me", async (request) => {
    const user = await authenticate(request, database, { allowPasswordChange: true });
    const organization = await database.query<{ id: string; name: string; slug: string; createdAt: string }>("SELECT id,name,slug,created_at AS \"createdAt\" FROM organizations WHERE id=$1", [user.organizationId]);
    return { user, organization: organization.rows[0] };
  });

  app.post("/api/v1/auth/change-password", async (request) => {
    const user = await authenticate(request, database, { allowPasswordChange: true });
    const body = ChangePasswordSchema.parse(request.body);
    const current = await database.query<{ passwordHash: string }>("SELECT password_hash AS \"passwordHash\" FROM users WHERE id=$1 AND organization_id=$2", [user.id, user.organizationId]);
    if (!current.rows[0] || !await verifyPassword(body.currentPassword, current.rows[0].passwordHash)) throw new AppError(401, "INVALID_CURRENT_PASSWORD", "A senha atual está incorreta.");
    const token = request.headers.authorization?.slice(7) ?? "";
    await database.transaction(async (tx) => {
      await tx.query("UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2 AND organization_id=$3", [await hashPassword(body.newPassword), user.id, user.organizationId]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [user.id, hashToken(token)]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "user.password.change", entityType: "user", entityId: user.id, requestId: request.id });
    });
    return { changed: true };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await authenticate(request, database, { allowPasswordChange: true });
    const token = request.headers.authorization?.slice(7) ?? "";
    await database.query("DELETE FROM sessions WHERE token_hash=$1", [hashToken(token)]);
    return reply.code(204).send();
  });
}
