import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AiOutlineSchema, ApproveOutlineSchema, GenerateOutlineSchema, GeneratePresentationFromOutlineSchema, IdSchema, PresentationContentSchema, RegenerateSlideSchema, RewriteBlockSchema, RewrittenTextSchema, type PresentationContent } from "@deckai/contracts";
import { AiProviderError, validateGeneratedSlideEvidence, validatePresentationEvidence, type ApprovedJumpContext, type OutlineProvider } from "../ai-provider.js";
import { audit } from "../audit.js";
import { authenticate, requireWrite } from "../auth.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";
import { contentHash } from "../security.js";

type JobRow = { id: string; status: string; kind: string; outlineId: string | null; inputMatches: boolean; output: unknown };
type VersionedJumpContext = ApprovedJumpContext & { versionId: string };
type OutlineRow = { id: string; title: string; status: "draft" | "approved"; revision: number; briefing: unknown; slides: unknown[]; createdAt: string; updatedAt: string };
type DraftRow = { presentationId: string; baseVersionId: string; revision: number; content: PresentationContent; lastMutationId: string; updatedAt: string };

const outlineSelect = `SELECT id,title,status,revision,briefing_json AS briefing,slides_json AS slides,created_at AS "createdAt",updated_at AS "updatedAt" FROM presentation_outlines`;
const parseOutline = (row: OutlineRow) => AiOutlineSchema.parse({ id: row.id, title: row.title, status: row.status, revision: row.revision, briefing: row.briefing, slides: row.slides });

export function registerAiRoutes(app: FastifyInstance, database: Database, provider: OutlineProvider): void {
  app.post("/api/v1/ai/outlines", async (request, reply) => {
    const user = await authenticate(request, database); requireWrite(user);
    const body = GenerateOutlineSchema.parse(request.body);
    const replay = async () => {
      const prior = await database.query<JobRow>("SELECT id,status,kind,outline_id AS \"outlineId\",input_json=$3::jsonb AS \"inputMatches\",output_json AS output FROM ai_generation_jobs WHERE organization_id=$1 AND idempotency_key=$2", [user.organizationId, body.idempotencyKey, JSON.stringify(body)]);
      if (!prior.rows[0]) return undefined;
      if (prior.rows[0].kind !== "outline" || !prior.rows[0].inputMatches) throw new AppError(409, "AI_IDEMPOTENCY_CONFLICT", "Esta chave de idempotência já foi usada para outra solicitação de IA.", { jobId: prior.rows[0].id });
      if (prior.rows[0].status === "succeeded") return prior.rows[0].output;
      throw new AppError(409, "AI_IDEMPOTENCY_CONFLICT", "Esta solicitação de IA já foi processada ou ainda está em andamento.", { jobId: prior.rows[0].id, status: prior.rows[0].status });
    };
    const prior = await replay();
    if (prior !== undefined) return prior;

    const jobId = randomUUID(); const startedAt = Date.now();
    const claimed = await database.query(`INSERT INTO ai_generation_jobs (id,organization_id,requested_by,kind,provider,model,prompt_version,status,idempotency_key,input_json)
      VALUES ($1,$2,$3,'outline',$4,$5,'outline-v1','running',$6,$7::jsonb)
      ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING id`, [jobId, user.organizationId, user.id, provider.name, provider.model, body.idempotencyKey, JSON.stringify(body)]);
    if (!claimed.rows.length) return replay();
    try {
      const contextResult = await database.query<VersionedJumpContext>(`SELECT c.id,v.id AS "versionId",c.title,v.body_json->>'text' AS text,v.source_label AS "sourceLabel",v.source_url AS "sourceUrl"
        FROM jump_contents c JOIN jump_content_versions v ON v.id=c.current_version_id AND v.content_id=c.id
        WHERE c.organization_id=$1 AND c.status='approved' AND c.current_version_id=c.approved_version_id AND v.source_label<>''
          AND (v.valid_from IS NULL OR v.valid_from<=CURRENT_DATE) AND (v.valid_until IS NULL OR v.valid_until>=CURRENT_DATE)
        ORDER BY c.updated_at DESC LIMIT 50`, [user.organizationId]);
      const providerContext: ApprovedJumpContext[] = contextResult.rows.map(({ versionId: _versionId, ...source }) => source);
      const generated = await provider.generateOutline(body.briefing, providerContext);
      const approvedVersions = new Map(contextResult.rows.map(source => [source.id, source.versionId]));
      const outline = AiOutlineSchema.parse({ id: randomUUID(), title: generated.title, status: "draft", revision: 1, briefing: body.briefing,
        slides: generated.slides.map(slide => ({ ...slide, id: randomUUID(), referenceIds: slide.referenceIds.map(contentId => {
          const versionId = approvedVersions.get(contentId);
          if (!versionId) throw new AiProviderError("AI_REFERENCE_NOT_ALLOWED", "A IA informou uma referência não aprovada.", false);
          return versionId;
        }) })) });
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
    const input = { outlineId: id, provider: body.provider };
    const replay = async () => {
      const prior = await database.query<JobRow>("SELECT id,status,kind,outline_id AS \"outlineId\",input_json=$3::jsonb AS \"inputMatches\",output_json AS output FROM ai_generation_jobs WHERE organization_id=$1 AND idempotency_key=$2", [user.organizationId, body.idempotencyKey, JSON.stringify(input)]);
      if (!prior.rows[0]) return undefined;
      if (prior.rows[0].kind !== "presentation" || prior.rows[0].outlineId !== id || !prior.rows[0].inputMatches) throw new AppError(409, "AI_IDEMPOTENCY_CONFLICT", "Esta chave de idempotência já foi usada para outra solicitação de IA.", { jobId: prior.rows[0].id });
      if (prior.rows[0].status === "succeeded") return prior.rows[0].output;
      throw new AppError(409, "AI_IDEMPOTENCY_CONFLICT", "Esta solicitação de IA já foi processada ou ainda está em andamento.", { jobId: prior.rows[0].id, status: prior.rows[0].status });
    };
    const prior = await replay();
    if (prior !== undefined) return prior;
    const outlineResult = await database.query<OutlineRow>(`${outlineSelect} WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
    if (!outlineResult.rows[0]) throw notFound("Roteiro");
    const outline = parseOutline(outlineResult.rows[0]);
    if (outline.status !== "approved") throw new AppError(409, "OUTLINE_NOT_APPROVED", "Aprove o roteiro antes de gerar os slides.");
    const jobId = randomUUID(); const startedAt = Date.now();
    const claimed = await database.query(`INSERT INTO ai_generation_jobs (id,organization_id,requested_by,outline_id,kind,provider,model,prompt_version,status,idempotency_key,input_json)
      VALUES ($1,$2,$3,$4,'presentation',$5,$6,'presentation-v1','running',$7,$8::jsonb)
      ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING id`, [jobId, user.organizationId, user.id, id, provider.name, provider.model, body.idempotencyKey, JSON.stringify(input)]);
    if (!claimed.rows.length) return replay();
    try {
      const contextResult = await database.query<VersionedJumpContext>(`SELECT c.id,v.id AS "versionId",c.title,v.body_json->>'text' AS text,v.source_label AS "sourceLabel",v.source_url AS "sourceUrl"
        FROM jump_contents c JOIN jump_content_versions v ON v.id=c.current_version_id AND v.content_id=c.id
        WHERE c.organization_id=$1 AND c.status='approved' AND c.current_version_id=c.approved_version_id AND v.source_label<>''
          AND (v.valid_from IS NULL OR v.valid_from<=CURRENT_DATE) AND (v.valid_until IS NULL OR v.valid_until>=CURRENT_DATE)
        ORDER BY c.updated_at DESC LIMIT 50`, [user.organizationId]);
      const providerContext: ApprovedJumpContext[] = contextResult.rows.map(({ versionId: _versionId, ...source }) => source);
      const approvedByVersion = new Map(contextResult.rows.map(source => [source.versionId, source.id]));
      const providerOutline = AiOutlineSchema.parse({ ...outline, slides: outline.slides.map(slide => ({ ...slide,
        referenceIds: slide.referenceIds.map(versionId => {
          const contentId = approvedByVersion.get(versionId);
          if (!contentId) throw new AppError(409, "OUTLINE_SOURCE_CHANGED", "Uma fonte do roteiro foi alterada ou perdeu a aprovação. Gere um novo roteiro.");
          return contentId;
        })
      })) });
      const generated = await provider.generatePresentation(providerOutline, providerContext);
      validatePresentationEvidence(generated, providerOutline, providerContext);
      const approvedVersions = new Map(contextResult.rows.map(item => [item.id, item.versionId]));
      const theme = await database.query<{ id: string }>("SELECT id FROM themes WHERE organization_id=$1 AND is_default=true LIMIT 1", [user.organizationId]);
      if (!theme.rows[0]) throw new AppError(409, "DEFAULT_THEME_MISSING", "A organização não possui tema padrão.");
      const content = PresentationContentSchema.parse({ schemaVersion: "1.0", canvas: { width: 1920, height: 1080, ratio: "16:9" }, themeId: theme.rows[0].id,
        slides: generated.slides.map(slide => ({ slideId: randomUUID(), layout: slide.layout, references: slide.referenceIds.map(referenceId => {
          const sourceVersionId = approvedVersions.get(referenceId);
          if (!sourceVersionId) throw new AiProviderError("AI_REFERENCE_NOT_ALLOWED", "A IA informou uma referência não aprovada.", false);
          return sourceVersionId;
        }),
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

  const slidePath = "/api/v1/presentations/:id/slides/:slideId";
  for (const kind of ["slide_regeneration", "rewrite"] as const) {
    const route = kind === "rewrite" ? "/blocks/:blockId/rewrite" : "/regenerate";
    app.post(slidePath + route, async (request) => {
      const user = await authenticate(request, database); requireWrite(user);
      const params = request.params as { id: string; slideId: string; blockId?: string };
      const id = IdSchema.parse(params.id);
      const slideId = IdSchema.parse(params.slideId);
      const body = kind === "rewrite" ? RewriteBlockSchema.parse(request.body) : RegenerateSlideSchema.parse(request.body);
      const { idempotencyKey, ...edit } = body;
      const input = {
        presentationId: id, slideId, ...edit,
        ...("operation" in edit ? { blockId: IdSchema.parse(params.blockId) } : {})
      };
      const replay = async () => {
        const result = await database.query<JobRow & { matches: boolean }>(`SELECT id,status,output_json AS output,error_json AS error,
          (kind=$5 AND requested_by=$3 AND input_json=$4::jsonb) AS matches
          FROM ai_generation_jobs WHERE organization_id=$1 AND idempotency_key=$2`,
          [user.organizationId, idempotencyKey, user.id, JSON.stringify(input), kind]);
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
      if (currentDraft.revision !== body.expectedRevision || currentDraft.baseVersionId !== body.baseVersionId) throw new AppError(409, "AUTOSAVE_CONFLICT", "O rascunho mudou antes da edição.", { revision: currentDraft.revision });
      const currentContent = PresentationContentSchema.parse(currentDraft.content); const slideIndex = currentContent.slides.findIndex(slide => slide.slideId === slideId);
      if (slideIndex < 0) throw notFound("Slide"); const currentSlide = currentContent.slides[slideIndex]!;
      const block = "operation" in body ? currentSlide.blocks.find(item => item.id === params.blockId) : undefined;
      if ("operation" in body) {
        if (!block) throw notFound("Bloco");
        if (block.type !== "text" || !block.text.trim()) {
          throw new AppError(422, "REWRITE_TEXT_REQUIRED", "Selecione um bloco de texto preenchido.");
        }
      }
      const jobId = randomUUID();
      const startedAt = Date.now();
      const promptVersion = kind === "rewrite" ? "block-rewrite-v1" : "slide-regeneration-v1";
      const claimed = await database.query(`INSERT INTO ai_generation_jobs (id,organization_id,requested_by,presentation_id,slide_id,kind,provider,model,prompt_version,status,idempotency_key,input_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'running',$10,$11::jsonb)
        ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING id`, [jobId, user.organizationId, user.id, id, slideId, kind, provider.name, provider.model, promptVersion, idempotencyKey, JSON.stringify(input)]);
      if (!claimed.rows.length) return replay();
      try {
        const nextContent = structuredClone(currentContent);
        let usage: unknown;
        if ("operation" in body) {
          if (block?.type !== "text") throw new Error("Bloco de texto esperado.");
          const rewritten = await provider.rewriteBlock(block.text, body);
          usage = rewritten.usage;
          const { text } = RewrittenTextSchema.parse({ text: rewritten.text });
          nextContent.slides[slideIndex]!.blocks = currentSlide.blocks.map(item =>
            item.id === block.id ? { ...block, text } : item
          );
        } else {
          const contextResult = await database.query<VersionedJumpContext>(`SELECT c.id,v.id AS "versionId",c.title,v.body_json->>'text' AS text,v.source_label AS "sourceLabel",v.source_url AS "sourceUrl"
            FROM jump_contents c JOIN jump_content_versions v ON v.id=c.current_version_id AND v.content_id=c.id
            WHERE c.organization_id=$1 AND c.status='approved' AND c.current_version_id=c.approved_version_id AND v.source_label<>''
              AND (v.valid_from IS NULL OR v.valid_from<=CURRENT_DATE) AND (v.valid_until IS NULL OR v.valid_until>=CURRENT_DATE)
            ORDER BY c.updated_at DESC LIMIT 50`, [user.organizationId]);
          const providerContext: ApprovedJumpContext[] = contextResult.rows.map(({ versionId: _versionId, ...source }) => source);
          const approvedVersions = new Map(contextResult.rows.map(item => [item.id, item.versionId]));
          const currentContentIds = new Map(contextResult.rows.map(item => [item.versionId, item.id]));
          const providerSlide = { ...currentSlide, references: currentSlide.references.flatMap(referenceId => {
            const contentId = currentContentIds.get(referenceId) ?? (approvedVersions.has(referenceId) ? referenceId : undefined);
            return contentId ? [contentId] : [];
          }) };
          const generated = await provider.regenerateSlide(providerSlide, body.instruction, providerContext);
          usage = generated.usage;
          const isTitle = (block: { type: string; role: string }) => block.type === "text" && block.role === "title";
          const titles = currentSlide.blocks.filter(isTitle);
          const images = currentSlide.blocks.filter(block => block.type === "image");
          const generatedBlocks = titles.length ? generated.blocks.filter(block => !isTitle(block)) : generated.blocks;
          const finalBlocks = [...titles, ...generatedBlocks.map(block => ({ ...block, id: randomUUID() })), ...images];
          validateGeneratedSlideEvidence({ blocks: finalBlocks, referenceIds: generated.referenceIds }, providerContext);
          nextContent.slides[slideIndex] = {
            ...currentSlide,
            blocks: finalBlocks,
            references: [...new Set(generated.referenceIds.map(referenceId => approvedVersions.get(referenceId)!))]
          };
        }
        const validContent = PresentationContentSchema.parse(nextContent); const mutationId = randomUUID();
        const response = await database.transaction(async (tx) => {
          const updated = await tx.query<DraftRow>(`UPDATE presentation_drafts SET content_json=$1::jsonb,revision=revision+1,last_mutation_id=$2,updated_by=$3,updated_at=now()
            WHERE presentation_id=$4 AND organization_id=$5 AND revision=$6 AND base_version_id=$7 AND last_mutation_id=$8
            RETURNING presentation_id AS "presentationId",base_version_id AS "baseVersionId",revision,content_json AS content,last_mutation_id AS "lastMutationId",updated_at AS "updatedAt"`,
            [JSON.stringify(validContent), mutationId, user.id, id, user.organizationId, body.expectedRevision, body.baseVersionId, currentDraft.lastMutationId]);
          if (!updated.rows[0]) throw new AppError(409, "AUTOSAVE_CONFLICT", "O rascunho mudou durante a edição.");
          const payload = { job: { id: jobId, status: "succeeded", provider: provider.name, model: provider.model, durationMs: Date.now() - startedAt }, draft: updated.rows[0], ...("operation" in body ? { rewrittenSlideId: slideId, rewrittenBlockId: block!.id } : { regeneratedSlideId: slideId }) };
          await tx.query("UPDATE presentations SET updated_at=now() WHERE id=$1 AND organization_id=$2", [id, user.organizationId]);
          await tx.query("UPDATE ai_generation_jobs SET status='succeeded',output_json=$1::jsonb,usage_json=$2::jsonb,duration_ms=$3,updated_at=now() WHERE id=$4 AND organization_id=$5", [JSON.stringify(payload), JSON.stringify(usage ?? {}), Date.now() - startedAt, jobId, user.organizationId]);
          await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: kind === "rewrite" ? "ai.block.rewrite" : "ai.slide.regenerate", entityType: "presentation", entityId: id, requestId: request.id, metadata: { jobId, slideId, blockId: block?.id, revision: updated.rows[0].revision } });
          return payload;
        });
        return response;
      } catch (error) {
        const failure = error instanceof AiProviderError ? error : error instanceof AppError ? new AiProviderError(error.code, error.message, error.retryable, error.status) : new AiProviderError("AI_GENERATION_FAILED", "A edição por IA falhou.", false);
        await database.query("UPDATE ai_generation_jobs SET status='failed',error_json=$1::jsonb,duration_ms=$2,updated_at=now() WHERE id=$3 AND organization_id=$4", [JSON.stringify({ code: failure.code, message: failure.message, retryable: failure.retryable }), Date.now() - startedAt, jobId, user.organizationId]);
        throw new AppError(failure.status, failure.code, failure.message, { jobId }, failure.retryable);
      }
    });
  }
}
