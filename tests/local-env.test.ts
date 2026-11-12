import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const serverModule = pathToFileURL(join(root, "src/integrated/server.ts")).href;

async function checkStartup(options: { local: boolean; inherited?: boolean; direct?: boolean }) {
  // Never inspect or load the user's root .env.local. Every child gets its own
  // disposable project directory and a small, allowlisted environment.
  const temporaryRoot = join(root, "test-results");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, "local-env-"));
  const entryDirectory = join(directory, "src", "integrated");
  await mkdir(entryDirectory, { recursive: true });
  const entry = join(entryDirectory, "server.ts");
  const envFile = join(directory, ".env.local");
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "LOCALAPPDATA"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  const loaded = options.local && !options.direct;
  const expected = {
    DEEPSEEK_API_KEY: options.inherited ? "fictional-inherited-key" : loaded ? "fictional-file-key" : undefined,
    DEEPSEEK_MODEL: options.inherited ? "fictional-inherited-model" : loaded ? "fictional-file-model" : undefined,
    DECKAI_ENABLE_REAL_DEEPSEEK: options.inherited ? "false" : loaded ? "true" : undefined,
  };
  if (options.inherited) Object.assign(env, expected);
  try {
    if (options.local) await writeFile(envFile, "DEEPSEEK_API_KEY=fictional-file-key\nDEEPSEEK_MODEL=fictional-file-model\nDECKAI_ENABLE_REAL_DEEPSEEK=true\n", "utf8");
    await writeFile(entry, `
      import { createIntegratedServer } from ${JSON.stringify(serverModule)};
      const expected = ${JSON.stringify(expected)};
      const keys = ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "DECKAI_ENABLE_REAL_DEEPSEEK"];
      if (!keys.every(key => process.env[key] === expected[key])) throw new Error("Environment precedence check failed");
      // No provider is instantiated and no generation endpoint is called.
      const server = createIntegratedServer();
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const base = "http://127.0.0.1:" + server.address().port;
        const state = await fetch(base + "/api/state");
        const hidden = await fetch(base + "/.env.local");
        if (state.status !== 200 || (await state.json()).provider !== null || hidden.status !== 404) throw new Error("Server startup check failed");
        console.log("LOCAL_ENV_STARTUP_OK");
      } finally { await new Promise(resolve => server.close(resolve)); }
    `, "utf8");
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const args = options.direct ? ["--import=tsx", "src/integrated/server.ts"] : manifest.scripts["dev:integrated"].split(" ").slice(1);
    expect(manifest.scripts["dev:integrated"].split(" ")[0]).toBe("node");
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: directory, env, windowsHide: true, timeout: 10000 });
      let output = "";
      child.stdout.on("data", data => { output += data.toString(); });
      child.stderr.on("data", data => { output += data.toString(); });
      child.once("error", reject);
      child.once("close", code => resolve({ code, output }));
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("LOCAL_ENV_STARTUP_OK");
    // Do not log even the fictitious credential values.
    expect(result.output.includes("fictional-")).toBe(false);
  } finally {
    // Remove only the exact temporary files created by this test, without recursion.
    await unlink(entry);
    if (options.local) await unlink(envFile);
    await rmdir(entryDirectory);
    await rmdir(join(directory, "src"));
    await rmdir(directory);
  }
}

describe("native local-development environment loading", () => {
  it("starts the integrated server with a fictitious .env.local", async () => checkStartup({ local: true }));
  it("preserves inherited key, model and disabled flag over file values", async () => checkStartup({ local: true, inherited: true }));
  it("starts without a local file", async () => checkStartup({ local: false }));
  it("does not load files when starting the server outside the development command", async () => checkStartup({ local: true, direct: true }));
  it("keeps the Run Task on the development script and root working directory", async () => {
    const config = JSON.parse(await readFile(join(root, ".vscode/tasks.json"), "utf8"));
    const task = config.tasks.find((task: { label: string }) => task.label === "DeckAI — Iniciar sistema integrado");
    expect(task.command).toBe("npm.cmd run dev:integrated");
    expect(task.options.cwd).toBe("${workspaceFolder}");
    expect(task.options.env.INTEGRATED_PORT).toBe("4175");
  });
});
