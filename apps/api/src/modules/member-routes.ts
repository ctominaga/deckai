import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CreateMemberSchema, UpdateMemberSchema } from "@deckai/contracts";
import { audit } from "../audit.js";
import { authenticate } from "../auth.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";
import { hashPassword } from "../security.js";

type Member = { id: string; name: string; email: string; role: "owner"|"editor"|"reviewer"|"viewer"; status: "active"|"disabled"; mustChangePassword: boolean; createdAt: string; updatedAt: string };
const selectMembers = `SELECT id,name,email,role,status,must_change_password AS "mustChangePassword",created_at AS "createdAt",updated_at AS "updatedAt" FROM users`;

function requireOwner(role: string): void { if (role !== "owner") throw new AppError(403, "OWNER_REQUIRED", "Somente proprietários podem gerenciar membros."); }

export function registerMemberRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/v1/members", async (request) => {
    const user = await authenticate(request, database); requireOwner(user.role);
    const members = await database.query<Member>(`${selectMembers} WHERE organization_id=$1 ORDER BY created_at`, [user.organizationId]);
    return { items: members.rows };
  });

  app.post("/api/v1/members", async (request, reply) => {
    const user = await authenticate(request, database); requireOwner(user.role);
    const body = CreateMemberSchema.parse(request.body); const memberId = randomUUID();
    try {
      await database.transaction(async (tx) => {
        await tx.query(`INSERT INTO users (id,organization_id,name,email,password_hash,role,must_change_password)
          VALUES ($1,$2,$3,$4,$5,$6,true)`, [memberId, user.organizationId, body.name, body.email, await hashPassword(body.temporaryPassword), body.role]);
        await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "member.create", entityType: "user", entityId: memberId, requestId: request.id, metadata: { role: body.role } });
      });
    } catch (error: any) {
      if (error?.code === "23505") throw new AppError(409, "EMAIL_ALREADY_EXISTS", "Já existe uma pessoa com este e-mail.");
      throw error;
    }
    const created = await database.query<Member>(`${selectMembers} WHERE id=$1 AND organization_id=$2`, [memberId, user.organizationId]);
    return reply.code(201).send(created.rows[0]);
  });

  app.patch("/api/v1/members/:id", async (request) => {
    const user = await authenticate(request, database); requireOwner(user.role);
    const { id } = request.params as { id: string }; const body = UpdateMemberSchema.parse(request.body);
    await database.transaction(async (tx) => {
      await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [user.organizationId]);
      const current = await tx.query<Member>(`${selectMembers} WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
      const member = current.rows[0]; if (!member) throw notFound("Membro");
      if (id === user.id && body.status === "disabled") throw new AppError(409, "CANNOT_DISABLE_SELF", "Você não pode desativar seu próprio acesso.");
      if (member.role === "owner" && (body.role && body.role !== "owner" || body.status === "disabled")) {
        const owners = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE organization_id=$1 AND role='owner' AND status='active'", [user.organizationId]);
        if (Number(owners.rows[0]?.count) <= 1) throw new AppError(409, "LAST_OWNER", "A organização precisa manter pelo menos um proprietário ativo.");
      }
      await tx.query("UPDATE users SET role=coalesce($1,role),status=coalesce($2,status),updated_at=now() WHERE id=$3 AND organization_id=$4", [body.role ?? null, body.status ?? null, id, user.organizationId]);
      if (body.status === "disabled") await tx.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "member.update", entityType: "user", entityId: id, requestId: request.id, metadata: body });
    });
    const updated = await database.query<Member>(`${selectMembers} WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
    return updated.rows[0];
  });
}
