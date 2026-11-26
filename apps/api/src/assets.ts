import type { PresentationContent } from "@deckai/contracts";
import type { RenderAssets } from "@deckai/renderer";
import type { Database } from "./database.js";
import { AppError } from "./errors.js";

export const maxImageBytes = 5 * 1024 * 1024;
export const maxPresentationImageBytes = 24 * 1024 * 1024;
export type ImageAsset = { id: string; name: string; mediaType: string; sizeBytes: number; width: number; height: number };
export const assetSelect = `SELECT id,name,media_type AS "mediaType",size_bytes AS "sizeBytes",width,height FROM image_assets`;

export function imageDimensions(file: Buffer, mediaType: string): { width: number; height: number } {
  let width = 0, height = 0;
  if (mediaType === "image/png" && file.length >= 33 && file.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && file.readUInt32BE(8) === 13 && file.toString("ascii", 12, 16) === "IHDR") {
    width = file.readUInt32BE(16); height = file.readUInt32BE(20);
  } else if (mediaType === "image/jpeg" && file[0] === 255 && file[1] === 216) {
    let offset = 2;
    while (offset + 4 <= file.length) {
      if (file[offset++] !== 255) break;
      while (file[offset] === 255) offset++;
      if (offset + 3 > file.length) break;
      const marker = file[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = file.readUInt16BE(offset);
      if (length < 2 || offset + length > file.length) break;
      if (marker !== undefined && [0xc0,0xc1,0xc2].includes(marker) && length >= 8) {
        height = file.readUInt16BE(offset + 3); width = file.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height || width > 12000 || height > 12000 || width * height > 40_000_000) {
    throw new AppError(422, "INVALID_IMAGE", "Envie uma imagem PNG ou JPEG válida, com até 12.000 pixels por lado e 40 megapixels.");
  }
  return { width, height };
}

function assetIds(content: PresentationContent): string[] {
  return [...new Set(content.slides.flatMap(slide => slide.blocks.flatMap(block => block.type === "image" && block.assetId ? [block.assetId] : [])))];
}

export async function validateImageReferences(database: Database, content: PresentationContent, organizationId: string): Promise<void> {
  const ids = assetIds(content);
  if (!ids.length) return;
  const { rows } = await database.query<ImageAsset>(`${assetSelect} WHERE organization_id=$1 AND id=ANY($2::uuid[])`, [organizationId, ids]);
  if (rows.length !== ids.length) throw new AppError(422, "IMAGE_NOT_AVAILABLE", "Uma imagem não está disponível nesta organização.");
  if (rows.reduce((total, asset) => total + asset.sizeBytes, 0) > maxPresentationImageBytes) throw new AppError(422, "IMAGES_TOO_LARGE", "As imagens da apresentação devem somar até 24 MB.");
}

export async function resolveImages(database: Database, content: PresentationContent, organizationId: string): Promise<RenderAssets> {
  await validateImageReferences(database, content, organizationId);
  const ids = assetIds(content);
  if (!ids.length) return {};
  const { rows } = await database.query<ImageAsset & { base64: string }>(`SELECT id,width,height,media_type AS "mediaType",encode(file_data,'base64') AS base64 FROM image_assets WHERE organization_id=$1 AND id=ANY($2::uuid[])`, [organizationId, ids]);
  return Object.fromEntries(rows.map(asset => [asset.id, { dataUrl: `data:${asset.mediaType};base64,${asset.base64.replace(/\s/g, "")}`, width: asset.width, height: asset.height }]));
}
