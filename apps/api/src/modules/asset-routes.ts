import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdSchema } from "@deckai/contracts";
import { authenticate, requireWrite } from "../auth.js";
import { audit } from "../audit.js";
import { assetSelect, imageDimensions, maxImageBytes, type ImageAsset } from "../assets.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";

export function registerAssetRoutes(app: FastifyInstance, database: Database): void {
  app.addContentTypeParser(["image/png", "image/jpeg"], { parseAs: "buffer", bodyLimit: maxImageBytes }, (_request, body, done) => done(null, body));
  app.post("/api/v1/assets", {
    bodyLimit: maxImageBytes,
    onRequest: async request => { requireWrite(await authenticate(request, database)); }
  }, async (request, reply) => {
    const user = await authenticate(request, database);
    const { name } = z.object({ name: z.string().trim().min(1).max(180) }).parse(request.query);
    const file = request.body;
    if (!Buffer.isBuffer(file) || !file.length) throw new AppError(422, "INVALID_IMAGE", "Selecione um arquivo PNG ou JPEG.");
    const mediaType = request.headers["content-type"]?.split(";")[0] ?? "";
    const dimensions = imageDimensions(file, mediaType);
    const hash = createHash("sha256").update(file).digest("hex");
    const asset = await database.transaction(async tx => {
      await tx.query(`INSERT INTO image_assets (id,organization_id,name,media_type,size_bytes,width,height,content_hash,file_data,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,decode($9,'base64'),$10) ON CONFLICT (organization_id,content_hash) DO NOTHING`,
        [randomUUID(), user.organizationId, name, mediaType, file.length, dimensions.width, dimensions.height, hash, file.toString("base64"), user.id]);
      const { rows } = await tx.query<ImageAsset>(`${assetSelect} WHERE organization_id=$1 AND content_hash=$2`, [user.organizationId, hash]);
      await audit(tx, { organizationId: user.organizationId, actorId: user.id, action: "asset.upload", entityType: "asset", entityId: rows[0]!.id, requestId: request.id });
      return rows[0]!;
    });
    return reply.code(201).send(asset);
  });
  app.get("/api/v1/assets", async request => {
    const user = await authenticate(request, database);
    const { rows } = await database.query<ImageAsset>(`${assetSelect} WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 200`, [user.organizationId]);
    return { items: rows };
  });
  app.get("/api/v1/assets/:id/file", async (request, reply) => {
    const user = await authenticate(request, database);
    const id = IdSchema.parse((request.params as { id: string }).id);
    const { rows } = await database.query<{ mediaType: string; file: Uint8Array }>(`SELECT media_type AS "mediaType",file_data AS file FROM image_assets WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
    if (!rows[0]) throw notFound("Imagem");
    return reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").type(rows[0].mediaType).send(Buffer.from(rows[0].file));
  });
}
