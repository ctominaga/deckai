import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekGenerationProvider, defaultDeepSeekModel } from "../src/providers/deepseek-generation.provider.js";
import { presentationMetadata } from "../src/providers/ai-presentation-contract.js";
import { generateScript, approveScript, updateScript } from "../src/services/generation.service.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { geminiSlides } from "./support/gemini-fixtures.js";
import { adaptPresentation } from "../src/integration/presentation-adapter.js";
import { GenerationFailure } from "../src/services/generation-diagnostics.js";

const secret = "TEST_ONLY_SECRET_NEVER_ECHO";
const draft = generateScript(briefingMock);
const approved = approveScript(draft);
const outline = { title: draft.title, plannedSlides: draft.plannedSlides.map(({ id, ...s }) => s) };
function slidesFor(script = approved) {
  return geminiSlides(script).map(s => ({...s,referenceIds:[presentationMetadata(script,"deepseek").references[0].id]}));
}
function reply(content: unknown, reason = "stop") {
  return new Response(JSON.stringify({choices:[{finish_reason:reason,message:{content}}]}),{headers:{"Content-Type":"application/json"}});
}
function providerFor(response: () => Response | Promise<Response>) {
  const transport = vi.fn(async () => response());
  return {provider:new DeepSeekGenerationProvider({apiKey:secret,model:"deepseek-flash",fetch:transport}),transport};
}
beforeEach(() => {
  vi.stubEnv("DECKAI_ENABLE_REAL_DEEPSEEK","true");
  vi.stubEnv("DEEPSEEK_API_KEY","");
  vi.stubEnv("DEEPSEEK_MODEL","deepseek-flash");
  vi.stubGlobal("fetch",vi.fn(() => {throw new Error("External network forbidden");}));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("DeepSeek HTTP adapter without external calls", () => {
  it("generates a validated draft using JSON Output and the official endpoint", async () => {
    const transport = vi.fn(async (_url: unknown, _options: unknown) => reply(JSON.stringify(outline)));
    const provider = new DeepSeekGenerationProvider({apiKey:secret,fetch:transport});
    const result = await provider.generateScriptProposal(briefingMock);
    expect(result.status).toBe("draft");
    expect(result.plannedSlides).toHaveLength(6);
    expect(result.plannedSlides[0].id).toBe("deepseek-slide-001");
    const [url, init] = transport.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({model:defaultDeepSeekModel,stream:false,thinking:{type:"disabled"},max_tokens:4096,response_format:{type:"json_object"}});
    expect(body.messages[1].content).toContain(briefingMock.prompt);
    expect(body.messages[1].content).toContain("JSON Schema");
    expect(body.messages[1].content).not.toContain(secret);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("uses the edited, approved revision, all six layouts, IDs, titles, references and shared adapter", async () => {
    const edited = approveScript(updateScript(draft,{revision:1,title:"Título editado",plannedSlides:draft.plannedSlides.map((s,i) => ({...s,title:`Título ${i}`,objective:`Objetivo editado ${i}`,keyPoints:[`Tópico novo ${i}`]}))}));
    const transport = vi.fn(async (_url: unknown,_options:unknown) => reply(JSON.stringify({slides:slidesFor(edited)})));
    const provider = new DeepSeekGenerationProvider({apiKey:secret,fetch:transport});
    const presentation = await provider.generatePresentation(edited,briefingMock);
    expect(presentation.id).toContain(`deepseek-${edited.id}-r2`);
    expect(presentation.title).toBe(edited.title);
    expect(presentation.slides.map(s => ({id:s.id,title:s.title,layout:s.layout}))).toEqual(edited.plannedSlides.map(s => ({id:s.id,title:s.title,layout:s.layout})));
    const request = JSON.parse((transport.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
    expect(request.max_tokens).toBe(16384);
    expect(request.messages[1].content).toContain(JSON.stringify(edited));
    expect(request.messages[1].content).toContain("Tópico novo 0");
    expect(adaptPresentation(presentation,"jump-default").presentation.slides).toHaveLength(6);
    const metrics = presentation.slides.find(s => s.layout === "metrics")!;
    if (metrics.layout === "metrics") expect(metrics.metrics[0].context).toContain("Demonstração fictícia");
  });
  it("blocks unapproved input without invoking HTTP", async () => {
    const {provider,transport} = providerFor(() => reply("{}"));
    await expect(provider.generatePresentation(draft,briefingMock)).rejects.toThrow("Aprove");
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects duplicate IDs and invalid briefing before HTTP", async () => {
    const {provider,transport} = providerFor(() => reply("{}"));
    await expect(provider.generatePresentation({...approved,plannedSlides:approved.plannedSlides.map(s => ({...s,id:"same"}))})).rejects.toThrow("duplicados");
    await expect(provider.generateScriptProposal({...briefingMock,slideCount:0})).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([400,401,402,422,429,500,503,418])("sanitizes HTTP %i without retry or fallback", async status => {
    const {provider,transport} = providerFor(() => new Response(secret+" CONFIDENTIAL_BODY",{status}));
    let error: GenerationFailure | undefined;
    try { await provider.generateScriptProposal(briefingMock); } catch (e) {error=e as GenerationFailure;}
    expect(error).toBeInstanceOf(GenerationFailure);
    expect(error!.diagnostic.upstreamStatus).toBe(status);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error!.message).not.toContain("CONFIDENTIAL_BODY");
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each(["", "   ", null, "{", "```json\n{}\n```", "{}"])("rejects empty, invalid or incompatible outline content %j", async content => {
    const {provider} = providerFor(() => reply(content));
    await expect(provider.generateScriptProposal(briefingMock)).rejects.toBeInstanceOf(GenerationFailure);
  });
  it.each(["length","content_filter","tool_calls","insufficient_system_resource"])("rejects interrupted output %s even if JSON parses", async reason => {
    const {provider} = providerFor(() => reply(JSON.stringify(outline),reason));
    await expect(provider.generateScriptProposal(briefingMock)).rejects.toMatchObject({diagnostic:{code:reason === "length" ? "TOKEN_LIMIT" : "INCOMPLETE_RESPONSE"}});
  });
  it.each(["{", "{}", '{"choices":[]}', '{"choices":[{"message":{"content":"{}"}}]}'])("rejects invalid HTTP envelopes %s", async raw => {
    const {provider} = providerFor(() => new Response(raw));
    await expect(provider.generatePresentation(approved)).rejects.toBeInstanceOf(GenerationFailure);
  });
  it("detects incorrect outline slide count", async () => {
    const {provider} = providerFor(() => reply(JSON.stringify({...outline,plannedSlides:outline.plannedSlides.slice(0,1)})));
    await expect(provider.generateScriptProposal(briefingMock)).rejects.toMatchObject({diagnostic:{code:"SLIDE_COUNT_MISMATCH"}});
  });
  it.each(["id","title","order","layout","reference","image","schema"])("rejects presentation mismatch: %s", async change => {
    const slides = slidesFor();
    if (change === "id") slides[0].id="wrong";
    if (change === "title") slides[0].title="wrong";
    if (change === "order") [slides[0],slides[1]]=[slides[1],slides[0]];
    if (change === "reference") slides[0].referenceIds=["fake-source"];
    if (change === "layout") slides[0]={id:slides[0].id,title:slides[0].title,referenceIds:slides[0].referenceIds,layout:"closing",message:"text",callToAction:"text"};
    if (change === "image" && slides[0].layout === "cover") slides[0].imageId="invented-real-asset";
    if (change === "schema") (slides[0] as unknown as Record<string,unknown>).extra="forbidden";
    const {provider} = providerFor(() => reply(JSON.stringify({slides})));
    await expect(provider.generatePresentation(approved)).rejects.toBeInstanceOf(GenerationFailure);
  });
  it("supports configurable model and sanitizes transport failures", async () => {
    const transport = vi.fn(async () => {throw new Error(secret);});
    const provider = new DeepSeekGenerationProvider({apiKey:secret,model:"deepseek-v4-pro",fetch:transport});
    await expect(provider.generateScriptProposal(briefingMock)).rejects.toThrow("Não foi possível comunicar");
    expect(transport).toHaveBeenCalledOnce();
  });
  it("aborts on timeout and never retries", async () => {
    const transport = vi.fn((_url: unknown,init?:RequestInit) => new Promise<Response>((_resolve,reject) => {
      init!.signal!.addEventListener("abort",() => reject(new Error(secret)),{once:true});
    }));
    const provider = new DeepSeekGenerationProvider({apiKey:secret,timeoutMs:5,fetch:transport});
    await expect(provider.generateScriptProposal(briefingMock)).rejects.toMatchObject({diagnostic:{code:"TIMEOUT"}});
    expect(transport).toHaveBeenCalledOnce();
  });
  it("times out while reading the HTTP body, not only while receiving headers", async () => {
    const transport = vi.fn(async (_url:unknown,init?:RequestInit) => ({ok:true,json:() => new Promise((_resolve,reject) => init!.signal!.addEventListener("abort",() => reject(new Error(secret)),{once:true}))}) as Response);
    const provider = new DeepSeekGenerationProvider({apiKey:secret,timeoutMs:5,fetch:transport});
    await expect(provider.generateScriptProposal(briefingMock)).rejects.toMatchObject({diagnostic:{code:"TIMEOUT"}});
  });
  it("reports missing credentials, disabled mode and invalid configuration", async () => {
    expect(() => new DeepSeekGenerationProvider()).toThrow("DEEPSEEK_API_KEY");
    expect(() => new DeepSeekGenerationProvider({apiKey:secret,model:" "})).toThrow("DEEPSEEK_MODEL");
    expect(() => new DeepSeekGenerationProvider({apiKey:secret,timeoutMs:0})).toThrow("timeout");
    const {provider,transport} = providerFor(() => reply("{}"));
    vi.stubEnv("DECKAI_ENABLE_REAL_DEEPSEEK","false");
    await expect(provider.generateScriptProposal(briefingMock)).rejects.toThrow("DeepSeek desativado");
    expect(transport).not.toHaveBeenCalled();
  });
});
