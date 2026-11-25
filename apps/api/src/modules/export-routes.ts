import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { IdSchema, RequestPdfExportSchema, type ExportJob } from "@deckai/contracts";
import { audit } from "../audit.js";
import { authenticate, requireWrite } from "../auth.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";

const jobFields = `id,organization_id AS "organizationId",presentation_id AS "presentationId",
  version_id AS "versionId",format,status,attempt,max_attempts AS "maxAttempts"`;

export function registerExportRoutes(app: FastifyInstance, database: Database): void {
  app.post("/api/v1/presentations/:id/exports/pdf", async (request, reply) => {
    const user = await authenticate(request, database);
    requireWrite(user);
    const presentationId = IdSchema.parse((request.params as { id: string }).id);
    const { versionId, idempotencyKey } = RequestPdfExportSchema.parse(request.body);

    const { job, created } = await database.transaction(async tx => {
      const inserted = await tx.query<ExportJob>(`INSERT INTO export_jobs
        (id,organization_id,presentation_id,version_id,format,status,idempotency_key,requested_by)
        SELECT $1,v.organization_id,v.presentation_id,v.id,'pdf','queued',$2,$3
        FROM presentation_versions v JOIN presentations p
          ON p.id=v.presentation_id AND p.organization_id=v.organization_id
        WHERE v.id=$4 AND v.presentation_id=$5 AND v.organization_id=$6 AND p.status<>'archived'
        ON CONFLICT (organization_id,idempotency_key) DO NOTHING
        RETURNING ${jobFields}`,
        [randomUUID(), idempotencyKey, user.id, versionId, presentationId, user.organizationId]);

      const job = inserted.rows[0];
      if (job) {
        await audit(tx, {
          organizationId: user.organizationId, actorId: user.id, action: "export.pdf.request",
          entityType: "export_job", entityId: job.id, requestId: request.id,
          metadata: { presentationId, versionId }
        });
        return { job, created: true };
      }

      const existing = await tx.query<ExportJob & { requestedBy: string }>(
        `SELECT ${jobFields},requested_by AS "requestedBy" FROM export_jobs WHERE organization_id=$1 AND idempotency_key=$2`,
        [user.organizationId, idempotencyKey]);
      const prior = existing.rows[0];
      if (!prior) throw notFound("Versão da apresentação");
      const { requestedBy, ...priorJob } = prior;
      if (requestedBy !== user.id || priorJob.presentationId !== presentationId || priorJob.versionId !== versionId || priorJob.format !== "pdf") {
        throw new AppError(409, "EXPORT_IDEMPOTENCY_CONFLICT", "Esta chave já está associada a outra solicitação.");
      }
      return { job: priorJob, created: false };
    });

    return reply.code(created ? 202 : 200).send({ job });
  });

  app.get("/api/v1/exports/:id", async request => {
    const user = await authenticate(request, database);
    const id = IdSchema.parse((request.params as { id: string }).id);
    const result = await database.query<ExportJob>(
      `SELECT ${jobFields} FROM export_jobs WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
    const job = result.rows[0];
    if (!job) throw notFound("Exportação");
    return { job };
  });
}
