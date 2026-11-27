import { imageSize } from "image-size";
import type { PresentationContent } from "@deckai/contracts";
import type { Database } from "./database.js";
import { AppError } from "./errors.js";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";
export type PresentationImage = { dataUrl: string; mediaType: ImageMediaType; width: number; height: number };
export type PresentationImages = ReadonlyMap<string, PresentationImage>;

const expectedTypes = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
const maxEmbeddedBytes = 8 * 1024 * 1024;

export function imageDataUrls(images: PresentationImages) {
  return Object.fromEntries(images);
}

export function readImageDimensions(bytes: Buffer, mediaType: ImageMediaType): { width: number; height: number } | undefined {
  try {
    const { type, width, height } = imageSize(bytes);
    if (type !== expectedTypes[mediaType] || !width || !height || width > 8192 || height > 8192 || width * height > 20_000_000) return undefined;
    return { width, height };
  } catch {
    return undefined;
  }
}

export async function loadPresentationImages(database: Database, content: PresentationContent, organizationId: string): Promise<PresentationImages> {
  const ids = content.slides.flatMap(slide => slide.blocks.flatMap(block => block.type === "image" && block.assetId ? [block.assetId] : []));
  if (!ids.length) return new Map();
  const images = await database.query<{ id: string; mediaType: ImageMediaType; data: string | null }>(`WITH wanted AS (
      SELECT id, count(*) AS copies FROM unnest($1::uuid[]) AS selected(id) GROUP BY id
    ), matched AS (
      SELECT a.id,a.media_type,a.data,sum(a.size_bytes * wanted.copies) OVER () AS total_bytes
      FROM image_assets a JOIN wanted ON wanted.id=a.id WHERE a.organization_id=$2
    )
    SELECT id, media_type AS "mediaType",
      CASE WHEN total_bytes <= $3 THEN encode(data,'base64') END AS data
    FROM matched`, [ids, organizationId, maxEmbeddedBytes]);

  const resolved = new Map<string, PresentationImage>();
  for (const image of images.rows) {
    if (!image.data) throw new AppError(422, "PRESENTATION_IMAGES_TOO_LARGE", "As imagens usadas na apresentação excedem o limite combinado de 8 MiB.");
    const bytes = Buffer.from(image.data, "base64");
    const size = readImageDimensions(bytes, image.mediaType);
    if (size) resolved.set(image.id, { ...size, mediaType: image.mediaType, dataUrl: `data:${image.mediaType};base64,${bytes.toString("base64")}` });
  }
  return resolved;
}
