import { createHash, randomUUID } from "node:crypto";
import { PresentationContentSchema, type PresentationContent } from "@deckai/contracts";
import type { Database } from "./database.js";
import { maxPdfBytes } from "./pdf-renderer.js";
import { loadPresentationImages, type PresentationImages } from "./presentation-images.js";
import { AppError } from "./errors.js";

type PdfTask = { id: string; organizationId: string; versionId: string; attempt: number; maxAttempts: number };
type Format = "pdf" | "pptx";
type Render = (content: PresentationContent, title: string, images: PresentationImages) => Promise<Buffer>;
export const exportMediaTypes = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
} as const;

export async function processNextExport(database: Database, format: Format, render: Render): Promise<boolean> {
  await database.query(`UPDATE export_jobs SET status='dead_letter', locked_until=NULL, updated_at=now(),
    error_json='{"code":"EXPORT_WORKER_INTERRUPTED"}'::jsonb
    WHERE format=$1 AND status='running' AND locked_until<=now() AND attempt>=max_attempts`, [format]);
  const claimed = await database.query<PdfTask>(`WITH next_job AS (
    SELECT id FROM export_jobs WHERE format=$1 AND attempt<max_attempts AND (
      (status IN ('queued','retrying') AND available_at<=now()) OR (status='running' AND locked_until<=now())
    ) ORDER BY available_at,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  UPDATE export_jobs j SET status='running',attempt=j.attempt+1,locked_until=now()+interval '90 seconds',updated_at=now()
  FROM next_job WHERE j.id=next_job.id
  RETURNING j.id,j.organization_id AS "organizationId",j.version_id AS "versionId",j.attempt,j.max_attempts AS "maxAttempts"`, [format]);
  const task = claimed.rows[0];
  if (!task) return false;

  try {
    const version = await database.query<{ title: string; content: unknown }>(`SELECT p.title,v.content_json AS content
      FROM presentation_versions v JOIN presentations p ON p.id=v.presentation_id AND p.organization_id=v.organization_id
      WHERE v.id=$1 AND v.organization_id=$2`, [task.versionId, task.organizationId]);
    const source = version.rows[0];
    if (!source) throw new Error("EXPORT_SOURCE_MISSING");
    const content = PresentationContentSchema.parse(source.content);
    const images = await loadPresentationImages(database, content, task.organizationId);
    const file = await render(content, source.title, images);
    const signature = format === "pdf" ? Buffer.from("%PDF-") : Buffer.from([0x50, 0x4b, 3, 4]);
    if (file.length > maxPdfBytes || !file.subarray(0, signature.length).equals(signature)) throw new Error("EXPORT_INVALID");
    await database.transaction(async tx => {
      const completed = await tx.query(`UPDATE export_jobs SET status='succeeded',locked_until=NULL,error_json=NULL,updated_at=now()
        WHERE id=$1 AND organization_id=$2 AND status='running' AND attempt=$3 AND locked_until>now() RETURNING id`,
        [task.id, task.organizationId, task.attempt]);
      if (!completed.rows.length) return;
      await tx.query(`INSERT INTO export_artifacts (id,organization_id,job_id,storage_key,media_type,size_bytes,content_hash,file_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,decode($8,'base64'))`,
        [randomUUID(), task.organizationId, task.id, `db:${format}:${task.id}`, exportMediaTypes[format], file.length, createHash("sha256").update(file).digest("hex"), file.toString("base64")]);
    });
  } catch (error) {
    const permanent = error instanceof AppError && error.code === "PRESENTATION_IMAGES_TOO_LARGE";
    const retry = task.attempt < task.maxAttempts;
    await database.query(`UPDATE export_jobs SET status=$1,locked_until=NULL,available_at=now()+make_interval(secs => $2::int),
      error_json=$6::jsonb,updated_at=now()
      WHERE id=$3 AND organization_id=$4 AND status='running' AND attempt=$5 AND locked_until>now()`,
      [permanent ? "failed" : retry ? "retrying" : "dead_letter", !permanent && retry ? 2 ** task.attempt : 0,
        task.id, task.organizationId, task.attempt, JSON.stringify({ code: permanent ? error.code : "EXPORT_GENERATION_FAILED" })]);
  }
  return true;
}

export function startExportWorker(database: Database, format: Format, render: Render, logError: () => void): () => Promise<void> {
  let current: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (current) return;
    current = processNextExport(database, format, render).catch(logError).then(() => { current = undefined; });
  }, 1000);
  return async () => {
    clearInterval(timer);
    await current;
  };
}
