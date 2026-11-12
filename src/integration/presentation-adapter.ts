import { presentationSchema, type Presentation } from "../schemas/presentation.schema.js";

interface Block {
  id: string;
  type: "text" | "image" | "metric";
  role?: string;
  text?: string;
  label?: string;
  value?: string;
}

/** Export projection only: the original presentation remains the source of truth. */
export function adaptPresentation(input: Presentation, themeId: string) {
  const source = presentationSchema.parse(input);
  if (source.aspectRatio !== "16:9") {
    throw new Error("O contrato oficial aceita apenas 16:9; a apresentação 4:3 não foi convertida.");
  }
  if (!themeId.trim()) throw new Error("Informe um themeId explicitamente.");
  const warnings = [
    "O schema oficial não comporta id/título da apresentação, catálogo de referências ou classificação de dados. Esses metadados permanecem no JSON original.",
    "As referências são demonstrativas, sem validação institucional. Não foi consultada a biblioteca Jump.",
  ];
  const slides = source.slides.map((slide) => {
    const blocks: Block[] = [];
    const text = (role: string, value: string) => blocks.push({ id: `${slide.id}/${role}`, type: "text", role, text: value });
    text("title", slide.title);
    switch (slide.layout) {
      case "cover":
        text("subtitle", slide.subtitle);
        break;
      case "text_image":
        text("body", slide.body);
        break;
      case "two_columns":
        text("left.heading", slide.left.heading);
        text("left.body", slide.left.body);
        text("right.heading", slide.right.heading);
        text("right.body", slide.right.body);
        break;
      case "metrics":
        text("dataClassification", slide.dataClassification);
        slide.metrics.forEach((metric, index) => {
          blocks.push({ id: `${slide.id}/metrics/${index}`, type: "metric", label: metric.label, value: metric.value });
          text(`metrics/${index}/context`, metric.context);
        });
        break;
      case "case":
        text("dataClassification", slide.dataClassification);
        for (const key of ["organization", "challenge", "approach", "result"] as const) text(key, slide[key]);
        break;
      case "closing":
        text("message", slide.message);
        text("callToAction", slide.callToAction);
        break;
    }
    if ("imageId" in slide) {
      // A prototype placeholder is not a registered asset. Do not invent assetId.
      warnings.push(`${slide.id}: imagem ${slide.imageId} é placeholder; bloco de imagem omitido por ausência de assetId real.`);
    }
    return { slideId: slide.id, layout: slide.layout, blocks, references: [...slide.referenceIds] };
  });
  return {
    presentation: { schemaVersion: "1.0" as const, canvas: { width: 1920, height: 1080, ratio: "16:9" as const }, themeId, slides },
    warnings,
  };
}
