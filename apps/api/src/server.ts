import { buildApp } from "./app.js";
import { createDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";
import { findPdfBrowser, renderPdf } from "./pdf-renderer.js";
import { startExportWorker } from "./export-worker.js";
import { renderPptx } from "./pptx-renderer.js";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { access } from "node:fs/promises";

const production = process.env.NODE_ENV === "production";
if (production && !process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const staticRoot = process.env.DECKAI_SERVE_WEB === "true" ? resolve("dist-app") : undefined;
if (staticRoot) await access(resolve(staticRoot, "index.html"));
const database = createDatabase();
const app = await buildApp(database);
try {
  await runMigrations(database);
  if (staticRoot) await app.register(fastifyStatic, { root: staticRoot, serveDotFiles: false, maxAge: 0 });
  const port = Number(process.env.PORT ?? 8788);
  await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
} catch (error) {
  await app.close();
  await database.close();
  throw error;
}

const browser = findPdfBrowser();
const stopPdfWorker = browser && process.env.PDF_WORKER_ENABLED !== "false"
  ? startExportWorker(database, "pdf", (content, title, images) => renderPdf(browser, content, title, images), () => app.log.error("Falha ao consultar a fila de PDF."))
  : undefined;
const stopPptxWorker = startExportWorker(database, "pptx", renderPptx, () => app.log.error("Falha ao consultar a fila de PPTX."));
if (!stopPdfWorker) app.log.info("Worker de PDF desativado ou navegador indisponível.");
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await Promise.all([stopPdfWorker?.(), stopPptxWorker()]);
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
