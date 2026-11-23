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

export async function buildApp(database: Database) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", genReqId: () => crypto.randomUUID() });
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", allowedHeaders: ["authorization", "content-type"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(rateLimit, { global: false });
  app.get("/health", async () => ({ status: "ok", service: "deckai-api", database: process.env.DATABASE_URL ? "postgresql" : "pglite" }));
  registerAuthRoutes(app, database);
  registerMemberRoutes(app, database);
  registerJumpRoutes(app, database);
  registerPresentationRoutes(app, database);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ error: { code: "VALIDATION_ERROR", message: "Os dados enviados são inválidos.", details: error.issues, requestId: request.id, retryable: false } });
    const statusCode = (error as { statusCode?: number }).statusCode;
    const appError = error instanceof AppError ? error : statusCode === 429 ? new AppError(429, "RATE_LIMITED", "Muitas tentativas. Aguarde antes de tentar novamente.", undefined, true) : new AppError(500, "INTERNAL_ERROR", "Erro interno.");
    if (!(error instanceof AppError)) request.log.error(error);
    return reply.code(appError.status).send({ error: { code: appError.code, message: appError.message, details: appError.details, requestId: request.id, retryable: appError.retryable } });
  });
  return app;
}
