import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdSchema } from "@deckai/contracts";
import { audit } from "../audit.js";
import { authenticate, requireWrite } from "../auth.js";
import type { Database } from "../database.js";
import { AppError, notFound } from "../errors.js";
import { readImageDimensions } from "../presentation-images.js";

const maxBytes = 5 * 1024 * 1024;
const mediaTypes = ["image/png", "image/jpeg", "image/webp"] as const;
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
const mediaTypeSchema = z.enum(mediaTypes);
type ImageAsset = {
  id: string; name: string; mediaType: z.infer<typeof mediaTypeSchema>; sizeBytes: number; createdAt: string;
};
const fields = 'id, name, media_type AS "mediaType", size_bytes AS "sizeBytes", created_at AS "createdAt"';
const listQuery = z.object({ after: IdSchema.optional() }).strict();
const nameSchema = z.string().trim().min(1).max(160).regex(/^[^\x00-\x1f\x7f/\\]+$/);

function hasImageSignature(mediaType: ImageAsset["mediaType"], bytes: Buffer): boolean {
  if (mediaType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (mediaType === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

export function registerAssetRoutes(app: FastifyInstance, database: Database): void {
  app.register(async routes => {
    routes.addContentTypeParser([...mediaTypes], { parseAs: "buffer", bodyLimit: maxBytes }, (_request, body, done) => done(null, body));

    routes.post("/api/v1/assets/images", {
      bodyLimit: maxBytes,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
    }, async (request, reply) => {
      const user = await authenticate(request, database);
      requireWrite(user);
      const mediaType = mediaTypeSchema.safeParse(request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase());
      if (!mediaType.success || !Buffer.isBuffer(request.body)) {
        throw new AppError(415, "IMAGE_TYPE_UNSUPPORTED", "Envie uma imagem PNG, JPEG ou WebP.");
      }
      if (!hasImageSignature(mediaType.data, request.body)) {
        throw new AppError(422, "IMAGE_SIGNATURE_INVALID", "O arquivo não corresponde ao formato informado.");
      }
      if (!readImageDimensions(request.body, mediaType.data)) {
        throw new AppError(422, "IMAGE_DIMENSIONS_INVALID", "A imagem precisa ter dimensões válidas de até 8192 pixels por lado e 20 megapixels.");
      }
      const { name: queryName } = z.object({ name: z.string().optional() }).strict().parse(request.query);
      const name = nameSchema.parse(request.headers["x-asset-name"] ?? queryName ?? `imagem.${extensions[mediaType.data]}`);
      const bytes = request.body;
      const asset = await database.transaction(async tx => {
        const inserted = await tx.query<ImageAsset>(`INSERT INTO image_assets
          (id, organization_id, uploaded_by, name, media_type, data, size_bytes)
          VALUES ($1, $2, $3, $4, $5, decode($6, 'base64'), $7) RETURNING ${fields}`,
          [randomUUID(), user.organizationId, user.id, name, mediaType.data, bytes.toString("base64"), bytes.length]);
        const asset = inserted.rows[0]!;
        await audit(tx, { organizationId: user.organizationId, actorId: user.id, requestId: request.id,
          action: "asset.image.upload", entityType: "image_asset", entityId: asset.id });
        return asset;
      });
      return reply.code(201).send({ asset });
    });

    routes.get("/api/v1/assets/images", async request => {
      const user = await authenticate(request, database);
      const { after } = listQuery.parse(request.query);
      const result = await database.query<ImageAsset>(`SELECT ${fields} FROM image_assets
        WHERE organization_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 101`,
        [user.organizationId, after ?? null]);
      const items = result.rows.slice(0, 100);
      return { items, nextCursor: result.rows.length > 100 ? items.at(-1)!.id : null };
    });

    routes.get("/api/v1/assets/images/:id", async (request, reply) => {
      const user = await authenticate(request, database);
      const id = IdSchema.parse((request.params as { id: string }).id);
      const result = await database.query<{ mediaType: ImageAsset["mediaType"]; data: string }>(`SELECT
        media_type AS "mediaType", encode(data, 'base64') AS data FROM image_assets
        WHERE id=$1 AND organization_id=$2`, [id, user.organizationId]);
      const image = result.rows[0];
      if (!image) throw notFound("Imagem");
      return reply.type(image.mediaType)
        .header("Content-Disposition", `attachment; filename="imagem-${id}.${extensions[image.mediaType]}"`)
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(Buffer.from(image.data, "base64"));
    });
  });
}
