import PptxGenJS from "pptxgenjs";
import type { PresentationContent } from "@deckai/contracts";
import type { PresentationImages } from "./presentation-images.js";

// The package exports an ESM constructor at runtime and CommonJS-shaped type declarations.
const Presentation = PptxGenJS as unknown as typeof PptxGenJS.default;

export async function renderPptx(content: PresentationContent, title: string, images: PresentationImages = new Map()): Promise<Buffer> {
  const deck = new Presentation();
  deck.layout = "LAYOUT_WIDE";
  deck.title = title;

  for (const source of content.slides) {
    const slide = deck.addSlide();
    const dark = source.layout === "cover";
    const closing = source.layout === "closing";
    slide.background = { color: dark ? "171717" : closing ? "D7FF45" : "F3F1E9" };
    const color = dark ? "FFFFFF" : "171717";
    const titleBlock = source.blocks.find(block => block.type === "text" && block.role === "title");
    if (titleBlock?.type === "text") {
      slide.addText(titleBlock.text, {
        x: 0.7, y: 0.55, w: 11.93, h: 1.25, fontFace: "Arial", fontSize: 33,
        color, bold: true, margin: 0, fit: "shrink", align: closing ? "center" : "left"
      });
    }
    const body = source.blocks.filter(block => block !== titleBlock);
    const columns = ["two_columns", "metrics", "text_image"].includes(source.layout) ? 2 : 1;
    const rows = Math.max(1, Math.ceil(body.length / columns));
    const rowHeight = 5 / rows;
    const columnWidth = (11.93 - (columns - 1) * 0.45) / columns;
    for (const [index, block] of body.entries()) {
      const x = 0.7 + (index % columns) * (columnWidth + 0.45);
      const y = 2 + Math.floor(index / columns) * rowHeight;
      const image = block.type === "image" && block.assetId ? images.get(block.assetId) : undefined;
      if (block.type === "image" && image && image.mediaType !== "image/webp") {
        const scale = Math.min(columnWidth / image.width, rowHeight * 0.93 / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        slide.addImage({ data: image.dataUrl, x: x + (columnWidth - w) / 2,
          y: y + (rowHeight * 0.93 - h) / 2, w, h, altText: block.alt });
        continue;
      }
      const text = block.type === "text" ? block.text : block.type === "metric"
        ? `${block.value}${block.unit ? ` ${block.unit}` : ""}\n${block.label}`
        : block.alt || "Imagem ainda não selecionada";
      slide.addText(text, {
        x, y, w: columnWidth, h: rowHeight * 0.93, color,
        fontFace: "Arial", fontSize: block.type === "metric" ? 24 : 18,
        bold: block.type === "metric", italic: block.type === "image",
        margin: 0, fit: "shrink", valign: "top", align: closing ? "center" : "left"
      });
    }
  }

  return Buffer.from(await deck.write({ outputType: "nodebuffer" }) as Buffer);
}
