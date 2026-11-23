import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AiOutlineSchema, ApproveOutlineSchema, GenerateOutlineSchema } from "@deckai/contracts";
import { AiProviderError, type ApprovedJumpContext, type OutlineProvider } from "../ai-provider.js";
import { audit } from "../audit.js";
import { authenticate, requireWrite } from "../auth.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";

type JobRow = { id: string; status: string; output: unknown; error: unknown };
type OutlineRow = { id: string; title: string; status: "draft" | "approved"; revision: number; briefing: unknown; slides: unknown[]; createdAt: string; updatedAt: string };

const outlineSelect = `SELECT id,title,status,revision,briefing_json AS briefing,slides_json AS slides,created_at AS "createdAt",updated_at AS "updatedAt" FROM presentation_outlines`;
const parseOutline = (row: OutlineRow) => AiOutlineSchema.parse({ id: row.id, title: row.title, status: row.status, revision: row.revision, briefing: row.briefing, slides: row.slides });

export function registerAiRoutes(app: FastifyInstance, database: Database, provider: OutlineProvider): void {
  app.post("/api/v1/ai/outlines", async (request, reply) => {
    const user = await authenticate(request, database); requireWrite(user);
    const body = GenerateOutlineSchema.parse(request.body);
    const prior = await database.query<JobRow>("SELECT id,status,output_json AS output,error_json AS error FROM ai_generation_jobs WHERE organization_id=$1 AND idempotency_key=$2", [user.organizationId, body.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].status === "succeeded") return prior.rows[0].output;
      throw new AppError(409, "AI_IDEMPOTENCY_CONFLICT", "Esta solicitação de IA já foi processada ou ainda está em andamento.", { jobId: prior.rows[0].id, status: prior.rows[0].status });
    }

    const jobId = randomUUID(); const startedAt = Date.now();
    await database.query(`INSERT INTO ai_generation_jobs (id,organization_id,requested_by,kind,provider,model,prompt_version,status,idempotency_key,input_json)
      VALUES ($1,$2,$3,'outline',$4,$5,'outline-v1','running',$6,$7::jsonb)`, [jobId, user.organizationId, user.id, provider.name, provider.model, body.idempotencyKey, JSON.stringify(body)]);
    try {
      const contextResult = await database.query<ApprovedJumpContext>(`SELECT c.id,c.title,v.body_json->>'text' AS text,v.source_label AS "sourceLabel",v.source_url AS "sourceUrl"
        FROM jump_contents c JOIN jump_content_versions v ON v.id=c.current_version_id AND v.content_id=c.id
        WHERE c.organization_id=$1 AND c.status='approved' AND c.current_version_id=c.approved_version_id AND v.source_label<>''
          AND (v.valid_from IS NULL OR v.valid_from<=CURRENT_DATE) AND (v.valid_until IS NULL OR v.valid_until>=CURRENT_DATE)
        ORDER BY c.updated_at DESC LIMIT 50`, [user.organizationId]);
      const generated = await provider.generateOutline(body.briefing, contextResult.rows);
      const outline = AiOutlineSchema.parse({ id: randomUUID(), title: generated.title, status: "draft", revision: 1, briefing: body.briefing,
        slides: generated.slides.map(slide => ({ ...slide, id: randomUUID() })) });
      const response = { job: { id: jobId, status: "succeeded", provider: provider.name, model: provider.model, durationMs: Date.now() - startedAt }, outline };
      await database.transaction(async (tx) => {
        await tx.query(`INSERT INTO presentation_outlines (id,organization_id,title,briefing_json,slides_json,created_by)
          VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`, [outline.id, user.organizationId, outline.title, JSON.stringify(outline.briefing), JSON.stringify(outline.slides), user.id]);
        await tx.query("UPDATE ai_generation_jobs SET outline_id=$1,status='succeeded',output_json=$2::jsonb,usage_json=$3::jsonb,duration_ms=$4,updated_at=now() WHERE id=$5 AND organization_id=$6", [outline.id, JSON.stringify(response), JSON.stringify(generated.usage ?? {}), Date.now() - startedAt, jobId, user.organizationId]);
        await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "ai.outline.generate", entityType: "presentation_outline", entityId: outline.id, requestId: request.id, metadata: { jobId, provider: provider.name, model: provider.model, references: [...new Set(outline.slides.flatMap(slide => slide.referenceIds))] } });
      });
      return reply.code(201).send(response);
    } catch (error) {
      const failure = error instanceof AiProviderError ? error : new AiProviderError("AI_GENERATION_FAILED", "A geração do roteiro falhou.", false);
      await database.query("UPDATE ai_generation_jobs SET status='failed',error_json=$1::jsonb,duration_ms=$2,updated_at=now() WHERE id=$3 AND organization_id=$4", [JSON.stringify({ code: failure.code, message: failure.message, retryable: failure.retryable }), Date.now() - startedAt, jobId, user.organizationId]);
      throw new AppError(failure.status, failure.code, failure.message, { jobId }, failure.retryable);
    }
  });

  app.get("/api/v1/ai/outlines", async (request) => {
    const user = await authenticate(request, database);
    const result = await database.query<OutlineRow>(`${outlineSelect} WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`, [user.organizationId]);
    return { items: result.rows.map(parseOutline) };
  });

  app.get("/api/v1/ai/outlines/:id", async (request) => {
    const user = await authenticate(request, database); const { id } = request.params as { id: string };
    const result = await database.query<OutlineRow>(`${outlineSelect} WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
    if (!result.rows[0]) throw notFound("Roteiro");
    return parseOutline(result.rows[0]);
  });

  app.post("/api/v1/ai/outlines/:id/approve", async (request) => {
    const user = await authenticate(request, database); requireWrite(user); const { id } = request.params as { id: string };
    const body = ApproveOutlineSchema.parse(request.body);
    const result = await database.transaction(async (tx) => {
      const updated = await tx.query<OutlineRow>(`UPDATE presentation_outlines SET status='approved',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='draft' AND revision=$3
        RETURNING id,title,status,revision,briefing_json AS briefing,slides_json AS slides,created_at AS "createdAt",updated_at AS "updatedAt"`, [id, user.organizationId, body.expectedRevision]);
      if (!updated.rows[0]) {
        const existing = await tx.query<{ id: string }>("SELECT id FROM presentation_outlines WHERE id=$1 AND organization_id=$2", [id, user.organizationId]);
        if (!existing.rows[0]) throw notFound("Roteiro");
        throw new AppError(409, "OUTLINE_APPROVAL_CONFLICT", "O roteiro mudou ou já foi aprovado.");
      }
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "ai.outline.approve", entityType: "presentation_outline", entityId: id, requestId: request.id, metadata: { revision: body.expectedRevision } });
      return updated.rows[0];
    });
    return parseOutline(result);
  });
}
