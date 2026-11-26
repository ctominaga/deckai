import { buildApp } from "./app.js";
import { createDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";
import { findPdfBrowser, renderPdf } from "./pdf-renderer.js";
import { startExportWorker } from "./export-worker.js";
import { renderPptx } from "./pptx-renderer.js";

const database = createDatabase();
await runMigrations(database);
const app = await buildApp(database);
const port = Number(process.env.PORT ?? 8788);
await app.listen({ host: "127.0.0.1", port });

const browser = findPdfBrowser();
const stopPdfWorker = browser && process.env.PDF_WORKER_ENABLED !== "false"
  ? startExportWorker(database, "pdf", (content, title) => renderPdf(browser, content, title), () => app.log.error("Falha ao consultar a fila de PDF."))
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
