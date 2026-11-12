import type { Script } from "../../src/schemas/script.schema.js";
import type { Slide } from "../../src/schemas/presentation.schema.js";
import { presentationMetadata } from "../../src/providers/gemini-presentation-contract.js";

// Authored SDK-response fixtures, deliberately distinct from the mock generator.
export function geminiSlides(script: Script): Slide[] {
  const referenceIds = [presentationMetadata(script).references[0].id];
  return script.plannedSlides.map((planned): Slide => {
    const base = { id: planned.id, title: planned.title, referenceIds };
    switch (planned.layout) {
      case "cover": return { ...base, layout: "cover", subtitle: "Uma rede fictícia aproxima leitores e amplia a circulação de livros.", imageId: `placeholder-${planned.id}` };
      case "text_image": return { ...base, layout: "text_image", body: "Pontos de troca em espaços comunitários facilitam o encontro de leitores. Este cenário é fictício.", imageId: `placeholder-${planned.id}` };
      case "two_columns": return { ...base, layout: "two_columns", left: { heading: "Organização", body: "Voluntários fictícios organizam o acervo por temas." }, right: { heading: "Participação", body: "Moradores fictícios deixam um livro e levam outra leitura." } };
      case "metrics": return { ...base, layout: "metrics", dataClassification: "DEMONSTRATION", metrics: [{ label: "Livros em circulação", value: "A preencher", context: "Indicador ilustrativo; levantamento ainda não realizado." }] };
      case "case": return { ...base, layout: "case", dataClassification: "DEMONSTRATION", organization: "Espaço comunitário imaginário", challenge: "Ampliar o acesso fictício à leitura.", approach: "Criar um ponto ilustrativo de troca de livros.", result: "A preencher após validação; sem resultados institucionais reais." };
      case "closing": return { ...base, layout: "closing", message: "A leitura pode aproximar a comunidade neste cenário fictício.", callToAction: "Discuta onde iniciar um piloto demonstrativo." };
    }
  });
}
