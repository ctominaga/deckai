import { describe, expect, it } from "vitest";
import { renderPresentationDocument, renderSlideHtml } from "./index.js";
import { initialPresentationContent, type Slide } from "@deckai/contracts";

describe("renderer HTML", () => {
  it("escapa conteúdo não confiável e mantém proporção 16:9", () => {
    const html = renderPresentationDocument({ schemaVersion: "1.0", canvas: { width: 1920, height: 1080, ratio: "16:9" }, themeId: crypto.randomUUID(), slides: [{ slideId: crypto.randomUUID(), layout: "cover", blocks: [{ id: crypto.randomUUID(), type: "text", role: "title", text: "<script>alert(1)</script>" }], references: [] }] }, "Teste");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("aspect-ratio:16/9");
    expect(html).toContain("container-type:inline-size");
    expect(html).toContain("4.9cqw");
    expect(html).not.toContain("5vw");
  });

  it("renderiza os seis layouts do JSON canônico sem perder blocos e incorpora apenas imagens locais", () => {
    const content = initialPresentationContent(crypto.randomUUID());
    const imageId = crypto.randomUUID();
    const layouts: Slide["layout"][] = ["cover", "text_image", "two_columns", "metrics", "case", "closing"];
    content.slides = layouts.map(layout => ({ slideId: crypto.randomUUID(), layout, references: [], blocks: [
      { id: crypto.randomUUID(), type: "text", role: "title", text: `Título ${layout}` },
      { id: crypto.randomUUID(), type: "text", role: "body", text: "Desafio e solução" },
      { id: crypto.randomUUID(), type: "metric", role: "metric", value: "42", label: "Resultado" },
      { id: crypto.randomUUID(), type: "image", role: "image", assetId: imageId, alt: '<img onerror="alert(1)">' }
    ] }));
    const assets = { [imageId]: { dataUrl: "data:image/png;base64,aGVsbG8=", width: 20, height: 10 } };
    const html = renderPresentationDocument(content, "Deck salvo", assets);
    for (const slide of content.slides) {
      expect(html).toContain(`layout-${slide.layout}`);
      for (const block of slide.blocks) expect(html.split(`data-block-id="${block.id}"`)).toHaveLength(2);
    }
    expect(html.match(/<img src="data:image\/png;base64,/g)).toHaveLength(6);
    expect(html).not.toContain('<img onerror="alert');
    expect(renderSlideHtml(content.slides[0]!, 0, { [imageId]: { ...assets[imageId]!, dataUrl: "https://example.com/tracker.png" } })).not.toContain('src="https:');
  });
});
