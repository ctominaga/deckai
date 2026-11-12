import { briefingMock } from "./mocks/briefing.mock.js";
import {
  approveScript,
  generatePresentation,
  generateScript,
} from "./services/generation.service.js";
import { briefingSchema } from "./schemas/briefing.schema.js";

const briefing = briefingSchema.parse(briefingMock);
console.log("Briefing recebido:");
console.log(JSON.stringify(briefing, null, 2));

const draftScript = generateScript(briefing);
console.log("\nRoteiro gerado (rascunho):");
console.log(JSON.stringify(draftScript, null, 2));

const approvedScript = approveScript(draftScript);
console.log("\nRoteiro aprovado (simulação local):");
console.log(JSON.stringify(approvedScript, null, 2));

const presentation = generatePresentation(approvedScript);
console.log("\nApresentação JSON validada:");
console.log(JSON.stringify(presentation, null, 2));
