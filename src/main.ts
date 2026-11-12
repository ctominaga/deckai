import { presentationSchema } from "./schemas/presentation.schema.js";
import { presentationMock } from "./mocks/presentation.mock.js";

const presentation = presentationSchema.parse(presentationMock);

console.log(JSON.stringify(presentation, null, 2));
