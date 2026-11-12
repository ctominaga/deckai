import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createIntegratedServer } from "../src/integrated/server.js";
import { DeepSeekGenerationProvider } from "../src/providers/deepseek-generation.provider.js";
import { presentationMetadata } from "../src/providers/ai-presentation-contract.js";
import { generateScript } from "../src/services/generation.service.js";
import type { Script } from "../src/schemas/script.schema.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";
import { geminiSlides } from "./support/gemini-fixtures.js";

const secret="FAKE_KEY_MUST_NOT_LEAK";
let server: Server;
let base: string;
let logger: ReturnType<typeof vi.spyOn>;
const proposal=generateScript(briefingMock);
function envelope(output:unknown) {return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]}));}
function outline() {return envelope({title:proposal.title,plannedSlides:proposal.plannedSlides.map(({id,...s})=>s)});}
function presentation(init: RequestInit) {
  const prompt=JSON.parse(init.body as string).messages[1].content as string;
  const script=JSON.parse(prompt.match(/Roteiro editado e aprovado: (.+)/)![1]) as Script;
  return envelope({slides:geminiSlides(script).map(s=>({...s,referenceIds:[presentationMetadata(script,"deepseek").references[0].id]}))});
}
async function start(transport:typeof fetch) {
  server=createIntegratedServer(undefined,()=>new DeepSeekGenerationProvider({apiKey:secret,model:"deepseek-flash",fetch:transport}));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const post=(path:string,body:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.stubEnv("DECKAI_ENABLE_REAL_DEEPSEEK","true");
  logger=vi.spyOn(console,"error").mockImplementation(()=>{});
});
afterEach(async()=>{
  if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
  vi.restoreAllMocks();vi.unstubAllEnvs();
});
it("routes DeepSeek end-to-end and exports the edited presentation without a Gemini fallback",async()=>{
  const transport=vi.fn(async (_url:unknown,init?:RequestInit)=>JSON.parse(init!.body as string).max_tokens===4096?outline():presentation(init!));
  await start(transport);
  const {script}=await(await post("/api/scripts",{...briefingMock,provider:"deepseek"})).json();
  const route=`/api/scripts/${script.id}`;
  const edited=await(await post(route+"/edit",{revision:1,title:"DeepSeek editado",plannedSlides:script.plannedSlides})).json();
  expect(edited.script.revision).toBe(2);
  expect((await post(route+"/presentation",{revision:2})).status).toBe(409);
  await post(route+"/approve",{revision:2});
  const result=await post(route+"/presentation",{revision:2});
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({provider:"deepseek",presentation:{title:"DeepSeek editado"}});
  expect((await(await fetch(base+"/api/presentation/shared")).json()).presentation.slides).toHaveLength(6);
  expect((await(await fetch(base+"/api/state")).json()).presentationProvider).toBe("deepseek");
  expect(transport).toHaveBeenCalledTimes(2);
});
it("does not let a late DeepSeek presentation overwrite a newer edit",async()=>{
  let release!:()=>void;
  let entered!:()=>void;
  const pending=new Promise<void>(resolve=>entered=resolve);
  const transport=vi.fn(async (_url:unknown,init?:RequestInit)=>{
    if(JSON.parse(init!.body as string).max_tokens===4096)return outline();
    entered();await new Promise<void>(resolve=>release=resolve);return presentation(init!);
  });
  await start(transport);
  const {script}=await(await post("/api/scripts",{...briefingMock,provider:"deepseek"})).json();
  const route=`/api/scripts/${script.id}`;
  await post(route+"/approve",{revision:1});
  const late=post(route+"/presentation",{revision:1});
  await pending;
  await post(route+"/edit",{revision:1,title:"Edição mais recente",plannedSlides:script.plannedSlides});
  release();
  expect((await late).status).toBe(409);
  const state=await(await fetch(base+"/api/state")).json();
  expect(state.script).toMatchObject({title:"Edição mais recente",revision:2,status:"draft"});
  expect(state.presentation).toBeNull();
});
it("returns clear disabled/missing-configuration errors without making HTTP calls",async()=>{
  const transport=vi.fn(async()=>outline());
  await start(transport);
  vi.stubEnv("DECKAI_ENABLE_REAL_DEEPSEEK","false");
  const response=await post("/api/scripts",{...briefingMock,provider:"deepseek"});
  expect((await response.json()).error).toContain("DeepSeek desativado");
  expect(transport).not.toHaveBeenCalled();
});
it("sanitizes upstream error bodies in API responses and diagnostics",async()=>{
  const transport=vi.fn(async()=>new Response(secret,{status:503}));
  await start(transport);
  const response=await post("/api/scripts",{...briefingMock,provider:"deepseek"});
  const text=await response.text();
  expect(text).toContain("503");expect(text).not.toContain(secret);
  expect(logger).toHaveBeenCalledWith("[DeckAI generation]",expect.stringContaining('"upstreamStatus":503'));
  expect(transport).toHaveBeenCalledOnce();
});
