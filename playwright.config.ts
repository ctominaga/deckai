import { defineConfig } from "@playwright/test";
const integratedPort = process.env.DECKAI_TEST_PORT ?? "4175";
const integratedUrl = `http://127.0.0.1:${integratedPort}`;
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: integratedUrl, trace: "retain-on-failure" },
  webServer: [{
    // Tests deliberately bypass the development env-file loader.
    command: "node --import=tsx src/integrated/server.ts",
    url: integratedUrl,
    reuseExistingServer: false,
    env: { INTEGRATED_PORT: integratedPort, DECKAI_ENABLE_REAL_GEMINI: "false", DECKAI_ENABLE_REAL_DEEPSEEK: "false" },
  }, {
    command: "node --import=tsx tests/support/simulated-integrated-server.ts",
    url: "http://127.0.0.1:4185",
    reuseExistingServer: false,
  }],
});
