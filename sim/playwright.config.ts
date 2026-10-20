import { defineConfig } from "@playwright/test";

// E2E is always headless (AGENTS.md: the machine is shared, never steal focus).
// The fixture MCP server and the simulator server are started by Playwright.
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8180",
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npx tsx test/fixtures/fixture-server.ts",
      url: "http://127.0.0.1:3201/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { FIXTURE_PORT: "3201" },
    },
    {
      command: "npx tsx server.ts",
      url: "http://127.0.0.1:8180/api/config",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        MCP_URL: "http://127.0.0.1:3201/mcp",
        SIM_PORT: "8180",
        SANDBOX_PORT: "8181",
      },
    },
  ],
});
