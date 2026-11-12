import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../dev-preview/server.js";
import type { AiGenerationProvider } from "../providers/ai-generation-provider.js";

const root = new URL("../../", import.meta.url);
const assets = new Map([
  ["/", ["preview-dev3/index.html", "text/html"]],
  ["/index.html", ["preview-dev3/index.html", "text/html"]],
  ["/prototipo.html", ["preview-dev3/prototipo.html", "text/html"]],
  ["/gerar-ia.html", ["preview-dev3/gerar-ia.html", "text/html"]],
  ["/ai-shell.css", ["preview-dev3/ai-shell.css", "text/css"]],
  ["/ai/styles.css", ["src/dev-preview/styles.css", "text/css"]],
  ["/ai/app.js", ["src/dev-preview/app.js", "text/javascript"]],
  ["/ai/shared-json.js", ["preview-dev3/shared-json.js", "text/javascript"]],
  ["/ai/workflow.js", ["preview-dev3/workflow.js", "text/javascript"]],
]);

export function createIntegratedServer(factory?: () => AiGenerationProvider, deepSeekFactory?: () => AiGenerationProvider): Server {
  const api = createPreviewServer(factory, deepSeekFactory);
  return createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    // Browser requests from another origin must not trigger local Gemini actions.
    if (request.method === "POST" && request.headers.origin &&
        request.headers.origin !== `http://${request.headers.host}`) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Origem não permitida." }));
      return;
    }
    if (path.startsWith("/api/")) {
      api.emit("request", request, response);
      return;
    }
    const asset = assets.get(path);
    if (request.method !== "GET" || !asset) {
      response.writeHead(404).end("Recurso não encontrado.");
      return;
    }
    void readFile(new URL(asset[0]!, root)).then((content) => {
      response.writeHead(200, {
        "Content-Type": `${asset[1]}; charset=utf-8`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      }).end(content);
    }).catch(() => response.writeHead(500).end("Falha ao carregar recurso local."));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.INTEGRATED_PORT ?? "4175");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("INTEGRATED_PORT inválida.");
  const server = createIntegratedServer();
  server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`DeckAI integrado: http://127.0.0.1:${port}`));
}
