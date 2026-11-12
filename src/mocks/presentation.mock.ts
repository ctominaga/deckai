import type { Presentation } from "../schemas/presentation.schema.js";

export const presentationMock: Presentation = {
  schemaVersion: "1.0.0",
  id: "deck-demo-001",
  title: "Projeto Horizonte — apresentação demonstrativa",
  aspectRatio: "16:9",
  references: [
    {
      id: "ref-demo-001",
      label: "Material fictício criado apenas para demonstração",
      type: "demonstration",
    },
  ],
  slides: [
    {
      id: "slide-demo-001",
      layout: "cover",
      title: "Projeto Horizonte",
      subtitle: "Uma apresentação inteiramente fictícia",
      imageId: "img-demo-cover-001",
      referenceIds: [],
    },
    {
      id: "slide-demo-002",
      layout: "text_image",
      title: "Uma ideia para conectar bairros",
      body: "O Projeto Horizonte imagina um serviço comunitário de troca de livros. Esta proposta e seu contexto são fictícios.",
      imageId: "img-demo-community-001",
      referenceIds: [],
    },
    {
      id: "slide-demo-003",
      layout: "two_columns",
      title: "Como a ideia funcionaria",
      left: {
        heading: "Pontos de encontro",
        body: "Espaços imaginários para deixar e retirar livros.",
      },
      right: {
        heading: "Participação local",
        body: "Moradores fictícios ajudam a organizar as trocas.",
      },
      referenceIds: [],
    },
    {
      id: "slide-demo-004",
      layout: "metrics",
      title: "Indicadores de exemplo",
      dataClassification: "DEMONSTRATION",
      metrics: [
        {
          label: "Livros compartilhados",
          value: "120",
          context: "Número inteiramente fictício para demonstração.",
        },
        {
          label: "Pontos de encontro",
          value: "8",
          context: "Número inteiramente fictício para demonstração.",
        },
      ],
      referenceIds: ["ref-demo-001"],
    },
    {
      id: "slide-demo-005",
      layout: "case",
      title: "Case fictício: Biblioteca Aurora",
      dataClassification: "DEMONSTRATION",
      organization: "Biblioteca Aurora (organização fictícia)",
      challenge: "Imaginar formas de aproximar leitores de um bairro.",
      approach: "Simular pontos locais de troca de livros.",
      result: "Cenário demonstrativo, sem resultados reais.",
      referenceIds: ["ref-demo-001"],
    },
    {
      id: "slide-demo-006",
      layout: "closing",
      title: "Vamos imaginar juntos",
      message: "Toda boa ideia começa com uma conversa.",
      callToAction: "Obrigado pela atenção.",
      referenceIds: [],
    },
  ],
};
