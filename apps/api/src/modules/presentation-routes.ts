import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CreateCheckpointSchema, CreatePresentationSchema, PresentationContentSchema, SaveDraftSchema, UpdatePresentationSchema, initialPresentationContent, type PresentationContent } from "@deckai/contracts";
import { renderPresentationDocument } from "@deckai/renderer";
import { imageDataUrls, loadPresentationImages } from "../presentation-images.js";
import { audit } from "../audit.js";
import { authenticate, requireWrite } from "../auth.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";
import { contentHash } from "../security.js";

type PresentationRow = { id: string; organizationId: string; title: string; status: string; currentVersionId: string; createdBy: string; createdAt: string; updatedAt: string };
type VersionRow = { id: string; presentationId: string; versionNumber: number; schemaVersion: string; state: string; content: PresentationContent; contentHash: string; baseVersionId: string | null; createdBy: string; createdAt: string };
type DraftRow = { presentationId: string; baseVersionId: string; revision: number; content: PresentationContent; lastMutationId: string; updatedAt: string };

const presentationSelect = `SELECT id,organization_id AS "organizationId",title,status,current_version_id AS "currentVersionId",created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM presentations`;
const versionSelect = `SELECT id,presentation_id AS "presentationId",version_number AS "versionNumber",schema_version AS "schemaVersion",state,content_json AS content,content_hash AS "contentHash",base_version_id AS "baseVersionId",created_by AS "createdBy",created_at AS "createdAt" FROM presentation_versions`;
const draftSelect = `SELECT presentation_id AS "presentationId",base_version_id AS "baseVersionId",revision,content_json AS content,last_mutation_id AS "lastMutationId",updated_at AS "updatedAt" FROM presentation_drafts`;

async function scopedPresentation(database: Database, id: string, organizationId: string, lock = false): Promise<PresentationRow> {
  const result = await database.query<PresentationRow>(`${presentationSelect} WHERE id=$1 AND organization_id=$2${lock ? " FOR UPDATE" : ""}`, [id, organizationId]);
  if (!result.rows[0]) throw notFound("Apresentação");
  return result.rows[0];
}

export function registerPresentationRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/v1/presentations", async (request) => {
    const user = await authenticate(request, database);
    const result = await database.query<PresentationRow>(`${presentationSelect} WHERE organization_id=$1 AND status <> 'archived' ORDER BY updated_at DESC`, [user.organizationId]);
    return { items: result.rows };
  });

  app.post("/api/v1/presentations", async (request, reply) => {
    const user = await authenticate(request, database); requireWrite(user);
    const body = CreatePresentationSchema.parse(request.body);
    const created = await database.transaction(async (tx) => {
      const theme = await tx.query<{ id: string }>("SELECT id FROM themes WHERE organization_id=$1 AND is_default=true LIMIT 1", [user.organizationId]);
      if (!theme.rows[0]) throw new AppError(409, "DEFAULT_THEME_MISSING", "A organização não possui tema padrão.");
      const presentationId = randomUUID(), versionId = randomUUID(), mutationId = randomUUID();
      const content = initialPresentationContent(theme.rows[0].id);
      await tx.query("INSERT INTO presentations (id,organization_id,title,created_by) VALUES ($1,$2,$3,$4)", [presentationId, user.organizationId, body.title, user.id]);
      await tx.query(`INSERT INTO presentation_versions (id,organization_id,presentation_id,version_number,schema_version,state,content_json,content_hash,client_mutation_id,created_by)
        VALUES ($1,$2,$3,1,'1.0','checkpoint',$4::jsonb,$5,$6,$7)`, [versionId, user.organizationId, presentationId, JSON.stringify(content), contentHash(content), mutationId, user.id]);
      await tx.query("UPDATE presentations SET current_version_id=$1 WHERE id=$2", [versionId, presentationId]);
      await tx.query(`INSERT INTO presentation_drafts (presentation_id,organization_id,base_version_id,revision,content_json,last_mutation_id,updated_by)
        VALUES ($1,$2,$3,1,$4::jsonb,$5,$6)`, [presentationId, user.organizationId, versionId, JSON.stringify(content), mutationId, user.id]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "presentation.create", entityType: "presentation", entityId: presentationId, requestId: request.id });
      return { presentationId, versionId, content };
    });
    return reply.code(201).send(created);
  });

  app.get("/api/v1/presentations/:id", async (request) => {
    const user = await authenticate(request, database);
    const { id } = request.params as { id: string };
    const presentation = await scopedPresentation(database, id, user.organizationId);
    const [version, draft] = await Promise.all([
      database.query<VersionRow>(`${versionSelect} WHERE id=$1 AND presentation_id=$2`, [presentation.currentVersionId, id]),
      database.query<DraftRow>(`${draftSelect} WHERE presentation_id=$1 AND organization_id=$2`, [id, user.organizationId])
    ]);
    return { presentation, currentVersion: version.rows[0], draft: draft.rows[0] };
  });

  app.patch("/api/v1/presentations/:id", async (request) => {
    const user = await authenticate(request, database); requireWrite(user);
    const { id } = request.params as { id: string }; await scopedPresentation(database, id, user.organizationId);
    const body = UpdatePresentationSchema.parse(request.body);
    await database.transaction(async (tx) => {
      await tx.query("UPDATE presentations SET title=$1,updated_at=now() WHERE id=$2 AND organization_id=$3", [body.title, id, user.organizationId]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "presentation.rename", entityType: "presentation", entityId: id, requestId: request.id, metadata: { title: body.title } });
    });
    return scopedPresentation(database, id, user.organizationId);
  });

  app.put("/api/v1/presentations/:id/draft", async (request) => {
    const user = await authenticate(request, database); requireWrite(user);
    const { id } = request.params as { id: string }; await scopedPresentation(database, id, user.organizationId);
    const body = SaveDraftSchema.parse(request.body); const payloadHash = contentHash(body.content);
    return database.transaction(async (tx) => {
      const prior = await tx.query<{ payloadHash: string; response: DraftRow }>("SELECT payload_hash AS \"payloadHash\",response_json AS response FROM presentation_mutations WHERE presentation_id=$1 AND organization_id=$2 AND client_mutation_id=$3", [id, user.organizationId, body.clientMutationId]);
      if (prior.rows[0]) {
        if (prior.rows[0].payloadHash !== payloadHash) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "A identificação da alteração já foi usada com outro conteúdo.");
        return prior.rows[0].response;
      }
      const result = await tx.query<DraftRow>(`UPDATE presentation_drafts SET content_json=$1::jsonb,revision=revision+1,last_mutation_id=$2,updated_by=$3,updated_at=now()
        WHERE presentation_id=$4 AND organization_id=$5 AND base_version_id=$6 AND revision=$7
        RETURNING presentation_id AS "presentationId",base_version_id AS "baseVersionId",revision,content_json AS content,last_mutation_id AS "lastMutationId",updated_at AS "updatedAt"`,
        [JSON.stringify(body.content), body.clientMutationId, user.id, id, user.organizationId, body.baseVersionId, body.expectedRevision]);
      if (!result.rows[0]) {
        const concurrentReplay = await tx.query<{ payloadHash: string; response: DraftRow }>("SELECT payload_hash AS \"payloadHash\",response_json AS response FROM presentation_mutations WHERE presentation_id=$1 AND organization_id=$2 AND client_mutation_id=$3", [id, user.organizationId, body.clientMutationId]);
        if (concurrentReplay.rows[0]?.payloadHash === payloadHash) return concurrentReplay.rows[0].response;
        const current = await tx.query<{ revision: number; baseVersionId: string }>("SELECT revision,base_version_id AS \"baseVersionId\" FROM presentation_drafts WHERE presentation_id=$1 AND organization_id=$2", [id, user.organizationId]);
        throw new AppError(409, "AUTOSAVE_CONFLICT", "O rascunho foi alterado em outra sessão.", current.rows[0]);
      }
      await tx.query("UPDATE presentations SET updated_at=now() WHERE id=$1 AND organization_id=$2", [id, user.organizationId]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "presentation.autosave", entityType: "presentation", entityId: id, requestId: request.id, metadata: { revision: result.rows[0].revision } });
      await tx.query("INSERT INTO presentation_mutations (presentation_id,organization_id,client_mutation_id,operation,payload_hash,response_json) VALUES ($1,$2,$3,'autosave',$4,$5::jsonb)", [id, user.organizationId, body.clientMutationId, payloadHash, JSON.stringify(result.rows[0])]);
      return result.rows[0];
    });
  });

  app.post("/api/v1/presentations/:id/checkpoints", async (request, reply) => {
    const user = await authenticate(request, database); requireWrite(user);
    const { id } = request.params as { id: string };
    const body = CreateCheckpointSchema.parse(request.body);
    const version = await database.transaction(async (tx) => {
      const presentation = await scopedPresentation(tx, id, user.organizationId, true);
      const replay = await tx.query<VersionRow>(`${versionSelect} WHERE presentation_id=$1 AND client_mutation_id=$2`, [id, body.clientMutationId]);
      if (replay.rows[0]) return replay.rows[0];
      if (presentation.currentVersionId !== body.baseVersionId) throw new AppError(409, "VERSION_CONFLICT", "Uma nova versão já foi criada. Recarregue o editor.");
      const draft = await tx.query<DraftRow>(`${draftSelect} WHERE presentation_id=$1 AND organization_id=$2`, [id, user.organizationId]);
      const currentDraft = draft.rows[0];
      if (!currentDraft || currentDraft.revision !== body.draftRevision || currentDraft.baseVersionId !== body.baseVersionId) throw new AppError(409, "DRAFT_CONFLICT", "O rascunho mudou antes do checkpoint.");
      const parsed = PresentationContentSchema.parse(currentDraft.content);
      const number = await tx.query<{ next: number }>("SELECT coalesce(max(version_number),0)+1 AS next FROM presentation_versions WHERE presentation_id=$1", [id]);
      const versionId = randomUUID(), versionNumber = Number(number.rows[0]?.next ?? 1);
      await tx.query(`INSERT INTO presentation_versions (id,organization_id,presentation_id,version_number,schema_version,state,content_json,content_hash,base_version_id,client_mutation_id,created_by)
        VALUES ($1,$2,$3,$4,'1.0','checkpoint',$5::jsonb,$6,$7,$8,$9)`, [versionId, user.organizationId, id, versionNumber, JSON.stringify(parsed), contentHash(parsed), body.baseVersionId, body.clientMutationId, user.id]);
      await tx.query("UPDATE presentations SET current_version_id=$1,updated_at=now() WHERE id=$2 AND organization_id=$3", [versionId, id, user.organizationId]);
      await tx.query("UPDATE presentation_drafts SET base_version_id=$1,revision=1,last_mutation_id=$2,updated_at=now() WHERE presentation_id=$3 AND organization_id=$4", [versionId, body.clientMutationId, id, user.organizationId]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "presentation.checkpoint", entityType: "presentation", entityId: id, requestId: request.id, metadata: { versionNumber } });
      const created = await tx.query<VersionRow>(`${versionSelect} WHERE id=$1`, [versionId]);
      return created.rows[0]!;
    });
    return reply.code(201).send(version);
  });

  app.get("/api/v1/presentations/:id/versions", async (request) => {
    const user = await authenticate(request, database); const { id } = request.params as { id: string };
    await scopedPresentation(database, id, user.organizationId);
    const result = await database.query<VersionRow>(`${versionSelect} WHERE presentation_id=$1 ORDER BY version_number DESC`, [id]);
    return { items: result.rows };
  });

  app.get("/api/v1/presentations/:id/preview", async (request, reply) => {
    const user = await authenticate(request, database); const { id } = request.params as { id: string };
    const presentation = await scopedPresentation(database, id, user.organizationId);
    const draft = await database.query<DraftRow>(`${draftSelect} WHERE presentation_id=$1 AND organization_id=$2`, [id, user.organizationId]);
    if (!draft.rows[0]) throw notFound("Rascunho");
    const content = PresentationContentSchema.parse(draft.rows[0].content);
    const images = await loadPresentationImages(database, content, user.organizationId);
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "private, no-store")
      .send(renderPresentationDocument(content, presentation.title, imageDataUrls(images)));
  });
}
