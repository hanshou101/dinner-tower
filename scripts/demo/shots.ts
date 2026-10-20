#!/usr/bin/env npx tsx
/**
 * proof/ui screenshots (docs/07-UI.md §5) — one command, eight PNGs.
 *
 * Boots the same stack the demo video uses (real MCP server, real simulator,
 * scripted LLM when no keys are present), drives the four states that the
 * review board scores, and captures each at 1280×720 and 1440×900.
 *
 *   npx tsx scripts/demo/shots.ts       → proof/ui/*.png
 *
 * Screenshots are always taken in demo mode (no `?dev=1`): no version string,
 * no session id, no model name, no raw JSON in the frame.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startScriptedLlm, type ScriptedLlm } from "./scripted-llm.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const OUT = join(REPO, "proof/ui");

const SENTENCE =
  "Alexa, I'm hosting Thanksgiving at 7. Turkey, stuffing, mashed potatoes, green beans, gravy and rolls.";
const ASK_NEXT = "Alexa, what's next?";
const DELAY = "Alexa, the turkey needs twenty more minutes.";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(file)) return values;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value !== "") values[key] = value;
  }
  return values;
}

async function waitFor(probe: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch {
      /* keep waiting */
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitHttp(url: string, timeoutMs: number): Promise<void> {
  await waitFor(async () => (await fetch(url)).ok, timeoutMs, url);
}

interface StackOptions {
  mcpPort: number;
  simPort: number;
  sandboxPort: number;
  dataFile: string;
  llm: { baseUrl: string; apiKey: string; model: string };
  logDir: string;
}

class Stack {
  private server?: ChildProcess;
  private sim?: ChildProcess;

  constructor(private readonly options: StackOptions) {}

  private spawnLogged(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    logName: string,
  ): ChildProcess {
    const fd = openSync(join(this.options.logDir, logName), "a");
    // Own process group: `tsx` starts a child, and stopping the wrapper alone
    // leaves the real server holding the port.
    return spawn(command, args, { cwd, env, stdio: ["ignore", fd, fd], detached: true });
  }

  async startServer(): Promise<void> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(this.options.mcpPort),
      DEMO_MODE: "1",
      DEMO_CLOCK_START: "13:00",
      DT_DATA_FILE: this.options.dataFile,
      DT_BOARD_HTML: join(REPO, "board/dist/board.html"),
    };
    delete env.LLM_API_KEY;
    this.server = this.spawnLogged(
      join(REPO, "server/node_modules/.bin/tsx"),
      ["src/index.ts"],
      join(REPO, "server"),
      env,
      "server.log",
    );
    await waitHttp(`http://127.0.0.1:${this.options.mcpPort}/health`, 90_000);
  }

  async startSim(): Promise<void> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MCP_URL: `http://127.0.0.1:${this.options.mcpPort}/mcp`,
      SIM_PORT: String(this.options.simPort),
      SANDBOX_PORT: String(this.options.sandboxPort),
      LLM_BASE_URL: this.options.llm.baseUrl,
      LLM_API_KEY: this.options.llm.apiKey,
      LLM_MODEL: this.options.llm.model,
      DEMO_MODE: "1",
    };
    this.sim = this.spawnLogged(
      join(REPO, "sim/node_modules/.bin/tsx"),
      ["server.ts"],
      join(REPO, "sim"),
      env,
      "sim.log",
    );
    await waitHttp(`http://127.0.0.1:${this.options.simPort}/`, 90_000);
  }

  async setClock(time: string): Promise<void> {
    const response = await fetch(`http://127.0.0.1:${this.options.mcpPort}/demo/clock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ time }),
    });
    if (!response.ok) throw new Error(`demo clock ${time} rejected: HTTP ${response.status}`);
  }

  async stop(): Promise<void> {
    for (const child of [this.server, this.sim]) {
      if (!child || child.exitCode !== null || child.pid === undefined) continue;
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      await Promise.race([exited, sleep(6_000)]);
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }
  }
}

function boardFrame(page: Page) {
  return page.frameLocator("iframe.app-frame").frameLocator("iframe");
}

async function connected(page: Page): Promise<void> {
  await waitFor(
    async () => (await page.getByTestId("connection-badge").getAttribute("data-state")) === "connected",
    45_000,
    "the simulator to connect",
  );
}

async function lastAlexaText(page: Page): Promise<string> {
  const bubbles = page.locator('[data-testid="utterance"][data-role="alexa"]');
  const count = await bubbles.count();
  if (count === 0) return "";
  return (await bubbles.nth(count - 1).innerText()).replace(/^\s*ALEXA\s*/i, "").trim();
}

async function agentIdle(page: Page): Promise<void> {
  await waitFor(
    async () => (await page.getByTestId("agent-panel").getAttribute("data-busy")) === "false",
    180_000,
    "the agent turn to finish",
  );
}

async function toolOk(page: Page, name: string): Promise<void> {
  await waitFor(
    async () => {
      const entry = page.getByTestId("tool-call").filter({ hasText: name }).last();
      if ((await entry.count()) === 0) return false;
      return (await entry.getAttribute("data-status")) === "ok";
    },
    180_000,
    `${name} to finish`,
  );
}

async function boardRows(page: Page, min = 9): Promise<void> {
  await waitFor(
    async () => (await boardFrame(page).locator('[data-testid="row"]').count()) >= min,
    120_000,
    `the board to render ${min}+ rows`,
  );
}

async function say(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("agent-input");
  await waitFor(async () => await input.isEnabled(), 30_000, "the composer");
  await input.fill(text);
  await page.getByTestId("agent-send").click();
}

/**
 * Devpost thumbnail (3:2, 1500×1000): the device frame with the live board on
 * the right, the wordmark and the one-line claim on the left. Composed here so
 * the cover is regenerated together with the screenshots it is drawn from.
 */
async function coverHtml(devicePng: string): Promise<string> {
  const faces = readdirSync(join(REPO, "design/fonts"))
    .filter((file) => file.endsWith(".woff2"))
    .map((file) => {
      const family = file.startsWith("barlow-semi-condensed")
        ? "Barlow Semi Condensed"
        : file.startsWith("jetbrains")
          ? "JetBrains Mono"
          : "Barlow";
      const weight = Number(file.match(/-(\d{3})-normal/)?.[1] ?? 400);
      const data = readFileSync(join(REPO, "design/fonts", file)).toString("base64");
      return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
    })
    .join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${faces}
    * { box-sizing: border-box; margin: 0; }
    html, body { width: 1500px; height: 1000px; overflow: hidden; }
    body {
      background:
        radial-gradient(900px 620px at 8% 6%, rgba(245, 165, 36, 0.14), transparent 62%),
        radial-gradient(1000px 700px at 100% 100%, rgba(56, 120, 180, 0.16), transparent 60%),
        #07090d;
      color: #e8edf4; font-family: "Barlow", sans-serif;
      padding: 92px 40px 92px 84px;
      display: grid; grid-template-columns: 540px 1fr; gap: 24px; align-items: center;
    }
    .kicker { font: 600 15px/1 "Barlow Semi Condensed", sans-serif; letter-spacing: 0.22em; text-transform: uppercase; color: #8a97a8; }
    h1 { font: 700 82px/0.94 "Barlow Semi Condensed", sans-serif; letter-spacing: 0.03em; text-transform: uppercase; margin: 26px 0 0; }
    h1 span { display: block; color: #f5a524; }
    p { font: 500 26px/1.36 "Barlow", sans-serif; color: #c8d2de; margin: 28px 0 0; max-width: 500px; }
    .meta { margin-top: 46px; font: 500 17px/1.5 "JetBrains Mono", monospace; color: #8a97a8; }
    .meta b { color: #f5a524; font-weight: 700; }
    .shot { position: relative; justify-self: end; }
    .shot img { display: block; width: 100%; border-radius: 30px; box-shadow: 0 40px 90px rgba(0,0,0,.62); }
    .shot::after {
      content: ""; position: absolute; inset: -1px; border-radius: 30px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); pointer-events: none;
    }
  </style></head><body>
    <div>
      <div class="kicker">Amazon Developer Hackathon · Alexa+ track</div>
      <h1>Dinner<span>Tower</span></h1>
      <p>Air-traffic control for Thanksgiving. Every dish lands hot at the same minute.</p>
      <div class="meta"><b>for Alexa+</b> · MCP 2025-11-25 · MIT<br>github.com/hanshou101/dinner-tower</div>
    </div>
    <div class="shot"><img src="data:image/png;base64,${devicePng}" alt="Dinner Tower departure board on an Echo Show"></div>
  </body></html>`;
}

async function captureCover(browser: Browser, page: Page): Promise<void> {
  const device = await page.locator(".device").screenshot();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const cover = await context.newPage();
  await cover.setContent(await coverHtml(device.toString("base64")), { waitUntil: "load" });
  await cover.evaluate(() => document.fonts.ready);
  const file = join(REPO, "submission/cover-1500x1000.png");
  await cover.screenshot({ path: file });
  await context.close();
  log(`  · submission/cover-1500x1000.png`);
}

async function shoot(page: Page, name: string, width: number, height: number): Promise<void> {
  const file = join(OUT, `${name}-${width}x${height}.png`);
  await page.screenshot({ path: file, animations: "allow" });
  log(`  · ${file.replace(`${REPO}/`, "")}`);
}

async function capture(
  browser: Browser,
  page: Page,
  width: number,
  height: number,
  opts: { fresh: boolean },
): Promise<void> {
  const simUrl = `http://127.0.0.1:${Number(process.env.DEMO_SIM_PORT ?? 8280)}/`;

  if (opts.fresh) {
    await page.goto(simUrl, { waitUntil: "load" });
    await connected(page);
    await sleep(700);
  }

  await shoot(page, "idle", width, height);

  // --- the server asks the oven question mid-call -------------------------
  await say(page, SENTENCE);
  await waitFor(
    async () => await page.getByTestId("elicitation-card").isVisible(),
    120_000,
    "the elicitation card",
  );
  await sleep(450);
  await shoot(page, "elicitation", width, height);

  await page.getByTestId("elicitation-option").filter({ hasText: "Share the oven" }).click();
  await toolOk(page, "plan_dinner");
  await agentIdle(page);
  await boardRows(page);
  await sleep(2_600); // let the flip reel settle before the still
  await shoot(page, "board", width, height);
  if (width === 1280) await captureCover(browser, page);

  // --- later that afternoon ----------------------------------------------
  await fetch(`http://127.0.0.1:${Number(process.env.DEMO_MCP_PORT ?? 3101)}/demo/clock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ time: "18:20" }),
  });
  await page.reload({ waitUntil: "load" });
  await connected(page);
  await sleep(600);
  await say(page, ASK_NEXT);
  await toolOk(page, "whats_next");
  await agentIdle(page);
  await boardRows(page);
  await sleep(1_400);

  const frame = boardFrame(page);
  const before = await frame.locator("#board").getAttribute("data-revision");
  const replyBefore = await lastAlexaText(page);
  await say(page, DELAY);
  await waitFor(
    async () => (await frame.locator("#board").getAttribute("data-revision")) !== before,
    120_000,
    "the board to replan",
  );
  // With a real model the reply can land after the board; without this wait the
  // still shows the tool capsule under the user's line and no answer.
  await agentIdle(page);
  await waitFor(async () => (await lastAlexaText(page)) !== replyBefore, 120_000, "Alexa's reply");
  // The call-out stays up for 3.2 s; wait out the 400 ms flips and the 40 ms
  // per-row stagger so the still shows readable times, not two numerals
  // swapping places.
  await sleep(1_150);
  await shoot(page, "replan", width, height);
}

async function main(): Promise<void> {
  const env = { ...readEnvFile(join(REPO, ".env")), ...process.env };
  process.env.DEMO_MCP_PORT ??= "3101";
  process.env.DEMO_SIM_PORT ??= "8280";
  process.env.DEMO_SANDBOX_PORT ??= "8281";

  const hasKeys = Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);
  let scripted: ScriptedLlm | undefined;
  let llm: { baseUrl: string; apiKey: string; model: string };
  if (hasKeys) {
    llm = { baseUrl: env.LLM_BASE_URL!, apiKey: env.LLM_API_KEY!, model: env.LLM_MODEL! };
    log(`LLM: ${llm.model}`);
  } else {
    scripted = await startScriptedLlm(0);
    llm = { baseUrl: scripted.url, apiKey: "scripted-llm-not-a-secret", model: "scripted-llm" };
    log(`LLM: scripted (${scripted.url}) — board content is real, only the wording is scripted`);
  }

  const logDir = join(REPO, "scripts/demo/out/shots-logs");
  rmSync(logDir, { recursive: true, force: true });
  mkdirSync(logDir, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const dataDir = join(REPO, "scripts/demo/out/shots-state");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
    ] as const) {
      log(`\n▶ ${width}×${height}`);
      // Every viewport gets a fresh household file: the second pass must see
      // the oven question again, exactly like a first-time visitor would.
      const stack = new Stack({
        mcpPort: Number(process.env.DEMO_MCP_PORT),
        simPort: Number(process.env.DEMO_SIM_PORT),
        sandboxPort: Number(process.env.DEMO_SANDBOX_PORT),
        dataFile: join(dataDir, `household-${width}.json`),
        llm,
        logDir,
      });
      try {
        await stack.startServer();
        await stack.startSim();
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await capture(browser, page, width, height, { fresh: true });
        await context.close();
      } finally {
        await stack.stop();
        await sleep(900);
      }
    }
  } finally {
    if (browser) await browser.close();
    await scripted?.close();
  }

  log(`\n${OUT}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
