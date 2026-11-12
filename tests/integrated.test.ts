import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntegratedServer } from "../src/integrated/server.js";
import { MockAiGenerationProvider } from "../src/providers/mock-ai-generation.provider.js";
import { briefingMock } from "../src/mocks/briefing.mock.js";

let server: Server;
let base: string;
async function start(factory?: Parameters<typeof createIntegratedServer>[0]) {
  server = createIntegratedServer(factory);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function post(path: string, body: unknown) {
  return fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
}
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server?.listening) await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve()));
});
describe("integrated official application", () => {
  it("serves dashboard, navigation, AI assets and Dev 3 on the same origin", async () => {
    await start();
    for (const path of ["/","/gerar-ia.html","/prototipo.html","/ai/app.js","/ai/styles.css","/ai-shell.css","/ai/shared-json.js"]) {
      const response = await fetch(base+path);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("GEMINI_API_KEY");
      if (path === "/") expect(text).toContain('href="gerar-ia.html"');
      if (path === "/gerar-ia.html") { expect(text).toContain("official-side"); expect(text).not.toContain("iframe"); }
      if (path === "/prototipo.html") expect(text).toContain("deckai.prototype.presentations");
    }
    for (const path of ["/.env","/.git/config","/package.json","/src/providers/gemini-outline-generation.provider.ts"]) expect((await fetch(base+path)).status).toBe(404);
    expect((await fetch(base+"/api/presentation/shared")).status).toBe(409);
  });
  it("generates, approves, exports and invalidates the official projection on edits", async () => {
    await start();
    const {script} = await (await post("/api/scripts",{...briefingMock,slideCount:6,provider:"mock"})).json();
    const action = `/api/scripts/${script.id}`;
    expect((await post(action+"/presentation",{revision:1})).status).toBe(409);
    expect((await post(action+"/approve",{revision:1})).status).toBe(200);
    expect((await post(action+"/presentation",{revision:1})).status).toBe(201);
    const projection = await (await fetch(base+"/api/presentation/shared")).json();
    expect(projection.presentation.schemaVersion).toBe("1.0");
    expect(projection.presentation.slides).toHaveLength(6);
    const edited = await (await post(action+"/edit",{revision:1,title:"Título revisado",plannedSlides:script.plannedSlides})).json();
    expect(edited.script.revision).toBe(2);
    expect((await fetch(base+"/api/presentation/shared")).status).toBe(409);
    expect((await post(action+"/approve",{revision:1})).status).toBe(409);
    expect((await post(action+"/presentation",{revision:2})).status).toBe(409);
    expect((await post(action+"/approve",{revision:2})).status).toBe(200);
    expect((await post(action+"/presentation",{revision:2})).status).toBe(201);
  });
  it("supports an injected Gemini provider without a real network call", async () => {
    vi.stubEnv("DECKAI_ENABLE_REAL_GEMINI","true");
    const factory = vi.fn(() => new MockAiGenerationProvider());
    await start(factory);
    const {script,provider} = await (await post("/api/scripts",{...briefingMock,provider:"gemini"})).json();
    expect(provider).toBe("gemini");
    expect(factory).toHaveBeenCalledOnce();
    await post(`/api/scripts/${script.id}/approve`,{revision:1});
    const result = await post(`/api/scripts/${script.id}/presentation`,{revision:1});
    expect(result.status).toBe(201);
    expect((await result.json()).provider).toBe("gemini");
  });
  it("rejects cross-origin generation before constructing a provider", async () => {
    const factory = vi.fn(() => new MockAiGenerationProvider());
    await start(factory);
    const response = await fetch(base+"/api/scripts",{method:"POST",headers:{Origin:"https://other.invalid","Content-Type":"application/json"},body:JSON.stringify({...briefingMock,provider:"gemini"})});
    expect(response.status).toBe(403);
    expect(factory).not.toHaveBeenCalled();
  });
});
