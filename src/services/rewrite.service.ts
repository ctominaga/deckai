import { z } from "zod";
import { briefingSchema, type Briefing } from "../schemas/briefing.schema.js";
import type { Script } from "../schemas/script.schema.js";
import { rewriteRequestSchema, rewriteTextSchema, type RewriteRequest, type RewriteTarget } from "../schemas/rewrite.schema.js";
import { updateScript } from "./generation.service.js";
import { GenerationFailure } from "./generation-diagnostics.js";

export interface RewriteInput {
  briefing: Briefing;
  field: RewriteTarget["field"];
  original: string;
  operation: RewriteRequest["operation"];
  instruction: string;
  tone: string;
  context: { scriptTitle: string; slideTitle?: string; slideObjective?: string; layout?: string };
  classification: "DEMONSTRATION";
}
export interface AiRewriteProvider { suggestRewrite(input: RewriteInput): Promise<unknown> }

export function selectedText(script: Script, target: RewriteTarget): string {
  if (target.field === "scriptTitle") return script.title;
  const slide = script.plannedSlides.find(s => s.id === target.slideId);
  if (!slide) throw new Error("O slide selecionado não existe no roteiro atual.");
  const text = target.field === "keyPoint" ? slide.keyPoints[target.topicIndex] : slide[target.field];
  if (text === undefined) throw new Error("O tópico selecionado não existe no roteiro atual.");
  return text;
}

export function prepareRewrite(script: Script, briefing: Briefing, request: RewriteRequest): RewriteInput {
  const valid = rewriteRequestSchema.parse(request);
  const original = rewriteTextSchema(valid.target).parse(selectedText(script, valid.target));
  const target = valid.target;
  const slide = target.field === "scriptTitle" ? undefined : script.plannedSlides.find(s => s.id === target.slideId);
  const input: RewriteInput = {
    briefing: briefingSchema.parse(briefing), field: valid.target.field, original,
    operation: valid.operation, instruction: valid.instruction, tone: valid.tone,
    context: { scriptTitle: script.title, ...(slide ? { slideTitle: slide.title, slideObjective: slide.objective, layout: slide.layout } : {}) },
    classification: "DEMONSTRATION",
  };
  // Do not truncate silently: a user can shorten the source before requesting AI.
  if (JSON.stringify(input).length > 12000) throw new Error("O contexto excede o limite de 12.000 caracteres. Reduza o briefing ou o campo selecionado.");
  return input;
}

export function validateRewrite(response: unknown, target: RewriteTarget, input: RewriteInput): string {
  const result = z.object({ text: rewriteTextSchema(target) }).strict().safeParse(response);
  if (!result.success) throw new GenerationFailure("A sugestão deve conter somente um texto não vazio, dentro do limite do campo.", {
    stage: "rewrite.zod", origin: "local", category: "zod", code: "INVALID_SUGGESTION",
  });
  let text = result.data.text;
  // Keep explicit fiction labels even when the model removes them.
  if ((/fict[ií]ci|demonstra[çc][aã]o|demonstrativ/i.test(input.original) || ["case", "metrics"].includes(input.context.layout ?? "")) &&
      !/fict[ií]ci|demonstra[çc][aã]o|demonstrativ/i.test(text)) text = `Demonstração fictícia: ${text}`;
  if (!rewriteTextSchema(target).safeParse(text).success) throw new Error("A sugestão excede o limite do campo após preservar a classificação fictícia.");
  return text;
}

export function applyRewrite(script: Script, target: RewriteTarget, text: string): Script {
  const valid = rewriteTextSchema(target).parse(text);
  selectedText(script, target);
  const changes = { title: script.title, plannedSlides: structuredClone(script.plannedSlides) };
  if (target.field === "scriptTitle") changes.title = valid;
  else {
    const slide = changes.plannedSlides.find(s => s.id === target.slideId)!;
    if (target.field === "keyPoint") slide.keyPoints[target.topicIndex] = valid;
    else slide[target.field] = valid;
  }
  return updateScript(script, changes);
}
