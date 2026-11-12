import { describe, expect, it } from "vitest";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { presentationMock } from "../src/mocks/presentation.mock.js";
import type { AiGenerationProvider } from "../src/providers/ai-generation-provider.js";
import { MockAiGenerationProvider } from "../src/providers/mock-ai-generation.provider.js";
import { presentationSchema } from "../src/schemas/presentation.schema.js";
import { scriptSchema } from "../src/schemas/script.schema.js";
import {
  approveScript,
  generatePresentation,
  generateScript,
} from "../src/services/generation.service.js";
import { AiGenerationService } from "../src/services/ai-generation.service.js";

describe("AiGenerationService with provider adapters", () => {
  it("uses the mock provider", async () => {
    const service = new AiGenerationService(new MockAiGenerationProvider());

    await expect(service.generateScriptProposal(briefingMock)).resolves.toMatchObject({
      status: "draft",
    });
  });

  it("generates a script proposal through the provider interface", async () => {
    const service = new AiGenerationService(new MockAiGenerationProvider());
    const script = await service.generateScriptProposal(briefingMock);

    expect(scriptSchema.safeParse(script).success).toBe(true);
    expect(script.plannedSlides).toHaveLength(briefingMock.slideCount);
  });

  it("generates a presentation through the provider interface", async () => {
    const service = new AiGenerationService(new MockAiGenerationProvider());
    const draft = await service.generateScriptProposal(briefingMock);
    const approved = service.approveScript(draft);
    const presentation = await service.generatePresentation(approved);

    expect(presentationSchema.safeParse(presentation).success).toBe(true);
  });

  it("rejects invalid provider responses for both operations", async () => {
    const invalidScriptProvider: AiGenerationProvider = {
      async generateScriptProposal() {
        return { status: "draft" };
      },
      async generatePresentation() {
        return presentationMock;
      },
    };
    const invalidPresentationProvider: AiGenerationProvider = {
      async generateScriptProposal() {
        return generateScript(briefingMock);
      },
      async generatePresentation() {
        return { schemaVersion: "invalid" };
      },
    };

    await expect(
      new AiGenerationService(invalidScriptProvider).generateScriptProposal(
        briefingMock,
      ),
    ).rejects.toThrow("Resposta inválida do provedor para roteiro");

    const script = approveScript(generateScript(briefingMock));
    await expect(
      new AiGenerationService(
        invalidPresentationProvider,
      ).generatePresentation(script),
    ).rejects.toThrow("Resposta inválida do provedor para apresentação");
  });

  it("blocks unapproved scripts before calling the provider", async () => {
    let providerCalled = false;
    const provider: AiGenerationProvider = {
      async generateScriptProposal() {
        return generateScript(briefingMock);
      },
      async generatePresentation() {
        providerCalled = true;
        return presentationMock;
      },
    };
    const service = new AiGenerationService(provider);
    const draft = await service.generateScriptProposal(briefingMock);

    await expect(service.generatePresentation(draft)).rejects.toThrow(
      "ainda não foi aprovado",
    );
    expect(providerCalled).toBe(false);
  });

  it("preserves the original deterministic generation functions", () => {
    const firstDraft = generateScript(briefingMock);
    const secondDraft = generateScript(briefingMock);
    const presentation = generatePresentation(approveScript(firstDraft));

    expect(firstDraft).toEqual(secondDraft);
    expect(presentationSchema.safeParse(presentation).success).toBe(true);
  });
});
