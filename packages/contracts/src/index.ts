import { z } from "zod";

export const IdSchema = z.string().uuid();
export const RoleSchema = z.enum(["owner", "editor", "reviewer", "viewer"]);
export const JobStatusSchema = z.enum(["queued", "running", "retrying", "succeeded", "failed", "cancelled", "dead_letter"]);
export const RequestPdfExportSchema = z.object({
  versionId: IdSchema,
  idempotencyKey: IdSchema
}).strict();
export const VersionStateSchema = z.enum(["checkpoint", "confirmed"]);
export const LayoutSchema = z.enum(["cover", "text_image", "two_columns", "metrics", "case", "closing"]);

export const TextBlockSchema = z.object({
  id: IdSchema,
  type: z.literal("text"),
  role: z.enum(["title", "subtitle", "body", "caption", "cta"]),
  text: z.string().max(4000)
}).strict();

export const ImageBlockSchema = z.object({
  id: IdSchema,
  type: z.literal("image"),
  role: z.string().max(80),
  assetId: IdSchema.nullable(),
  alt: z.string().max(500).default("")
}).strict();

export const MetricBlockSchema = z.object({
  id: IdSchema,
  type: z.literal("metric"),
  role: z.string().max(80),
  value: z.string().max(80),
  label: z.string().max(240),
  unit: z.string().max(40).optional()
}).strict();

export const BlockSchema = z.discriminatedUnion("type", [TextBlockSchema, ImageBlockSchema, MetricBlockSchema]);
export type Block = z.infer<typeof BlockSchema>;

export const SlideSchema = z.object({
  slideId: IdSchema,
  layout: LayoutSchema,
  blocks: z.array(BlockSchema).max(30),
  references: z.array(IdSchema).max(100)
}).strict().superRefine((slide, context) => {
  const ids = new Set<string>();
  slide.blocks.forEach((block, index) => {
    if (ids.has(block.id)) context.addIssue({ code: "custom", path: ["blocks", index, "id"], message: "ID de bloco duplicado no slide." });
    ids.add(block.id);
  });
});
export type Slide = z.infer<typeof SlideSchema>;

export const PresentationContentSchema = z.object({
  schemaVersion: z.literal("1.0"),
  canvas: z.object({ width: z.literal(1920), height: z.literal(1080), ratio: z.literal("16:9") }).strict(),
  themeId: IdSchema,
  slides: z.array(SlideSchema).min(1).max(60)
}).strict().superRefine((presentation, context) => {
  const slideIds = new Set<string>();
  const blockIds = new Set<string>();
  presentation.slides.forEach((slide, slideIndex) => {
    if (slideIds.has(slide.slideId)) context.addIssue({ code: "custom", path: ["slides", slideIndex, "slideId"], message: "ID de slide duplicado." });
    slideIds.add(slide.slideId);
    slide.blocks.forEach((block, blockIndex) => {
      if (blockIds.has(block.id)) context.addIssue({ code: "custom", path: ["slides", slideIndex, "blocks", blockIndex, "id"], message: "ID de bloco duplicado na apresentação." });
      blockIds.add(block.id);
    });
  });
});
export type PresentationContent = z.infer<typeof PresentationContentSchema>;

export const BootstrapSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128)
});

export const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });
export const CreateMemberSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["editor", "reviewer", "viewer"]),
  temporaryPassword: z.string().min(10).max(128)
});
export const UpdateMemberSchema = z.object({ role: RoleSchema.optional(), status: z.enum(["active", "disabled"]).optional() }).refine(value => value.role || value.status, "Informe uma alteração.");
export const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) });
export const JumpKindSchema = z.enum(["history", "service", "client", "case", "metric", "image", "brand", "source_document"]);
export const JumpStatusSchema = z.enum(["draft", "in_review", "approved", "rejected", "archived"]);
export const JumpContentInputSchema = z.object({
  kind: JumpKindSchema,
  title: z.string().trim().min(2).max(180),
  text: z.string().trim().min(1).max(20_000),
  sourceLabel: z.string().trim().min(2).max(240),
  sourceUrl: z.string().url().max(2_000).optional().or(z.literal("")),
  sourceLocator: z.string().trim().max(240).optional(),
  validFrom: z.string().date().optional(),
  validUntil: z.string().date().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([])
}).strict().refine(value => !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom, { message: "A validade final deve ser posterior à inicial.", path: ["validUntil"] });
export const JumpReviewSchema = z.object({ note: z.string().trim().max(2_000).optional() }).strict();
export const JumpListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: JumpStatusSchema.optional(),
  kind: JumpKindSchema.optional()
}).strict();
export const JumpContextQuerySchema = z.object({ q: z.string().trim().max(200).optional() }).strict();
export const AiBriefingSchema = z.object({
  prompt: z.string().trim().min(1).max(10_000),
  objective: z.string().trim().min(1).max(500),
  audience: z.string().trim().min(1).max(300),
  tone: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(40).default("pt-BR"),
  slideCount: z.number().int().min(1).max(12)
}).strict();
export const AiOutlineSlideSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1).max(300),
  objective: z.string().trim().min(1).max(1_000),
  layout: LayoutSchema,
  keyPoints: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
  referenceIds: z.array(IdSchema).max(30)
}).strict();
export const AiOutlineSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1).max(180),
  status: z.enum(["draft", "approved"]),
  revision: z.number().int().positive(),
  briefing: AiBriefingSchema,
  slides: z.array(AiOutlineSlideSchema).min(1).max(12)
}).strict();
export const GenerateOutlineSchema = z.object({
  idempotencyKey: IdSchema,
  provider: z.literal("deepseek").default("deepseek"),
  briefing: AiBriefingSchema
}).strict();
export const ApproveOutlineSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const GeneratePresentationFromOutlineSchema = z.object({
  idempotencyKey: IdSchema,
  provider: z.literal("deepseek").default("deepseek")
}).strict();
export const RegenerateSlideSchema = z.object({
  idempotencyKey: IdSchema,
  baseVersionId: IdSchema,
  expectedRevision: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(2_000)
}).strict();
const rewriteRevision = RegenerateSlideSchema.omit({ instruction: true });
const rewriteTone = z.string().trim().min(1).max(120);
export const RewriteBlockSchema = z.discriminatedUnion("operation", [
  rewriteRevision.extend({ operation: z.literal("summarize") }),
  rewriteRevision.extend({ operation: z.literal("expand") }),
  rewriteRevision.extend({ operation: z.literal("tone"), tone: rewriteTone })
]);
export type RewriteBlockInput = z.infer<typeof RewriteBlockSchema>;
export const RewrittenTextSchema = z.object({ text: z.string().trim().min(1).max(4000) }).strict();

export const CreatePresentationSchema = z.object({ title: z.string().trim().min(1).max(180) });
export const UpdatePresentationSchema = z.object({ title: z.string().trim().min(1).max(180) }).strict();
export const SaveDraftSchema = z.object({
  baseVersionId: IdSchema,
  expectedRevision: z.number().int().positive(),
  clientMutationId: IdSchema,
  content: PresentationContentSchema
});
export const CreateCheckpointSchema = z.object({
  baseVersionId: IdSchema,
  draftRevision: z.number().int().positive(),
  clientMutationId: IdSchema
});

export const OrganizationSchema = z.object({ id: IdSchema, name: z.string(), slug: z.string(), createdAt: z.string() });
export const UserSchema = z.object({ id: IdSchema, organizationId: IdSchema, name: z.string(), email: z.string(), role: RoleSchema });
export const ThemeSchema = z.object({ id: IdSchema, organizationId: IdSchema, name: z.string(), tokens: z.record(z.string(), z.unknown()) });

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string(), retryable: z.boolean() }) });

export interface Presentation { id: string; organizationId: string; title: string; status: "draft" | "archived"; currentVersionId: string; createdBy: string; createdAt: string; updatedAt: string; }
export interface PresentationVersion { id: string; presentationId: string; versionNumber: number; schemaVersion: "1.0"; state: z.infer<typeof VersionStateSchema>; content: PresentationContent; contentHash: string; baseVersionId: string | null; createdBy: string; createdAt: string; }
export interface ExportJob { id: string; organizationId: string; presentationId: string; versionId: string; format: "html" | "pdf" | "pptx"; status: z.infer<typeof JobStatusSchema>; attempt: number; maxAttempts: number; }
export interface ExportArtifact { id: string; organizationId: string; jobId: string; storageKey: string; mediaType: string; sizeBytes: number; contentHash: string; }

export function initialPresentationContent(themeId: string): PresentationContent {
  return {
    schemaVersion: "1.0",
    canvas: { width: 1920, height: 1080, ratio: "16:9" },
    themeId,
    slides: [{ slideId: crypto.randomUUID(), layout: "cover", blocks: [
      { id: crypto.randomUUID(), type: "text", role: "title", text: "Título da apresentação" },
      { id: crypto.randomUUID(), type: "text", role: "subtitle", text: "Edite este subtítulo" }
    ], references: [] }]
  };
}
