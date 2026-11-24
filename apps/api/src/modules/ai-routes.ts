import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AiOutlineSchema, ApproveOutlineSchema, GenerateOutlineSchema, GeneratePresentationFromOutlineSchema, PresentationContentSchema, RegenerateSlideSchema, type PresentationContent } from "@deckai/contracts";
import { AiProviderError, type ApprovedJumpContext, type OutlineProvider } from "../ai-provider.js";
import { audit } from "../audit.js";
import { authenticate, requireWrite } from "../auth.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";
import { contentHash } from "../security.js";

type JobRow = { id: string; status: string; output: unknown; error: unknown };
type OutlineRow = { id: string; title: string; status: "draft" | "approved"; revision: number; briefing: unknown; slides: unknown[]; createdAt: string; updatedAt: string };
type DraftRow = { presentationId: string; baseVersionId: string; revision: number; content: PresentationContent; lastMutationId: string; updatedAt: string };

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

  app.post("/api/v1/ai/outlines/:id/presentation", async (request, reply) => {
    const user = await authenticate(request, database); requireWrite(user); const { id } = request.params as { id: string };
    const body = GeneratePresentationFromOutlineSchema.parse(request.body);
    const prior = await database.query<JobRow>("SELECT id,status,output_json AS output,error_json AS error FROM ai_generation_jobs WHERE organization_id=$1 AND idempotency_key=$2", [user.organizationId, body.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].status === "succeeded") return prior.rows[0].output;
      throw new AppError(409, "AI_IDEMPOTENCY_CONFLICT", "Esta solicitação de IA já foi processada ou ainda está em andamento.", { jobId: prior.rows[0].id, status: prior.rows[0].status });
    }
    const outlineResult = await database.query<OutlineRow>(`${outlineSelect} WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
    if (!outlineResult.rows[0]) throw notFound("Roteiro");
    const outline = parseOutline(outlineResult.rows[0]);
    if (outline.status !== "approved") throw new AppError(409, "OUTLINE_NOT_APPROVED", "Aprove o roteiro antes de gerar os slides.");
    const jobId = randomUUID(); const startedAt = Date.now();
    await database.query(`INSERT INTO ai_generation_jobs (id,organization_id,requested_by,outline_id,kind,provider,model,prompt_version,status,idempotency_key,input_json)
      VALUES ($1,$2,$3,$4,'presentation',$5,$6,'presentation-v1','running',$7,$8::jsonb)`, [jobId, user.organizationId, user.id, id, provider.name, provider.model, body.idempotencyKey, JSON.stringify({ outlineId: id, provider: body.provider })]);
    try {
      const contextResult = await database.query<ApprovedJumpContext>(`SELECT c.id,c.title,v.body_json->>'text' AS text,v.source_label AS "sourceLabel",v.source_url AS "sourceUrl"
        FROM jump_contents c JOIN jump_content_versions v ON v.id=c.current_version_id AND v.content_id=c.id
        WHERE c.organization_id=$1 AND c.status='approved' AND c.current_version_id=c.approved_version_id AND v.source_label<>''
          AND (v.valid_from IS NULL OR v.valid_from<=CURRENT_DATE) AND (v.valid_until IS NULL OR v.valid_until>=CURRENT_DATE)
        ORDER BY c.updated_at DESC LIMIT 50`, [user.organizationId]);
      const generated = await provider.generatePresentation(outline, contextResult.rows);
      const theme = await database.query<{ id: string }>("SELECT id FROM themes WHERE organization_id=$1 AND is_default=true LIMIT 1", [user.organizationId]);
      if (!theme.rows[0]) throw new AppError(409, "DEFAULT_THEME_MISSING", "A organização não possui tema padrão.");
      const content = PresentationContentSchema.parse({ schemaVersion: "1.0", canvas: { width: 1920, height: 1080, ratio: "16:9" }, themeId: theme.rows[0].id,
        slides: generated.slides.map(slide => ({ slideId: randomUUID(), layout: slide.layout, references: slide.referenceIds,
          blocks: slide.blocks.map(block => ({ ...block, id: randomUUID() })) })) });
      const presentationId = randomUUID(), versionId = randomUUID(), mutationId = randomUUID();
      const response = { job: { id: jobId, status: "succeeded", provider: provider.name, model: provider.model, durationMs: Date.now() - startedAt }, presentation: { id: presentationId, title: outline.title, versionId } };
      await database.transaction(async (tx) => {
        await tx.query("INSERT INTO presentations (id,organization_id,title,created_by) VALUES ($1,$2,$3,$4)", [presentationId, user.organizationId, outline.title, user.id]);
        await tx.query(`INSERT INTO presentation_versions (id,organization_id,presentation_id,version_number,schema_version,state,content_json,content_hash,client_mutation_id,created_by)
          VALUES ($1,$2,$3,1,'1.0','checkpoint',$4::jsonb,$5,$6,$7)`, [versionId, user.organizationId, presentationId, JSON.stringify(content), contentHash(content), mutationId, user.id]);
        await tx.query("UPDATE presentations SET current_version_id=$1 WHERE id=$2 AND organization_id=$3", [versionId, presentationId, user.organizationId]);
        await tx.query(`INSERT INTO presentation_drafts (presentation_id,organization_id,base_version_id,revision,content_json,last_mutation_id,updated_by)
          VALUES ($1,$2,$3,1,$4::jsonb,$5,$6)`, [presentationId, user.organizationId, versionId, JSON.stringify(content), mutationId, user.id]);
        await tx.query("UPDATE ai_generation_jobs SET status='succeeded',output_json=$1::jsonb,usage_json=$2::jsonb,duration_ms=$3,updated_at=now() WHERE id=$4 AND organization_id=$5", [JSON.stringify(response), JSON.stringify(generated.usage ?? {}), Date.now() - startedAt, jobId, user.organizationId]);
        await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "ai.presentation.generate", entityType: "presentation", entityId: presentationId, requestId: request.id, metadata: { jobId, outlineId: id, provider: provider.name, model: provider.model } });
      });
      return reply.code(201).send(response);
    } catch (error) {
      const failure = error instanceof AiProviderError ? error : error instanceof AppError ? new AiProviderError(error.code, error.message, error.retryable, error.status) : new AiProviderError("AI_GENERATION_FAILED", "A geração da apresentação falhou.", false);
      await database.query("UPDATE ai_generation_jobs SET status='failed',error_json=$1::jsonb,duration_ms=$2,updated_at=now() WHERE id=$3 AND organization_id=$4", [JSON.stringify({ code: failure.code, message: failure.message, retryable: failure.retryable }), Date.now() - startedAt, jobId, user.organizationId]);
      throw new AppError(failure.status, failure.code, failure.message, { jobId }, failure.retryable);
    }
  });

  app.post("/api/v1/presentations/:id/slides/:slideId/regenerate", async (request) => {
    const user = await authenticate(request, database); requireWrite(user);
    const { id, slideId } = request.params as { id: string; slideId: string }; const body = RegenerateSlideSchema.parse(request.body);
    const input = { presentationId: id, slideId, baseVersionId: body.baseVersionId, instruction: body.instruction, expectedRevision: body.expectedRevision };
    const replay = async () => {
      const result = await database.query<JobRow & { matches: boolean }>(`SELECT id,status,output_json AS output,error_json AS error,
        (kind='slide_regeneration' AND requested_by=$3 AND input_json=$4::jsonb) AS matches
        FROM ai_generation_jobs WHERE organization_id=$1 AND idempotency_key=$2`,
        [user.organizationId, body.idempotencyKey, user.id, JSON.stringify(input)]);
      const prior = result.rows[0];
      if (!prior) return undefined;
      if (prior.matches && prior.status === "succeeded") return prior.output;
      throw new AppError(409, "AI_IDEMPOTENCY_CONFLICT", "Esta chave já está associada a uma solicitação de IA.", { jobId: prior.id, status: prior.status });
    };
    const prior = await replay();
    if (prior !== undefined) return prior;
    const draftResult = await database.query<DraftRow>(`SELECT d.presentation_id AS "presentationId",d.base_version_id AS "baseVersionId",d.revision,d.content_json AS content,d.last_mutation_id AS "lastMutationId",d.updated_at AS "updatedAt"
      FROM presentation_drafts d JOIN presentations p ON p.id=d.presentation_id AND p.organization_id=d.organization_id
      WHERE d.presentation_id=$1 AND d.organization_id=$2`, [id, user.organizationId]);
    const currentDraft = draftResult.rows[0]; if (!currentDraft) throw notFound("Apresentação");
    if (currentDraft.revision !== body.expectedRevision || currentDraft.baseVersionId !== body.baseVersionId) throw new AppError(409, "AUTOSAVE_CONFLICT", "O rascunho mudou antes da regeneração.", { revision: currentDraft.revision });
    const currentContent = PresentationContentSchema.parse(currentDraft.content); const slideIndex = currentContent.slides.findIndex(slide => slide.slideId === slideId);
    if (slideIndex < 0) throw notFound("Slide"); const currentSlide = currentContent.slides[slideIndex]!;
    const jobId = randomUUID(); const startedAt = Date.now();
    const claimed = await database.query(`INSERT INTO ai_generation_jobs (id,organization_id,requested_by,presentation_id,slide_id,kind,provider,model,prompt_version,status,idempotency_key,input_json)
      VALUES ($1,$2,$3,$4,$5,'slide_regeneration',$6,$7,'slide-regeneration-v1','running',$8,$9::jsonb)
      ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING id`, [jobId, user.organizationId, user.id, id, slideId, provider.name, provider.model, body.idempotencyKey, JSON.stringify(input)]);
    if (!claimed.rows.length) return replay();
    try {
      const contextResult = await database.query<ApprovedJumpContext>(`SELECT c.id,c.title,v.body_json->>'text' AS text,v.source_label AS "sourceLabel",v.source_url AS "sourceUrl"
        FROM jump_contents c JOIN jump_content_versions v ON v.id=c.current_version_id AND v.content_id=c.id
        WHERE c.organization_id=$1 AND c.status='approved' AND c.current_version_id=c.approved_version_id AND v.source_label<>''
          AND (v.valid_from IS NULL OR v.valid_from<=CURRENT_DATE) AND (v.valid_until IS NULL OR v.valid_until>=CURRENT_DATE)
        ORDER BY c.updated_at DESC LIMIT 50`, [user.organizationId]);
      const generated = await provider.regenerateSlide(currentSlide, body.instruction, contextResult.rows);
      const allowedReferences = new Set(contextResult.rows.map(item => item.id));
      if (generated.referenceIds.some(reference => !allowedReferences.has(reference))) {
        throw new AiProviderError("AI_REFERENCE_NOT_ALLOWED", "A IA informou uma referência não aprovada.", false);
      }
      const isTitle = (block: { type: string; role: string }) => block.type === "text" && block.role === "title";
      const titles = currentSlide.blocks.filter(isTitle);
      const images = currentSlide.blocks.filter(block => block.type === "image");
      const generatedBlocks = titles.length ? generated.blocks.filter(block => !isTitle(block)) : generated.blocks;
      const nextContent = structuredClone(currentContent);
      nextContent.slides[slideIndex] = {
        ...currentSlide,
        blocks: [...titles, ...generatedBlocks.map(block => ({ ...block, id: randomUUID() })), ...images],
        references: [...new Set(generated.referenceIds)]
      };
      const validContent = PresentationContentSchema.parse(nextContent); const mutationId = randomUUID();
      const response = await database.transaction(async (tx) => {
        const updated = await tx.query<DraftRow>(`UPDATE presentation_drafts SET content_json=$1::jsonb,revision=revision+1,last_mutation_id=$2,updated_by=$3,updated_at=now()
          WHERE presentation_id=$4 AND organization_id=$5 AND revision=$6 AND base_version_id=$7 AND last_mutation_id=$8
          RETURNING presentation_id AS "presentationId",base_version_id AS "baseVersionId",revision,content_json AS content,last_mutation_id AS "lastMutationId",updated_at AS "updatedAt"`,
          [JSON.stringify(validContent), mutationId, user.id, id, user.organizationId, body.expectedRevision, body.baseVersionId, currentDraft.lastMutationId]);
        if (!updated.rows[0]) throw new AppError(409, "AUTOSAVE_CONFLICT", "O rascunho mudou durante a regeneração.");
        const payload = { job: { id: jobId, status: "succeeded", provider: provider.name, model: provider.model, durationMs: Date.now() - startedAt }, draft: updated.rows[0], regeneratedSlideId: slideId };
        await tx.query("UPDATE presentations SET updated_at=now() WHERE id=$1 AND organization_id=$2", [id, user.organizationId]);
        await tx.query("UPDATE ai_generation_jobs SET status='succeeded',output_json=$1::jsonb,usage_json=$2::jsonb,duration_ms=$3,updated_at=now() WHERE id=$4 AND organization_id=$5", [JSON.stringify(payload), JSON.stringify(generated.usage ?? {}), Date.now() - startedAt, jobId, user.organizationId]);
        await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "ai.slide.regenerate", entityType: "presentation", entityId: id, requestId: request.id, metadata: { jobId, slideId, revision: updated.rows[0].revision } });
        return payload;
      });
      return response;
    } catch (error) {
      const failure = error instanceof AiProviderError ? error : error instanceof AppError ? new AiProviderError(error.code, error.message, error.retryable, error.status) : new AiProviderError("AI_GENERATION_FAILED", "A regeneração do slide falhou.", false);
      await database.query("UPDATE ai_generation_jobs SET status='failed',error_json=$1::jsonb,duration_ms=$2,updated_at=now() WHERE id=$3 AND organization_id=$4", [JSON.stringify({ code: failure.code, message: failure.message, retryable: failure.retryable }), Date.now() - startedAt, jobId, user.organizationId]);
      throw new AppError(failure.status, failure.code, failure.message, { jobId }, failure.retryable);
    }
  });
}
