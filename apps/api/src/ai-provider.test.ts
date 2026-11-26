import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AiProviderError, validatePresentationEvidence, type AiOutline, type ApprovedJumpContext, type ProviderPresentation } from "./ai-provider.js";

const contentId = randomUUID();
const context: ApprovedJumpContext[] = [{ id: contentId, title: "Jump", text: "A Jump atende 100 clientes.", sourceLabel: "Relatório aprovado", sourceUrl: null }];
const outline: AiOutline = {
  id: randomUUID(), title: "Proposta", status: "approved", revision: 1,
  briefing: { prompt: "Crie uma proposta", objective: "Apresentar", audience: "Clientes", tone: "consultivo", language: "pt-BR", slideCount: 1 },
  slides: [{ id: randomUUID(), title: "Nossa proposta", objective: "Apresentar", layout: "cover", keyPoints: ["Introdução"], referenceIds: [] }]
};

function presentation(blocks: ProviderPresentation["slides"][number]["blocks"], referenceIds: string[] = []): ProviderPresentation {
  return { slides: [{ layout: "cover", blocks, referenceIds }] };
}

describe("evidências da apresentação gerada", () => {
  it("recusa texto institucional ou métrica sem referência antes de persistir", () => {
    const body = presentation([
      { type: "text", role: "title", text: "Nossa proposta" },
      { type: "text", role: "body", text: "A Jump atende 100 clientes." }
    ]);
    expect(() => validatePresentationEvidence(body, outline, context)).toThrowError(new AiProviderError("AI_CLAIM_WITHOUT_REFERENCE", "O slide 1 contém texto sem referência.", true));

    const metric = presentation([
      { type: "text", role: "title", text: "Nossa proposta" },
      { type: "metric", role: "indicator", value: "100", label: "clientes" }
    ]);
    expect(() => validatePresentationEvidence(metric, outline, context)).toThrowError(new AiProviderError("AI_CLAIM_WITHOUT_REFERENCE", "O slide 1 contém uma métrica sem referência.", true));

    const factualTitle = presentation([{ type: "text", role: "title", text: "Líder em tecnologia no Brasil" }]);
    expect(() => validatePresentationEvidence(factualTitle, outline, context)).toThrowError(new AiProviderError("AI_CLAIM_WITHOUT_REFERENCE", "O slide 1 contém texto sem referência.", true));
  });

  it("aceita título decorativo, pergunta e placeholder sem fonte", () => {
    const nonFactual = presentation([
      { type: "text", role: "title", text: "Nossa proposta" },
      { type: "text", role: "body", text: "Quais resultados você espera?" },
      { type: "text", role: "caption", text: "Informação a confirmar" }
    ]);
    expect(() => validatePresentationEvidence(nonFactual, outline, [])).not.toThrow();
  });

  it("aceita a fonte aprovada e recusa um UUID de fora do contexto", () => {
    const body = [{ type: "text" as const, role: "body" as const, text: "A Jump atende 100 clientes." }];
    expect(() => validatePresentationEvidence(presentation(body, [contentId]), outline, context)).not.toThrow();
    expect(() => validatePresentationEvidence(presentation(body, [randomUUID()]), outline, context)).toThrowError(AiProviderError);
  });

  it("preserva a referência do roteiro aprovado no slide desenvolvido", () => {
    const citedOutline: AiOutline = { ...outline, slides: [{ ...outline.slides[0]!, referenceIds: [contentId] }] };
    const decorative = presentation([{ type: "text", role: "title", text: "Nossa proposta" }]);
    expect(() => validatePresentationEvidence(decorative, citedOutline, context)).toThrowError(new AiProviderError("AI_CLAIM_WITHOUT_REFERENCE", "O slide 1 perdeu uma referência do roteiro aprovado.", true));
  });
});
