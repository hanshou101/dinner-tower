import { defineConfig } from "@playwright/test";

// AC-8 against the real stack: T4's MCP server in DEMO_MODE plus the T3/T6
// simulator. Both are started here; nothing is mocked and no LLM is involved.
export default defineConfig({
  testDir: "./test/real",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8080",
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm --prefix ../server start",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: false,
      timeout: 90_000,
      env: { DEMO_MODE: "1", HOST: "127.0.0.1", PORT: "3001" },
    },
    {
      command: "npm --prefix ../sim start",
      url: "http://127.0.0.1:8080/api/config",
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        SIM_PORT: "8080",
        SANDBOX_PORT: "8081",
        MCP_URL: "http://127.0.0.1:3001/mcp",
        DEMO_MODE: "1",
      },
    },
  ],
});
