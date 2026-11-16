import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(body, null, 2));
}

function bodyOf(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("INVALID_JSON")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok", service: "deckai-mock-api" });
    if (req.method === "GET" && req.url === "/api/jobs/job_outline_001") return send(res, 200, readJson("outline-response.json"));
    if (req.method === "GET" && req.url === "/api/jobs/job_generation_001") return send(res, 200, readJson("presentation-response.json"));
    if (req.method === "GET" && req.url === "/api/jobs/job_regeneration_001") return send(res, 200, readJson("localized-change-response.json"));
    if (req.method === "GET" && req.url === "/api/jobs/job_rewrite_001") return send(res, 200, readJson("rewrite-response.json"));

    if (req.method === "POST" && req.url === "/api/ai/outline") {
      await bodyOf(req);
      return send(res, 202, readJson("outline-response.json"));
    }
    if (req.method === "POST" && req.url === "/api/ai/outline/outline_001/approve") {
      return send(res, 200, { outlineId: "outline_001", status: "approved", approvedAt: new Date().toISOString() });
    }
    if (req.method === "POST" && req.url === "/api/ai/presentation") {
      await bodyOf(req);
      return send(res, 202, readJson("presentation-response.json"));
    }
    if (req.method === "POST" && req.url === "/api/ai/slides/slide_generated_002/regenerate") {
      await bodyOf(req);
      return send(res, 202, readJson("localized-change-response.json"));
    }
    if (req.method === "POST" && req.url === "/api/ai/blocks/block_generated_002/rewrite") {
      await bodyOf(req);
      return send(res, 202, readJson("rewrite-response.json"));
    }
    return send(res, 404, { error: { code: "NOT_FOUND", message: "Endpoint não encontrado" } });
  } catch (error) {
    return send(res, 400, { error: { code: error.message, message: "Não foi possível processar a solicitação" } });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Deck AI mock API running at http://127.0.0.1:${port}`);
});
