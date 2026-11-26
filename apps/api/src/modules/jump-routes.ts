import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { JumpContentInputSchema, JumpContextQuerySchema, JumpListQuerySchema, JumpReviewSchema } from "@deckai/contracts";
import { audit } from "../audit.js";
import { authenticate, type AuthenticatedUser } from "../auth.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";

type JumpContent = {
  id: string; organizationId: string; kind: string; title: string; status: string; effectiveStatus: string;
  currentVersionId: string; approvedVersionId: string | null; versionNumber: number; text: string;
  sourceLabel: string; sourceUrl: string | null; sourceLocator: string | null; validFrom: string | null;
  validUntil: string | null; tags: string[]; createdBy: string; createdAt: string; updatedAt: string;
  approvedAt: string | null; approvedBy: string | null;
};

const publicExamples = [
  { externalKey: "public_jump_about_001", kind: "history", title: "Descrição institucional", text: "A Jump se apresenta como uma empresa de tecnologia e dados, com atuação no Brasil e em Portugal, especializada em soluções tecnológicas, dados, inteligência artificial e nuvem.", locator: "Sobre nós / Quem é a Jump", tags: ["institucional", "empresa", "tecnologia", "dados", "IA", "nuvem"] },
  { externalKey: "public_jump_history_001", kind: "history", title: "História institucional", text: "A página institucional informa uma trajetória iniciada em 2014 e apresenta marcos posteriores da evolução da empresa.", locator: "Sobre nós / Timeline", tags: ["história", "timeline", "institucional"] },
  { externalKey: "public_jump_metrics_001", kind: "metric", title: "Indicadores institucionais publicados", text: "A página apresenta indicadores de tempo de mercado, especialistas, países de atuação e projetos entregues.", locator: "Sobre nós / Indicadores", tags: ["números", "resultados", "institucional"] },
  { externalKey: "public_jump_capabilities_001", kind: "service", title: "Capacidades e áreas de atuação", text: "A página apresenta capacidades relacionadas a inteligência artificial, nuvem, engenharia de dados, analytics, desenvolvimento de software e serviços especializados.", locator: "Navegação / Verticais e rodapé", tags: ["serviços", "capacidades", "IA", "cloud", "dados"] },
  { externalKey: "public_jump_products_001", kind: "service", title: "Produtos do ecossistema", text: "A página institucional apresenta produtos e soluções que fazem parte do ecossistema Jump.", locator: "Ecossistema Jump / Soluções", tags: ["produtos", "ecossistema", "institucional"] },
  { externalKey: "public_jump_certifications_001", kind: "brand", title: "Parcerias e certificações", text: "A página institucional apresenta parcerias e certificações relacionadas a qualidade, segurança, privacidade, inteligência artificial e sustentabilidade.", locator: "Sobre nós / Parcerias e certificações", tags: ["certificações", "governança", "segurança"] }
] as const;

const contentSelect = `SELECT c.id,c.organization_id AS "organizationId",c.kind,c.title,c.status,
  CASE WHEN c.status='approved' AND v.valid_from IS NOT NULL AND v.valid_from>CURRENT_DATE THEN 'scheduled'
       WHEN c.status='approved' AND v.valid_until IS NOT NULL AND v.valid_until<CURRENT_DATE THEN 'expired'
       ELSE c.status END AS "effectiveStatus",
  c.current_version_id AS "currentVersionId",c.approved_version_id AS "approvedVersionId",v.version_number AS "versionNumber",
  v.body_json->>'text' AS text,v.source_label AS "sourceLabel",v.source_url AS "sourceUrl",v.source_locator AS "sourceLocator",
  v.valid_from::text AS "validFrom",v.valid_until::text AS "validUntil",v.tags,c.created_by AS "createdBy",
  c.created_at AS "createdAt",c.updated_at AS "updatedAt",
  (SELECT r.created_at FROM jump_reviews r WHERE r.content_id=c.id AND r.organization_id=c.organization_id AND r.action='approved' ORDER BY r.created_at DESC LIMIT 1) AS "approvedAt",
  (SELECT u.name FROM jump_reviews r JOIN users u ON u.id=r.actor_id AND u.organization_id=r.organization_id WHERE r.content_id=c.id AND r.organization_id=c.organization_id AND r.action='approved' ORDER BY r.created_at DESC LIMIT 1) AS "approvedBy"
  FROM jump_contents c JOIN jump_content_versions v ON v.id=c.current_version_id AND v.content_id=c.id`;

function requireContentManager(user: AuthenticatedUser): void {
  if (user.role !== "owner" && user.role !== "reviewer") throw new AppError(403, "CONTENT_MANAGER_REQUIRED", "Somente owners e revisores podem gerenciar conteúdo Jump.");
}

async function scopedContent(database: Database, id: string, organizationId: string, lock = false): Promise<JumpContent> {
  const result = await database.query<JumpContent>(`${contentSelect} WHERE c.id=$1 AND c.organization_id=$2${lock ? " FOR UPDATE OF c" : ""}`, [id, organizationId]);
  if (!result.rows[0]) throw notFound("Conteúdo Jump");
  return result.rows[0];
}

export function registerJumpRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/v1/jump-contents", async (request) => {
    const user = await authenticate(request, database);
    requireContentManager(user);
    const query = JumpListQuerySchema.parse(request.query);
    const conditions = ["c.organization_id=$1"], params: unknown[] = [user.organizationId];
    if (query.status) { params.push(query.status); conditions.push(`c.status=$${params.length}`); }
    if (query.kind) { params.push(query.kind); conditions.push(`c.kind=$${params.length}`); }
    if (query.q?.trim()) { params.push(`%${query.q.trim().toLowerCase()}%`); conditions.push(`(lower(c.title) LIKE $${params.length} OR lower(v.body_json->>'text') LIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(v.tags) tag WHERE lower(tag) LIKE $${params.length}))`); }
    const result = await database.query<JumpContent>(`${contentSelect} WHERE ${conditions.join(" AND ")} ORDER BY c.updated_at DESC LIMIT 200`, params);
    return { items: result.rows };
  });

  app.get("/api/v1/jump-context", async (request) => {
    const user = await authenticate(request, database);
    const query = JumpContextQuerySchema.parse(request.query);
    const params: unknown[] = [user.organizationId];
    let search = "";
    if (query.q?.trim()) { params.push(`%${query.q.trim().toLowerCase()}%`); search = ` AND (lower(c.title) LIKE $2 OR lower(v.body_json->>'text') LIKE $2 OR EXISTS (SELECT 1 FROM unnest(v.tags) tag WHERE lower(tag) LIKE $2))`; }
    const result = await database.query<JumpContent>(`${contentSelect} WHERE c.organization_id=$1 AND c.status='approved' AND c.current_version_id=c.approved_version_id
      AND v.source_label<>'' AND (v.valid_from IS NULL OR v.valid_from<=CURRENT_DATE) AND (v.valid_until IS NULL OR v.valid_until>=CURRENT_DATE)${search}
      ORDER BY c.updated_at DESC LIMIT 100`, params);
    return { items: result.rows, policy: { approvedOnly: true, validAt: new Date().toISOString().slice(0, 10), sourcesRequired: true } };
  });

  app.post("/api/v1/jump-contents", async (request, reply) => {
    const user = await authenticate(request, database); requireContentManager(user);
    const body = JumpContentInputSchema.parse(request.body);
    const contentId = randomUUID(), versionId = randomUUID();
    await database.transaction(async (tx) => {
      await tx.query("INSERT INTO jump_contents (id,organization_id,kind,title,created_by) VALUES ($1,$2,$3,$4,$5)", [contentId, user.organizationId, body.kind, body.title, user.id]);
      await tx.query(`INSERT INTO jump_content_versions (id,organization_id,content_id,version_number,body_json,source_label,source_url,source_locator,valid_from,valid_until,tags,created_by)
        VALUES ($1,$2,$3,1,$4::jsonb,$5,$6,$7,$8,$9,$10::text[],$11)`, [versionId, user.organizationId, contentId, JSON.stringify({ text: body.text }), body.sourceLabel, body.sourceUrl || null, body.sourceLocator ?? null, body.validFrom ?? null, body.validUntil ?? null, body.tags, user.id]);
      await tx.query("UPDATE jump_contents SET current_version_id=$1 WHERE id=$2 AND organization_id=$3", [versionId, contentId, user.organizationId]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "jump.create", entityType: "jump_content", entityId: contentId, requestId: request.id });
    });
    return reply.code(201).send(await scopedContent(database, contentId, user.organizationId));
  });

  app.post("/api/v1/jump-contents/examples", async (request, reply) => {
    const user = await authenticate(request, database); requireContentManager(user);
    const result = await database.transaction(async (tx) => {
      let created = 0;
      for (const example of publicExamples) {
        const existing = await tx.query<{ id: string }>("SELECT id FROM jump_contents WHERE organization_id=$1 AND external_key=$2", [user.organizationId, example.externalKey]);
        if (existing.rows[0]) continue;
        const contentId = randomUUID(), versionId = randomUUID();
        await tx.query("INSERT INTO jump_contents (id,organization_id,kind,title,created_by,external_key) VALUES ($1,$2,$3,$4,$5,$6)", [contentId, user.organizationId, example.kind, example.title, user.id, example.externalKey]);
        await tx.query(`INSERT INTO jump_content_versions (id,organization_id,content_id,version_number,body_json,source_label,source_url,source_locator,tags,created_by)
          VALUES ($1,$2,$3,1,$4::jsonb,'Site institucional Jump','https://jump.tec.br/sobre-nos/',$5,$6::text[],$7)`, [versionId, user.organizationId, contentId, JSON.stringify({ text: example.text }), example.locator, [...example.tags], user.id]);
        await tx.query("UPDATE jump_contents SET current_version_id=$1 WHERE id=$2 AND organization_id=$3", [versionId, contentId, user.organizationId]);
        created++;
      }
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "jump.examples.load", entityType: "jump_content", requestId: request.id, metadata: { created, skipped: publicExamples.length - created } });
      return { created, skipped: publicExamples.length - created, status: "draft" as const };
    });
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.get("/api/v1/jump-contents/:id", async (request) => {
    const user = await authenticate(request, database); requireContentManager(user); const { id } = request.params as { id: string };
    const content = await scopedContent(database, id, user.organizationId);
    const [versions, reviews] = await Promise.all([
      database.query("SELECT id,version_number AS \"versionNumber\",body_json AS body,source_label AS \"sourceLabel\",source_url AS \"sourceUrl\",source_locator AS \"sourceLocator\",valid_from::text AS \"validFrom\",valid_until::text AS \"validUntil\",tags,created_by AS \"createdBy\",created_at AS \"createdAt\" FROM jump_content_versions WHERE content_id=$1 AND organization_id=$2 ORDER BY version_number DESC", [id, user.organizationId]),
      database.query("SELECT r.id,r.action,r.note,r.actor_id AS \"actorId\",u.name AS \"actorName\",r.created_at AS \"createdAt\" FROM jump_reviews r JOIN users u ON u.id=r.actor_id AND u.organization_id=r.organization_id WHERE r.content_id=$1 AND r.organization_id=$2 ORDER BY r.created_at DESC", [id, user.organizationId])
    ]);
    return { content, versions: versions.rows, reviews: reviews.rows };
  });

  app.put("/api/v1/jump-contents/:id", async (request) => {
    const user = await authenticate(request, database); requireContentManager(user);
    const { id } = request.params as { id: string }; const body = JumpContentInputSchema.parse(request.body);
    await database.transaction(async (tx) => {
      const current = await scopedContent(tx, id, user.organizationId, true);
      if (current.status === "in_review") throw new AppError(409, "CONTENT_IN_REVIEW", "Retire ou rejeite o conteúdo antes de editar.");
      if (current.status === "archived") throw new AppError(409, "CONTENT_ARCHIVED", "Conteúdo arquivado não pode ser editado.");
      const next = current.versionNumber + 1, versionId = randomUUID();
      await tx.query(`INSERT INTO jump_content_versions (id,organization_id,content_id,version_number,body_json,source_label,source_url,source_locator,valid_from,valid_until,tags,created_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::text[],$12)`, [versionId, user.organizationId, id, next, JSON.stringify({ text: body.text }), body.sourceLabel, body.sourceUrl || null, body.sourceLocator ?? null, body.validFrom ?? null, body.validUntil ?? null, body.tags, user.id]);
      await tx.query("UPDATE jump_contents SET kind=$1,title=$2,status='draft',current_version_id=$3,approved_version_id=NULL,updated_at=now() WHERE id=$4 AND organization_id=$5", [body.kind, body.title, versionId, id, user.organizationId]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "jump.version.create", entityType: "jump_content", entityId: id, requestId: request.id, metadata: { versionNumber: next } });
    });
    return scopedContent(database, id, user.organizationId);
  });

  for (const action of ["submit", "approve", "reject", "archive", "restore"] as const) {
    app.post(`/api/v1/jump-contents/:id/${action}`, async (request) => {
      const user = await authenticate(request, database); requireContentManager(user);
      const { id } = request.params as { id: string }; const body = JumpReviewSchema.parse(request.body ?? {});
      return database.transaction(async (tx) => {
        const content = await scopedContent(tx, id, user.organizationId, true);
        const allowed: Record<"submit" | "approve" | "reject" | "archive" | "restore", string[]> = { submit: ["draft", "rejected"], approve: ["in_review"], reject: ["in_review"], archive: ["draft", "in_review", "approved", "rejected"], restore: ["archived"] };
        if (!allowed[action].includes(content.status)) throw new AppError(409, "INVALID_CONTENT_TRANSITION", `Não é possível executar ${action} a partir de ${content.status}.`);
        if (action === "approve" && (!content.sourceLabel || !content.validFrom || !content.validUntil)) throw new AppError(422, "APPROVAL_REQUIREMENTS", "Aprovação exige fonte e período de validade.");
        if (action === "reject" && !body.note) throw new AppError(422, "REJECTION_NOTE_REQUIRED", "Informe o motivo da rejeição.");
        const nextStatus = { submit: "in_review", approve: "approved", reject: "rejected", archive: "archived", restore: "draft" }[action];
        await tx.query("UPDATE jump_contents SET status=$1::varchar,approved_version_id=CASE WHEN $1::varchar='approved' THEN current_version_id WHEN $1::varchar IN ('draft','rejected') THEN NULL ELSE approved_version_id END,updated_at=now() WHERE id=$2 AND organization_id=$3", [nextStatus, id, user.organizationId]);
        const reviewAction = { submit: "submitted", approve: "approved", reject: "rejected", archive: "archived", restore: "restored" }[action];
        await tx.query("INSERT INTO jump_reviews (id,organization_id,content_id,version_id,action,note,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), user.organizationId, id, content.currentVersionId, reviewAction, body.note ?? null, user.id]);
        await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: `jump.${action}`, entityType: "jump_content", entityId: id, requestId: request.id, metadata: { note: body.note } });
        return scopedContent(tx, id, user.organizationId);
      });
    });
  }
}
