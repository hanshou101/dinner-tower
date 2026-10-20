import { defineConfig } from "@playwright/test";

// E2E is always headless (AGENTS.md: the machine is shared, never steal focus).
// The fixture MCP server also serves the host harness page; Playwright starts it.
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3301",
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx test/harness/fixture-server.ts",
    url: "http://127.0.0.1:3301/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { HARNESS_PORT: "3301" },
  },
});
