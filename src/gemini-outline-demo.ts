import { briefingMock } from "./mocks/briefing.mock.js";
import { GeminiOutlineGenerationProvider } from "./providers/gemini-outline-generation.provider.js";
import { AiOutlineGenerationService } from "./services/ai-generation.service.js";

async function main(): Promise<void> {
  if (process.env.DECKAI_ENABLE_REAL_GEMINI !== "true") {
    throw new Error(
      "Execução real desativada. Defina DECKAI_ENABLE_REAL_GEMINI=true para autorizar uma única solicitação ao Gemini.",
    );
  }

  const provider = new GeminiOutlineGenerationProvider();
  const generation = new AiOutlineGenerationService(provider);
  const script = await generation.generateScriptProposal(briefingMock);

  console.log("Roteiro gerado pelo Gemini e validado pelo Zod:");
  console.log(JSON.stringify(script, null, 2));
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Falha inesperada na demonstração.";
  console.error(message);
  process.exitCode = 1;
});
