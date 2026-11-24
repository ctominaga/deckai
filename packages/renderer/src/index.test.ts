import { describe, expect, it } from "vitest";
import { renderPresentationDocument } from "./index.js";

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
});
