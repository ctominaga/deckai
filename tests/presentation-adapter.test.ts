import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { adaptPresentation } from "../src/integration/presentation-adapter.js";
import { presentationMock } from "../src/mocks/presentation.mock.js";

const ajv = new Ajv2020();
const validate = ajv.compile(JSON.parse(readFileSync(new URL("../shared/presentation-schema.json", import.meta.url), "utf8")));

describe("official presentation projection", () => {
  it("validates all six layouts against the unchanged official JSON Schema", () => {
    const before = JSON.stringify(presentationMock);
    const result = adaptPresentation(presentationMock, "jump-default");
    expect(validate(result.presentation), JSON.stringify(validate.errors)).toBe(true);
    expect(result.presentation.slides.map(s => s.layout)).toEqual(["cover", "text_image", "two_columns", "metrics", "case", "closing"]);
    expect(JSON.stringify(presentationMock)).toBe(before);
    expect(result.presentation.slides.map(s => s.references)).toEqual(presentationMock.slides.map(s => s.referenceIds));
  });
  it("preserves content, metrics context, column roles and demonstration labels", () => {
    const { presentation } = adaptPresentation(presentationMock, "explicit-theme");
    expect(presentation.themeId).toBe("explicit-theme");
    for (const [index, source] of presentationMock.slides.entries()) {
      const target = presentation.slides[index]!;
      expect(target.slideId).toBe(source.id);
      expect(target.blocks[0]?.text).toBe(source.title);
      if (source.layout === "two_columns") {
        expect(target.blocks.find(b => b.role === "left.body")?.text).toBe(source.left.body);
        expect(target.blocks.find(b => b.role === "right.heading")?.text).toBe(source.right.heading);
      }
      if (source.layout === "metrics") {
        expect(target.blocks.filter(b => b.type === "metric").map(b => ({label:b.label,value:b.value}))).toEqual(source.metrics.map(m => ({label:m.label,value:m.value})));
        expect(target.blocks.find(b => b.role === "metrics/0/context")?.text).toBe(source.metrics[0]?.context);
      }
      if (source.layout === "case" || source.layout === "metrics") expect(target.blocks.find(b => b.role === "dataClassification")?.text).toBe("DEMONSTRATION");
      if (source.layout === "case") for (const role of ["organization", "challenge", "approach", "result"] as const) expect(target.blocks.find(b => b.role === role)?.text).toBe(source[role]);
      if (source.layout === "closing") expect(target.blocks.find(b => b.role === "callToAction")?.text).toBe(source.callToAction);
    }
  });
  it("does not fabricate assets or institutional sources and warns about unsupported metadata", () => {
    const result = adaptPresentation(presentationMock, "jump-default");
    expect(result.presentation.slides.flatMap(s => s.blocks).some(b => "assetId" in b)).toBe(false);
    expect(result.warnings.filter(w => w.includes("placeholder"))).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("catálogo de referências");
  });
  it("rejects 4:3 and unspecified themes without changing the source contracts", () => {
    expect(() => adaptPresentation({...presentationMock,aspectRatio:"4:3"}, "jump-default")).toThrow("16:9");
    expect(() => adaptPresentation(presentationMock, " ")).toThrow("themeId");
  });
});
