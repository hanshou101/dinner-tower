import { expect, test, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Agent mode (SPEC §6.5 / AC-10).
 *
 * 1. No LLM in the environment → the agent input is disabled and says what to
 *    set; direct mode is untouched. Always runs.
 * 2. A *scripted* OpenAI-compatible endpoint in front of the real
 *    dinner-tower server: proves the loop, the /api/chat proxy, tool mapping,
 *    the elicitation card (answered by a click) and the reply bubble.
 * 3. AC-10 proper — a real LLM gets the real sentence. Skipped unless
 *    LLM_BASE_URL / LLM_API_KEY / LLM_MODEL are in the environment.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../..");
const PROOF_DIR = join(REPO, "proof");
const GOLDEN = ["turkey", "stuffing", "mashed_potatoes", "green_beans", "gravy", "rolls"];
const SENTENCE =
  "I'm hosting Thanksgiving at 7. Turkey, stuffing, mashed potatoes, green beans, gravy and rolls.";

const serverDeps =
  existsSync(join(REPO, "server/node_modules")) && existsSync(join(REPO, "scheduler/node_modules"));
const boardBuilt = existsSync(join(REPO, "board/dist/board.html"));

test.beforeAll(() => {
  mkdirSync(PROOF_DIR, { recursive: true });
});

// ---------------------------------------------------------------- helpers

function startRealServer(port: number, dataFile: string): ChildProcess {
  return spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(REPO, "server"),
    env: {
      ...process.env,
      PORT: String(port),
      DEMO_MODE: "1",
      DEMO_CLOCK_START: "13:00",
      DT_DATA_FILE: dataFile,
    },
    stdio: "ignore",
  });
}

function startSim(options: {
  port: number;
  sandboxPort: number;
  mcpPort: number;
  llmBaseUrl: string;
  apiKey: string;
  model: string;
}): ChildProcess {
  return spawn("npx", ["tsx", "server.ts"], {
    cwd: join(REPO, "sim"),
    env: {
      ...process.env,
      MCP_URL: `http://127.0.0.1:${options.mcpPort}/mcp`,
      SIM_PORT: String(options.port),
      SANDBOX_PORT: String(options.sandboxPort),
      LLM_BASE_URL: options.llmBaseUrl,
      LLM_API_KEY: options.apiKey,
      LLM_MODEL: options.model,
    },
    stdio: "ignore",
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function stopServer(process: ChildProcess | undefined): void {
  if (process && !process.killed) process.kill("SIGTERM");
}

/** Arguments the page sent, read back from the tool-call log entry. */
async function loggedArguments(entry: Locator): Promise<Record<string, unknown>> {
  const raw = await entry.locator("pre").textContent();
  const parsed = JSON.parse(raw ?? "{}") as { request?: { arguments?: Record<string, unknown> } };
  return parsed.request?.arguments ?? {};
}

/** Alexa bubbles only. The server's elicitation message is one of them too. */
function alexaBubbles(page: Page): Locator {
  return page.locator('[data-testid="utterance"][data-role="alexa"]');
}

/**
 * The turn is over only when the panel says so. Waiting for "some Alexa bubble
 * is non-empty" is not enough: the elicitation message is one, and it is there
 * long before the model's reply.
 */
async function waitForAgentIdle(page: Page): Promise<void> {
  await expect(page.locator("#agent-panel")).toHaveAttribute("data-busy", "false", {
    timeout: 120_000,
  });
}

/** The bubble text without the "Alexa" speaker label. */
async function bubbleText(bubble: Locator): Promise<string> {
  return (await bubble.innerText()).replace(/^\s*Alexa\s*/, "").trim();
}

// ---------------------------------------------------------------- 1. no LLM

test.describe("agent mode without an LLM endpoint", () => {
  test.skip(Boolean(process.env.LLM_API_KEY), "LLM_* is exported in this shell — the page is configured");

  test("input is disabled and states what to set, direct mode still works", async ({ page }) => {
    await page.goto("/");

    const hint = "Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env to enable agent mode";
    await expect(page.getByTestId("agent-input")).toBeDisabled();
    await expect(page.getByTestId("agent-input")).toHaveAttribute("placeholder", hint);
    await expect(page.getByTestId("agent-hint")).toHaveText(hint);
    await expect(page.getByTestId("agent-send")).toBeDisabled();
    await page.screenshot({ path: join(PROOF_DIR, "T6-agent-00-disabled.png") });

    // The honest manual mode is untouched: the console still drives real tools.
    await page.locator("#console > summary").click();
    await page.getByLabel("Tool").selectOption("show_echo");
    await page.getByLabel("Arguments JSON").fill(JSON.stringify({ label: "still manual" }));
    await page.getByRole("button", { name: "Call tool" }).click();
    await expect(page.getByTestId("tool-call").filter({ hasText: "show_echo" }).first()).toHaveAttribute(
      "data-status",
      "ok",
    );
  });
});

// ---------------------------------------------------------------- 2. scripted model, real server

test.describe("agent loop against the real server (scripted LLM)", () => {
  test.skip(!serverDeps, "needs server/ and scheduler/ node_modules (npm install)");

  let server: ChildProcess | undefined;
  let sim: ChildProcess | undefined;
  let stub: Server | undefined;
  const requests: Array<Record<string, unknown>> = [];

  test.beforeAll(async () => {
    const dataFile = join(mkdtempSync(join(tmpdir(), "dt-agent-")), "household.json");

    stub = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as { messages?: Array<{ role: string }> };
        requests.push(body as Record<string, unknown>);

        const sawToolResult = (body.messages ?? []).some((message) => message.role === "tool");
        const message = sawToolResult
          ? {
              role: "assistant",
              content: "Done — everything lands at 7:00 PM. First up at 3:10: season and truss the turkey.",
            }
          : {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_plan_1",
                  type: "function",
                  function: {
                    name: "plan_dinner",
                    arguments: JSON.stringify({ dishes: GOLDEN, serveAt: "19:00" }),
                  },
                },
              ],
            };

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ message }] }));
      });
    });
    await new Promise<void>((resolve) => stub!.listen(3299, "127.0.0.1", resolve));

    server = startRealServer(3202, dataFile);
    await waitFor("http://127.0.0.1:3202/health", 60_000);

    sim = startSim({
      port: 8280,
      sandboxPort: 8281,
      mcpPort: 3202,
      llmBaseUrl: "http://127.0.0.1:3299/v1",
      apiKey: "stub-key-not-a-secret",
      model: "stub-model",
    });
    await waitFor("http://127.0.0.1:8280/api/config", 60_000);
  });

  test.afterAll(async () => {
    stopServer(sim);
    stopServer(server);
    await new Promise<void>((resolve) => (stub ? stub.close(() => resolve()) : resolve()));
  });

  test("one sentence → plan_dinner → elicitation → reply", async ({ page }) => {
    await page.goto("http://127.0.0.1:8280/");
    await expect(page.getByTestId("connection-badge")).toContainText("dinner-tower 1.0.0");
    await expect(page.getByTestId("agent-model")).toHaveText("stub-model");

    await page.getByTestId("agent-input").fill(SENTENCE);
    await page.getByTestId("agent-send").click();

    const planCall = page.getByTestId("tool-call").filter({ hasText: "plan_dinner" }).first();
    await expect(planCall).toHaveAttribute("data-source", "agent");
    // The turn is still in flight here — this is the signal F2's wait keys on.
    await expect(page.locator("#agent-panel")).toHaveAttribute("data-busy", "true");

    // The server's elicitation reaches the screen and is answered by a click.
    await expect(page.getByTestId("elicitation-card")).toBeVisible();
    await expect(page.getByTestId("elicitation-message")).toContainText(
      "Your oven can only hold one temperature at a time",
    );
    await page.screenshot({ path: join(PROOF_DIR, "T6-agent-01-elicitation.png") });

    await page.getByTestId("elicitation-option").filter({ hasText: "Share the oven" }).click();
    await expect(planCall).toHaveAttribute("data-status", "ok");
    await waitForAgentIdle(page);

    const args = await loggedArguments(planCall);
    expect(args.serveAt).toBe("19:00");
    expect([...(args.dishes as string[])].sort()).toEqual([...GOLDEN].sort());

    if (boardBuilt) {
      await expect(page.locator("iframe.app-frame")).toBeVisible();
    } else {
      // T5 owns board/; this ticket must not fake one, so the page says why.
      await expect(page.getByText(/Board UI not built/)).toBeVisible();
    }

    await expect(
      page.getByTestId("utterance").filter({ hasText: "everything lands at 7:00 PM" }),
    ).toBeVisible();
    await page.screenshot({ path: join(PROOF_DIR, "T6-agent-02-conversation.png") });

    // What the proxy actually forwarded: real SKILL.md in the system prompt,
    // the configured model, and the MCP tools as OpenAI functions.
    const last = requests.at(-1) ?? {};
    const messages = (last as { messages?: Array<{ role: string; content?: string }> }).messages ?? [];
    const system = messages.find((message) => message.role === "system");
    expect(system?.content).toContain("# Dinner Tower");
    expect(system?.content).toContain("Call `plan_dinner`");
    expect(system?.content).toContain("You are Alexa+ (simulated) on an Echo Show");
    expect((last as { model?: string }).model).toBe("stub-model");
    const names = ((last as { tools?: Array<{ function: { name: string } }> }).tools ?? []).map(
      (tool) => tool.function.name,
    );
    expect(names).toEqual(expect.arrayContaining(["plan_dinner", "whats_next", "report_delay", "list_dishes"]));
  });

  test("the reply is spoken only while the voice switch is on", async ({ page }) => {
    await page.goto("http://127.0.0.1:8280/");
    await page.evaluate(() => {
      (window as unknown as { __spoken: string[] }).__spoken = [];
      const synth = {
        speak: (utterance: { text: string }) =>
          (window as unknown as { __spoken: string[] }).__spoken.push(utterance.text),
        cancel: () => {},
        getVoices: () => [{ lang: "en-US", name: "Test Voice" }],
      };
      Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: class {
          text: string;
          lang = "";
          voice: unknown;
          rate = 1;
          constructor(text: string) {
            this.text = text;
          }
        },
        configurable: true,
      });
    });

    await page.getByTestId("voice-toggle").uncheck();
    await page.getByTestId("agent-input").fill("What's next?");
    await page.getByTestId("agent-send").click();
    await page.getByTestId("elicitation-option").filter({ hasText: "Share the oven" }).click();
    await waitForAgentIdle(page);
    await expect(
      page.getByTestId("utterance").filter({ hasText: "everything lands at 7:00 PM" }),
    ).toBeVisible();

    expect(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 3. AC-10 with a real LLM

const llm = {
  baseUrl: process.env.LLM_BASE_URL?.trim(),
  apiKey: process.env.LLM_API_KEY?.trim(),
  model: process.env.LLM_MODEL?.trim(),
};

test.describe("AC-10 with the configured LLM", () => {
  test.skip(!llm.baseUrl || !llm.apiKey || !llm.model, "needs LLM_BASE_URL / LLM_API_KEY / LLM_MODEL");

  let server: ChildProcess | undefined;
  let sim: ChildProcess | undefined;

  test.beforeAll(async () => {
    const dataFile = join(mkdtempSync(join(tmpdir(), "dt-live-")), "household.json");
    server = startRealServer(3203, dataFile);
    await waitFor("http://127.0.0.1:3203/health", 60_000);

    sim = startSim({
      port: 8290,
      sandboxPort: 8291,
      mcpPort: 3203,
      llmBaseUrl: llm.baseUrl!,
      apiKey: llm.apiKey!,
      model: llm.model!,
    });
    await waitFor("http://127.0.0.1:8290/api/config", 60_000);
  });

  test.afterAll(() => {
    stopServer(sim);
    stopServer(server);
  });

  test("the model picks the golden menu and 19:00, then the board answers share-oven", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("http://127.0.0.1:8290/");
    await expect(page.getByTestId("agent-model")).toHaveText(llm.model!);

    await page.getByTestId("agent-input").fill(SENTENCE);
    await page.getByTestId("agent-send").click();

    const planCall = page.getByTestId("tool-call").filter({ hasText: "plan_dinner" }).first();
    await expect(planCall).toHaveAttribute("data-source", "agent");
    await expect(page.getByTestId("elicitation-card")).toBeVisible({ timeout: 120_000 });
    await page.screenshot({ path: join(PROOF_DIR, "T6-agent-03-live-elicitation.png") });

    const elicitationMessage = (await page.getByTestId("elicitation-message").innerText()).trim();
    const bubblesBefore = await alexaBubbles(page).count();

    await page.getByTestId("elicitation-option").filter({ hasText: "Share the oven" }).click();
    await expect(planCall).toHaveAttribute("data-status", "ok");

    // F2: wait for the turn to actually finish, then require a NEW bubble with
    // real text. "Some Alexa bubble is non-empty" was already true before the
    // model answered — the elicitation message is an Alexa bubble.
    await waitForAgentIdle(page);
    const bubblesAfter = await alexaBubbles(page).count();
    expect(bubblesAfter).toBeGreaterThan(bubblesBefore);
    const replyText = await bubbleText(alexaBubbles(page).last());
    expect(replyText.length).toBeGreaterThan(0);
    expect(replyText).not.toBe(elicitationMessage);

    const args = await loggedArguments(planCall);
    expect(args.serveAt).toBe("19:00");
    expect([...(args.dishes as string[])].sort()).toEqual([...GOLDEN].sort());

    if (boardBuilt) {
      const appFrame = page.frameLocator("iframe.app-frame").frameLocator("iframe");
      await expect(appFrame.getByText(/SERVE/)).toBeVisible({ timeout: 60_000 });
    } else {
      // Same branch as the scripted suite: T5 owns board/, do not fake it.
      await expect(page.getByText(/Board UI not built/)).toBeVisible();
    }

    await page.screenshot({ path: join(PROOF_DIR, "T6-agent-04-live-conversation.png") });
  });
});
