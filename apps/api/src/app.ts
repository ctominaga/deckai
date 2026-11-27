import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import type { Database } from "./database.js";
import { AppError } from "./errors.js";
import { registerAuthRoutes } from "./modules/auth-routes.js";
import { registerPresentationRoutes } from "./modules/presentation-routes.js";
import { registerMemberRoutes } from "./modules/member-routes.js";
import { registerJumpRoutes } from "./modules/jump-routes.js";
import { DeepSeekOutlineProvider, type OutlineProvider } from "./ai-provider.js";
import { registerAiRoutes } from "./modules/ai-routes.js";
import { registerExportRoutes } from "./modules/export-routes.js";
import { registerAssetRoutes } from "./modules/asset-routes.js";

export async function buildApp(database: Database, options: { outlineProvider?: OutlineProvider } = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", genReqId: () => crypto.randomUUID() });
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", allowedHeaders: ["authorization", "content-type", "x-asset-name"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(rateLimit, { global: false });
  app.get("/health", async () => ({ status: "ok", service: "deckai-api", database: process.env.DATABASE_URL ? "postgresql" : "pglite" }));
  registerAuthRoutes(app, database);
  registerMemberRoutes(app, database);
  registerJumpRoutes(app, database);
  registerAiRoutes(app, database, options.outlineProvider ?? new DeepSeekOutlineProvider());
  registerPresentationRoutes(app, database);
  registerExportRoutes(app, database);
  registerAssetRoutes(app, database);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ error: { code: "VALIDATION_ERROR", message: "Os dados enviados são inválidos.", details: error.issues, requestId: request.id, retryable: false } });
    const statusCode = (error as { statusCode?: number }).statusCode;
    const appError = error instanceof AppError ? error
      : statusCode === 429 ? new AppError(429, "RATE_LIMITED", "Muitas tentativas. Aguarde antes de tentar novamente.", undefined, true)
      : statusCode === 413 ? new AppError(413, "PAYLOAD_TOO_LARGE", "O arquivo excede o tamanho permitido.")
      : statusCode === 415 ? new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Formato de arquivo não suportado.")
      : new AppError(500, "INTERNAL_ERROR", "Erro interno.");
    if (!(error instanceof AppError)) request.log.error(error);
    return reply.code(appError.status).send({ error: { code: appError.code, message: appError.message, details: appError.details, requestId: request.id, retryable: appError.retryable } });
  });
  return app;
}
