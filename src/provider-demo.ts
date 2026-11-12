import { briefingMock } from "./mocks/briefing.mock.js";
import { MockAiGenerationProvider } from "./providers/mock-ai-generation.provider.js";
import { AiGenerationService } from "./services/ai-generation.service.js";

const generation = new AiGenerationService(new MockAiGenerationProvider());

const draftScript = await generation.generateScriptProposal(briefingMock);
console.log("Briefing recebido:");
console.log(JSON.stringify(briefingMock, null, 2));
console.log("\nProposta de roteiro do provedor mock:");
console.log(JSON.stringify(draftScript, null, 2));

const approvedScript = generation.approveScript(draftScript);
console.log("\nRoteiro aprovado explicitamente:");
console.log(JSON.stringify(approvedScript, null, 2));

const presentation = await generation.generatePresentation(approvedScript);
console.log("\nApresentação JSON validada:");
console.log(JSON.stringify(presentation, null, 2));
