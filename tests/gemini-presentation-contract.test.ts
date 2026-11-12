import { describe, expect, it } from "vitest";
import { presentationResponseJsonSchema } from "../src/providers/gemini-presentation-contract.js";

// responseJsonSchema supports oneOf (interpreted as anyOf), including in the
// installed SDK's GenerateContentConfig declaration. Do not confuse this field
// with responseSchema, whose OpenAPI Schema subset differs.
// https://ai.google.dev/api/generate-content#generationconfig
// https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html
const supportedKeywords = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description",
  "enum", "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum",
  "anyOf", "oneOf", "properties", "additionalProperties", "required", "propertyOrdering",
]);

function assertCompatible(schema: Record<string, any>) {
  for (const keyword of Object.keys(schema)) expect(supportedKeywords.has(keyword), keyword).toBe(true);
  if (schema.type) expect(["object", "array", "string", "number", "integer", "boolean", "null"]).toContain(schema.type);
  if (schema.required) {
    expect(new Set(schema.required).size).toBe(schema.required.length);
    for (const field of schema.required) expect(schema.properties).toHaveProperty(field);
  }
  if (schema.enum) expect(schema.enum.every((value: unknown) => typeof value === "string" || typeof value === "number")).toBe(true);
  if (schema.type === "object") {
    expect(schema.additionalProperties).toBe(false);
    Object.values(schema.properties).forEach((child) => assertCompatible(child as Record<string, any>));
  }
  if (schema.type === "array") {
    expect(schema.items).toBeDefined();
    assertCompatible(schema.items);
    for (const bound of [schema.minItems, schema.maxItems]) {
      if (bound !== undefined) expect(Number.isInteger(bound) && bound >= 0).toBe(true);
    }
  }
  for (const union of [schema.anyOf, schema.oneOf]) {
    if (union) {
      expect(union.length).toBeGreaterThan(0);
      union.forEach(assertCompatible);
    }
  }
}

describe("Gemini presentation JSON Schema compatibility", () => {
  it.each([1, 6, 12])("uses only documented keywords and preserves all six layouts for %i slides", (count) => {
    const schema = presentationResponseJsonSchema(count) as Record<string, any>;
    assertCompatible(schema);
    expect(schema.required).toEqual(["slides"]);
    expect(schema.properties.slides).toMatchObject({ type: "array", minItems: count, maxItems: count });
    const variants = schema.properties.slides.items.oneOf;
    expect(variants.map((variant: any) => variant.properties.layout.enum)).toEqual([
      ["cover"], ["text_image"], ["two_columns"], ["metrics"], ["case"], ["closing"],
    ]);
    // Distinct required layout literals make the branches mutually exclusive,
    // so Gemini's oneOf-as-anyOf interpretation preserves this union's meaning.
    variants.forEach((variant: any) => expect(variant.required).toEqual(Object.keys(variant.properties)));
    expect(JSON.stringify(schema)).not.toMatch(/"(?:\$schema|const|minLength|discriminator)":/);
  });
});
