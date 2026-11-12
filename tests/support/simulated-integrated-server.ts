// Browser-test entry point only. No real provider transport or credentials.
import { createIntegratedServer } from "../../src/integrated/server.js";
import { DeepSeekGenerationProvider } from "../../src/providers/deepseek-generation.provider.js";
import { MockAiGenerationProvider } from "../../src/providers/mock-ai-generation.provider.js";
import { presentationMetadata } from "../../src/providers/ai-presentation-contract.js";
import { generateScript } from "../../src/services/generation.service.js";
import { briefingMock } from "../../src/mocks/briefing.mock.js";
import { geminiSlides } from "./gemini-fixtures.js";
import type { Script } from "../../src/schemas/script.schema.js";
import type { SlideRegenerationInput } from "../../src/services/slide-regeneration.service.js";

process.env.DECKAI_ENABLE_REAL_DEEPSEEK="true";
process.env.DECKAI_ENABLE_REAL_GEMINI="true";
const simulatedFetch: typeof fetch = async (_url,init) => {
  const body = JSON.parse(init!.body as string);
  const prompt = body.messages[1].content as string;
  const match = prompt.match(/Roteiro editado e aprovado: (.+)/);
  let output: unknown;
  if (body.messages.some((message: { role: string; content: string }) => message.role === "system" && message.content.includes("Regenere SOMENTE"))) {
    output = await new MockAiGenerationProvider().regenerateSlide(JSON.parse(body.messages.at(-1).content) as SlideRegenerationInput);
  } else if (body.max_tokens === 2048) {
    const input = JSON.parse(body.messages.at(-1).content);
    output = { text: `Sugestão simulada: ${input.original}` };
  } else if (match) {
    const script = JSON.parse(match[1]) as Script;
    output={slides:geminiSlides(script).map(s => ({...s,referenceIds:[presentationMetadata(script,"deepseek").references[0].id]}))};
  } else {
    const script = generateScript(briefingMock);
    output={title:script.title,plannedSlides:script.plannedSlides.map(({id,...s})=>s)};
  }
  return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]}));
};
const server=createIntegratedServer(() => new MockAiGenerationProvider(),() => new DeepSeekGenerationProvider({apiKey:"test-only-fake-key",model:"deepseek-flash",fetch:simulatedFetch}));
server.listen(4185,"127.0.0.1",() => console.log("Simulated providers: http://127.0.0.1:4185"));
