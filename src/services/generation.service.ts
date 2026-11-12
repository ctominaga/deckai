import type { Briefing } from "../schemas/briefing.schema.js";
import { briefingSchema } from "../schemas/briefing.schema.js";
import { presentationSchema } from "../schemas/presentation.schema.js";
import type { Presentation, Slide } from "../schemas/presentation.schema.js";
import { scriptSchema } from "../schemas/script.schema.js";
import type { PlannedSlide, Script } from "../schemas/script.schema.js";

const layoutPlan = [
  {
    layout: "cover",
    title: "A iniciativa",
    objective: "Apresentar o tema e o propósito da iniciativa.",
    keyPoints: [
      "Pedido: {prompt}",
      "Público: {audience}; tom: {tone}; idioma: {language}",
    ],
  },
  {
    layout: "text_image",
    title: "A ideia central",
    objective: "Explicar a proposta para o público.",
    keyPoints: ["Proposta", "Público: {audience}"],
  },
  {
    layout: "two_columns",
    title: "Como funcionaria",
    objective: "Contrastar a proposta e a participação da comunidade.",
    keyPoints: ["Pontos de encontro", "Participação local"],
  },
  {
    layout: "metrics",
    title: "Indicadores de demonstração",
    objective: "Ilustrar possíveis indicadores sem alegar resultados reais.",
    keyPoints: ["Valores fictícios", "Cenário demonstrativo"],
  },
  {
    layout: "case",
    title: "Um case fictício",
    objective: "Mostrar um cenário ilustrativo da iniciativa.",
    keyPoints: ["Desafio imaginário", "Resultado não real"],
  },
  {
    layout: "closing",
    title: "Próximos passos",
    objective: "Encerrar a apresentação com uma mensagem.",
    keyPoints: ["Síntese", "Convite à conversa"],
  },
] as const;

export function generateScript(briefing: Briefing): Script {
  const validBriefing = briefingSchema.parse(briefing);
  const plannedSlides: PlannedSlide[] = Array.from(
    { length: validBriefing.slideCount },
    (_, index) => {
      const plan = layoutPlan[index % layoutPlan.length];
      return {
        id: `script-slide-${String(index + 1).padStart(3, "0")}`,
        title: plan.title,
        objective: plan.objective,
        layout: plan.layout,
        keyPoints: plan.keyPoints.map((point) =>
          point
            .replace("{prompt}", validBriefing.prompt)
            .replace("{audience}", validBriefing.audience)
            .replace("{tone}", validBriefing.tone)
            .replace("{language}", validBriefing.language),
        ),
      };
    },
  );

  return scriptSchema.parse({
    id: "script-demo-001",
    title: validBriefing.objective,
    status: "draft",
    revision: 1,
    plannedSlides,
  });
}

export function approveScript(script: Script): Script {
  const validScript = scriptSchema.parse(script);
  return scriptSchema.parse({ ...validScript, status: "approved" });
}

export function updateScript(
  script: Script,
  changes: Pick<Script, "title" | "plannedSlides">,
): Script {
  const validScript = scriptSchema.parse(script);
  if (changes.plannedSlides.length !== validScript.plannedSlides.length) {
    throw new Error("A edição não pode alterar a quantidade de slides.");
  }
  if (changes.plannedSlides.some(
    (slide, index) => slide.id !== validScript.plannedSlides[index].id,
  )) {
    throw new Error("A edição não pode alterar a identidade ou a ordem dos slides.");
  }

  return scriptSchema.parse({
    ...validScript,
    title: changes.title,
    plannedSlides: changes.plannedSlides,
    status: "draft",
    revision: validScript.revision + 1,
  });
}

export function generatePresentation(script: Script): Presentation {
  const validScript = scriptSchema.parse(script);
  if (validScript.status !== "approved") {
    throw new Error(
      `O roteiro "${validScript.id}" ainda não foi aprovado. Aprove o roteiro antes de gerar a apresentação.`,
    );
  }

  const references = [
    {
      id: `generated-${validScript.id}-ref-demo`,
      label: "Conteúdo fictício criado apenas para demonstração",
      type: "demonstration" as const,
    },
  ];

  const slides: Slide[] = validScript.plannedSlides.map((plannedSlide, index) =>
    generateSlide(validScript, plannedSlide, index, references[0].id),
  );

  return presentationSchema.parse({
    schemaVersion: "1.0.0",
    id: `generated-${validScript.id}`,
    title: validScript.title,
    aspectRatio: "16:9",
    slides,
    references,
  });
}

function generateSlide(
  script: Script,
  plannedSlide: PlannedSlide,
  index: number,
  referenceId: string,
): Slide {
  const id = `generated-${script.id}-slide-${String(index + 1).padStart(3, "0")}`;
  const referenceIds = ["metrics", "case"].includes(plannedSlide.layout)
    ? [referenceId]
    : [];
  const topics = plannedSlide.keyPoints;

  switch (plannedSlide.layout) {
    case "cover":
      return {
        id,
        layout: "cover",
        title: plannedSlide.title,
        subtitle: `${plannedSlide.objective} ${topics.join(". ")} (demonstração fictícia)`,
        imageId: `img-${script.id}-${index + 1}`,
        referenceIds,
      };
    case "text_image":
      return {
        id,
        layout: "text_image",
        title: plannedSlide.title,
        body: `${plannedSlide.objective} ${topics.join(". ")}. Conteúdo fictício.`,
        imageId: `img-${script.id}-${index + 1}`,
        referenceIds,
      };
    case "two_columns":
      return {
        id,
        layout: "two_columns",
        title: plannedSlide.title,
        left: {
          heading: topics[0],
          body: `${plannedSlide.objective} Este cenário é fictício.`,
        },
        right: {
          heading: topics[1] ?? topics[0],
          body: "A participação descrita é apenas demonstrativa.",
        },
        referenceIds,
      };
    case "metrics":
      return {
        id,
        layout: "metrics",
        title: plannedSlide.title,
        dataClassification: "DEMONSTRATION",
        metrics: [
          {
            label: topics[0],
            value: "120",
            context: "Valor fictício, sem relação com resultados reais.",
          },
        ],
        referenceIds,
      };
    case "case":
      return {
        id,
        layout: "case",
        title: plannedSlide.title,
        dataClassification: "DEMONSTRATION",
        organization: "Organização fictícia",
        challenge: topics[0],
        approach: plannedSlide.objective,
        result: "Cenário inteiramente demonstrativo, sem resultados reais.",
        referenceIds,
      };
    case "closing":
      return {
        id,
        layout: "closing",
        title: plannedSlide.title,
        message: plannedSlide.objective,
        callToAction: topics[1] ?? topics[0],
        referenceIds,
      };
  }
}
