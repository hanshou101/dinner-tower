#!/usr/bin/env npx tsx
/**
 * Records the Dinner Tower demo (SPEC §3, §6.7; AC-12).
 *
 * One headless Chromium page, one continuous recording:
 *   title card → the real simulator against the real MCP server → a real
 *   server restart → the board's own +10 MIN button → architecture → closing.
 *
 * Every spoken line is synthesised with macOS `say` (voice.sh) and its audio
 * duration paces the action, so the mux step can place the voice track at the
 * recorded offsets without guessing. Subtitles are part of the page (an
 * overlay), which is why they survive into the final MP4 without a libass font
 * hunt. Output: out/raw/capture.webm + out/timeline.json.
 *
 * The LLM comes from the repository-root `.env` (`LLM_BASE_URL`,
 * `LLM_API_KEY`, `LLM_MODEL`). With `--mode scripted` (or no keys at all) the
 * pipeline uses scripted-llm.ts instead, and every frame carries a burned-in
 * "SAMPLE — scripted LLM" badge.
 */
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { architectureCard, endCard, INIT_SCRIPT, titleCard } from "./overlay.js";
import { GOLDEN_MENU, startScriptedLlm, type ScriptedLlm } from "./scripted-llm.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

const SENTENCE =
  "Alexa, I'm hosting Thanksgiving at 7. Turkey, stuffing, mashed potatoes, green beans, gravy and rolls.";
const ASK_NEXT = "Alexa, what's next?";
const DELAY = "Alexa, the turkey needs twenty more minutes.";

const NARRATOR_OPENING = "Thanksgiving. One oven. Six dishes. And they all have to land at seven.";
const NARRATOR_SCHEDULER =
  "Dinner Tower schedules every step backwards from serve time, around one oven, four burners and two cooks.";
const NARRATOR_MEMORY = "It remembers your kitchen and your plan across sessions.";
const NARRATOR_BOARD =
  "The board is an MCP App — it calls the server directly, no voice needed when your hands are full.";
const NARRATOR_ARCH =
  "Under the hood: a self-hosted MCP server on spec 2025-11-25 over Streamable HTTP, elicitation for the oven question, an MCP App for the board, an Agent Skill that teaches any assistant the workflow, and a scheduler that respects every oven temperature.";
const NARRATOR_END = "Dinner Tower. Every dish lands on time.";

/** Absolute scene endpoints from SPEC §3 (ms from the first frame). */
const TIMELINE_END = {
  opening: 12_000,
  asks: 25_000,
  ovenQuestion: 42_000,
  planLands: 62_000,
  newSession: 82_000,
  delay: 110_000,
  boardTap: 125_000,
  architecture: 150_000,
  closing: 165_000,
} as const;

type Role = "narrator" | "user" | "alexa" | "caption";

interface TimelineLine {
  index: number;
  role: Role;
  text: string;
  audio: string | null;
  voice: string | null;
  durationMs: number;
  startMs: number;
  endMs: number;
}

interface TimelineScene {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
}

interface TimelineMark {
  name: string;
  atMs: number;
}

interface Timeline {
  version: 1;
  mode: "real" | "scripted";
  sample: boolean;
  createdAt: string;
  resolution: { width: number; height: number };
  clip: string;
  wallMs: number;
  lines: TimelineLine[];
  scenes: TimelineScene[];
  marks: TimelineMark[];
}

// ---------------------------------------------------------------- utilities

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

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
    // KEY= (empty) means "not set", the same rule scripts/dev.sh applies.
    if (value !== "") values[key] = value;
  }
  return values;
}

async function waitFor(probe: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? ` (${lastError})` : ""}`);
}

async function waitHttp(url: string, timeoutMs: number): Promise<void> {
  await waitFor(
    async () => {
      const response = await fetch(url);
      return response.ok;
    },
    timeoutMs,
    url,
  );
}

// ---------------------------------------------------------------- voices

interface Clip {
  file: string;
  durationMs: number;
  voice: string;
}

class VoiceBank {
  private readonly cache = new Map<string, Clip>();
  private counter = 0;

  constructor(private readonly audioDir: string) {
    mkdirSync(audioDir, { recursive: true });
  }

  get(role: Role, text: string): Clip {
    const key = `${role}\u0000${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    this.counter += 1;
    const file = join(this.audioDir, `line-${String(this.counter).padStart(3, "0")}-${role}.aiff`);
    const result = spawnSync("bash", [join(HERE, "voice.sh"), "--one", role, file], {
      input: text,
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(`say failed for ${role}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
    const [voice = "system", seconds = "0"] = (result.stdout ?? "").trim().split("\t");
    const clip: Clip = {
      file,
      durationMs: Math.max(200, Math.round(Number.parseFloat(seconds) * 1000)),
      voice,
    };
    this.cache.set(key, clip);
    return clip;
  }

  /** Synthesise ahead of time so no dead air appears in the recording. */
  warm(role: Role, text: string): void {
    try {
      this.get(role, text);
    } catch (error) {
      log(`  (voice warm-up skipped: ${error instanceof Error ? error.message : String(error)})`);
    }
  }
}

// ---------------------------------------------------------------- recorder

class Recorder {
  lines: TimelineLine[] = [];
  scenes: TimelineScene[] = [];
  marks: TimelineMark[] = [];
  t0 = 0;

  constructor(
    private readonly page: Page,
    private readonly voices: VoiceBank,
    private readonly badgeText: string,
  ) {}

  start(): void {
    this.t0 = Date.now();
  }

  now(): number {
    return Date.now() - this.t0;
  }

  mark(name: string): void {
    this.marks.push({ name, atMs: this.now() });
    log(`  · mark ${name} @ ${(this.now() / 1000).toFixed(1)}s`);
  }

  /** Re-install the overlay after setContent() (which replaces the document). */
  async installOverlay(): Promise<void> {
    await this.page.evaluate(INIT_SCRIPT);
    if (this.badgeText) {
      await this.page.evaluate((text) => {
        (window as unknown as { __demo?: { badge(value: string): void } }).__demo?.badge(text);
      }, this.badgeText);
    }
  }

  private async showSub(role: Role, text: string): Promise<void> {
    await this.page.evaluate(
      (payload) => {
        (window as unknown as { __demo?: { sub(r: string, t: string): void } }).__demo?.sub(
          payload.role,
          payload.text,
        );
      },
      { role, text },
    );
  }

  private async clearSub(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as { __demo?: { clearSub(): void } }).__demo?.clearSub();
    });
  }

  async speak(role: Exclude<Role, "caption">, text: string): Promise<void> {
    const clip = this.voices.get(role, text);
    const startMs = this.now();
    await this.showSub(role, text);
    this.lines.push({
      index: this.lines.length + 1,
      role,
      text,
      audio: clip.file,
      voice: clip.voice,
      durationMs: clip.durationMs,
      startMs,
      endMs: startMs + clip.durationMs,
    });
    log(`  · ${role}: "${text.slice(0, 62)}${text.length > 62 ? "…" : ""}" ${(clip.durationMs / 1000).toFixed(1)}s`);
    await sleep(clip.durationMs);
    await this.clearSub();
  }

  async caption(text: string, ms: number): Promise<void> {
    const startMs = this.now();
    await this.showSub("caption", text);
    this.lines.push({
      index: this.lines.length + 1,
      role: "caption",
      text,
      audio: null,
      voice: null,
      durationMs: ms,
      startMs,
      endMs: startMs + ms,
    });
    log(`  · caption: "${text}" ${(ms / 1000).toFixed(1)}s`);
    await sleep(ms);
    await this.clearSub();
  }

  async scene(id: string, label: string, run: () => Promise<void>): Promise<void> {
    const start = this.now();
    log(`\n▶ ${id} @ ${(start / 1000).toFixed(1)}s — ${label}`);
    await run();
    const end = this.now();
    this.scenes.push({ id, label, startMs: start, endMs: end });
    log(`  ↳ scene ${id}: ${((end - start) / 1000).toFixed(1)}s`);
  }

  /** Hold the current frame until the SPEC timeline endpoint (never rewinds). */
  async padTo(ms: number, capMs = 176_000): Promise<void> {
    const target = Math.min(ms, capMs);
    const left = target - this.now();
    if (left > 0) await sleep(left);
  }
}

// ---------------------------------------------------------------- page helpers

function boardFrame(page: Page) {
  return page.frameLocator("iframe.app-frame").frameLocator("iframe");
}

async function waitForConnected(page: Page): Promise<void> {
  await waitFor(
    async () => (await page.getByTestId("connection-badge").getAttribute("data-state")) === "connected",
    30_000,
    "simulator to connect to the MCP server",
  );
}

async function waitForAgentIdle(page: Page): Promise<void> {
  await waitFor(
    async () => (await page.getByTestId("agent-panel").getAttribute("data-busy")) === "false",
    180_000,
    "the agent turn to finish",
  );
}

async function waitForToolCall(page: Page, name: string, settleOk = false): Promise<void> {
  await waitFor(
    async () => {
      const entry = page.getByTestId("tool-call").filter({ hasText: name }).last();
      if ((await entry.count()) === 0) return false;
      if (!settleOk) return true;
      return (await entry.getAttribute("data-status")) === "ok";
    },
    180_000,
    `${name} in the tool-call log`,
  );
}

async function lastAlexaReply(page: Page): Promise<string> {
  const bubbles = page.locator('[data-testid="utterance"][data-role="alexa"]');
  const count = await bubbles.count();
  if (count === 0) throw new Error("no Alexa bubble on screen");
  // The speaker label is a styled span; innerText upper-cases it ("ALEXA\n…").
  const text = (await bubbles.nth(count - 1).innerText()).replace(/^\s*ALEXA\s*/i, "").trim();
  if (!text) throw new Error("the last Alexa bubble is empty");
  return text;
}

async function say(page: Page, rec: Recorder, text: string): Promise<void> {
  const input = page.getByTestId("agent-input");
  await waitFor(async () => await input.isEnabled(), 30_000, "the agent input to be enabled");
  const spoken = rec.speak("user", text);
  await input.pressSequentially(text, { delay: 12 });
  // Submit when the line is finished, so the server's question card does not
  // pop up in the middle of the sentence (SPEC §3 keeps them in separate beats).
  await spoken;
  await page.getByTestId("agent-send").click();
}

async function tap(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("tap target has no bounding box");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.evaluate((point) => {
    (window as unknown as { __demo?: { cursor(x: number, y: number): void } }).__demo?.cursor(
      point.x,
      point.y,
    );
  }, { x, y });
  await sleep(460);
  await page.evaluate(async () => {
    await (window as unknown as { __demo?: { pulse(): Promise<void> } }).__demo?.pulse();
  });
  await target.click({ timeout: 30_000 });
  // Leave the pointer on the target for a beat, then get it out of the frame.
  await sleep(420);
  await page.evaluate(() => {
    (window as unknown as { __demo?: { hideCursor(): void } }).__demo?.hideCursor();
  });
}

async function waitForBoard(page: Page, minRows = 10): Promise<void> {
  await waitFor(
    async () => {
      const frame = boardFrame(page);
      const rows = frame.locator('[data-testid="row"]');
      return (await rows.count()) >= minRows;
    },
    120_000,
    `the board to render at least ${minRows} rows`,
  );
}

// ---------------------------------------------------------------- stack

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

  private spawnLogged(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, logName: string): ChildProcess {
    const fd = openSync(join(this.options.logDir, logName), "a");
    return spawn(command, args, { cwd, env, stdio: ["ignore", fd, fd] });
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

  async stopServer(): Promise<void> {
    const server = this.server;
    if (!server || server.exitCode !== null) {
      this.server = undefined;
      return;
    }
    const exited = new Promise<void>((resolveExit) => server.once("exit", () => resolveExit()));
    server.kill("SIGTERM");
    await Promise.race([exited, sleep(8_000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
    this.server = undefined;
  }

  async restartServer(): Promise<void> {
    await this.stopServer();
    await this.startServer();
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
    await this.stopServer();
    const sim = this.sim;
    if (sim && sim.exitCode === null) {
      const exited = new Promise<void>((resolveExit) => sim.once("exit", () => resolveExit()));
      sim.kill("SIGTERM");
      await Promise.race([exited, sleep(5_000)]);
      if (sim.exitCode === null) sim.kill("SIGKILL");
    }
    this.sim = undefined;
  }
}

// ---------------------------------------------------------------- main

interface Options {
  out: string;
  mode: "real" | "scripted";
  mcpPort: number;
  simPort: number;
  sandboxPort: number;
}

function parseOptions(argv: string[]): Options {
  const env = { ...readEnvFile(join(REPO, ".env")), ...process.env };
  let out = join(HERE, "out");
  let mode: "real" | "scripted" | "auto" = "auto";
  for (const arg of argv) {
    if (arg === "--scripted") mode = "scripted";
    else if (arg === "--real") mode = "real";
    else if (arg.startsWith("--out=")) out = resolve(arg.slice("--out=".length));
    else if (arg.startsWith("--mode=")) mode = arg.slice("--mode=".length) as "real" | "scripted" | "auto";
  }
  const hasKeys = Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);
  const resolved: "real" | "scripted" = mode === "auto" ? (hasKeys ? "real" : "scripted") : mode;
  if (resolved === "real" && !hasKeys) {
    throw new Error(
      "real mode needs LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in the repository-root .env (or use --scripted)",
    );
  }
  return {
    out,
    mode: resolved,
    mcpPort: Number(env.DEMO_MCP_PORT ?? 3001),
    simPort: Number(env.DEMO_SIM_PORT ?? 8080),
    sandboxPort: Number(env.DEMO_SANDBOX_PORT ?? 8081),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const env = { ...readEnvFile(join(REPO, ".env")), ...process.env };

  const rawDir = join(options.out, "raw");
  const audioDir = join(options.out, "voice");
  const logDir = join(options.out, "logs");
  for (const dir of [rawDir, audioDir, logDir]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }

  const sample = options.mode === "scripted";
  log(`Dinner Tower demo · mode=${options.mode}${sample ? " (SAMPLE — scripted LLM)" : ""}`);
  log(`  ports: mcp ${options.mcpPort} · sim ${options.simPort} · sandbox ${options.sandboxPort}`);

  for (const file of ["board/dist/board.html", "sim/dist/index.html"]) {
    if (!existsSync(join(REPO, file))) {
      throw new Error(`${file} is missing — build the packages first (bash scripts/demo/make.sh does it)`);
    }
  }

  const dataDir = join(options.out, "state");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const dataFile = join(dataDir, "household.json");

  let scriptedLlm: ScriptedLlm | undefined;
  let llm: { baseUrl: string; apiKey: string; model: string };
  if (options.mode === "scripted") {
    scriptedLlm = await startScriptedLlm(0);
    llm = { baseUrl: scriptedLlm.url, apiKey: "scripted-llm-not-a-secret", model: "scripted-llm" };
    log(`  scripted LLM endpoint: ${scriptedLlm.url}`);
  } else {
    llm = {
      baseUrl: env.LLM_BASE_URL!,
      apiKey: env.LLM_API_KEY!,
      model: env.LLM_MODEL!,
    };
    log(`  LLM: ${llm.model} via ${new URL(llm.baseUrl).host}`);
  }

  const stack = new Stack({
    mcpPort: options.mcpPort,
    simPort: options.simPort,
    sandboxPort: options.sandboxPort,
    dataFile,
    llm,
    logDir,
  });

  const voices = new VoiceBank(audioDir);
  // Warm the fixed lines before the recording starts: synthesis takes a moment
  // and dead air at the top of a scene looks like a stall.
  for (const [role, text] of [
    ["narrator", NARRATOR_OPENING],
    ["narrator", NARRATOR_SCHEDULER],
    ["narrator", NARRATOR_MEMORY],
    ["narrator", NARRATOR_BOARD],
    ["narrator", NARRATOR_ARCH],
    ["narrator", NARRATOR_END],
    ["user", SENTENCE],
    ["user", ASK_NEXT],
    ["user", DELAY],
    ["alexa", "Your oven can only hold one temperature at a time, so Sourdough Stuffing would finish early and wait too long. How should I plan it?"],
  ] as Array<[Role, string]>) {
    voices.warm(role, text);
  }

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  try {
    await stack.startServer();
    await stack.startSim();
    log("  stack is up");

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } },
    });
    await context.addInitScript({ content: INIT_SCRIPT });
    page = await context.newPage();

    const badgeText = sample ? "SAMPLE — scripted LLM" : "";
    const rec = new Recorder(page, voices, badgeText);
    const simUrl = `http://127.0.0.1:${options.simPort}/`;

    // ---- title card -------------------------------------------------------
    await page.setContent(titleCard(), { waitUntil: "load" });
    await rec.installOverlay();
    rec.start(); // first painted frame = t0 of the video

    await rec.scene("opening", "Title card, then the kitchen at 1:00 PM", async () => {
      await rec.speak("narrator", NARRATOR_OPENING);
      await page!.goto(simUrl, { waitUntil: "load" });
      await rec.installOverlay();
      await waitForConnected(page!);
      await rec.padTo(TIMELINE_END.opening);
    });

    // ---- one sentence → plan_dinner --------------------------------------
    await rec.scene("asks", "One sentence becomes plan_dinner", async () => {
      await say(page!, rec, SENTENCE);
      await waitForToolCall(page!, "plan_dinner");
      await rec.padTo(TIMELINE_END.asks);
    });

    // ---- the oven question ------------------------------------------------
    await rec.scene("oven-question", "The server asks the oven question mid-call", async () => {
      await waitFor(
        async () => await page!.getByTestId("elicitation-card").isVisible(),
        120_000,
        "the elicitation card",
      );
      const message = (await page!.getByTestId("elicitation-message").innerText()).trim();
      await rec.speak("alexa", message);
      await tap(page!, page!.getByTestId("elicitation-option").filter({ hasText: "Share the oven" }));
      await waitForToolCall(page!, "plan_dinner", true);
      await rec.padTo(TIMELINE_END.ovenQuestion);
    });

    // ---- the board lands --------------------------------------------------
    await rec.scene("plan-lands", "The departure board renders the plan", async () => {
      await waitForAgentIdle(page!);
      await waitForBoard(page!);
      rec.mark("board-plan");
      const reply = await lastAlexaReply(page!);
      await rec.speak("alexa", reply);
      await rec.speak("narrator", NARRATOR_SCHEDULER);
      await rec.padTo(TIMELINE_END.planLands);
    });

    // ---- new session, real restart ---------------------------------------
    await rec.scene("new-session", "Server restarted, new session, 6:20 PM", async () => {
      await rec.caption("Later that afternoon — new session", 2_200);
      await stack.restartServer();
      await stack.setClock("18:20");
      await page!.reload({ waitUntil: "load" });
      await rec.installOverlay();
      await waitForConnected(page!);
      await say(page!, rec, ASK_NEXT);
      await waitForToolCall(page!, "whats_next", true);
      await waitForAgentIdle(page!);
      await waitForBoard(page!);
      rec.mark("new-session");
      const reply = await lastAlexaReply(page!);
      await rec.speak("alexa", reply);
      await rec.speak("narrator", NARRATOR_MEMORY);
      await rec.padTo(TIMELINE_END.newSession);
    });

    // ---- the turkey is late ----------------------------------------------
    await rec.scene("delay", "Report a delay; the whole table replans", async () => {
      await say(page!, rec, DELAY);
      await waitForToolCall(page!, "report_delay", true);
      await waitForAgentIdle(page!);
      const reply = await lastAlexaReply(page!);
      await rec.speak("alexa", reply);
      // The board flashes changed rows for 5 s; wait it out so the frame is clean.
      await sleep(5_400);
      rec.mark("after-delay");
      await rec.padTo(TIMELINE_END.delay);
    });

    // ---- the board is an MCP App -----------------------------------------
    await rec.scene("board-tap", "The board's own +10 MIN button calls the server", async () => {
      const frame = boardFrame(page!);
      const revisionBefore = await frame.locator("#board").getAttribute("data-revision");
      const spoken = rec.speak("narrator", NARRATOR_BOARD);
      await sleep(2_600);
      const button = frame.getByTestId("delay-mashed_potatoes.peel");
      await waitFor(async () => await button.isVisible(), 30_000, "the +10 MIN button on the potatoes row");
      await tap(page!, button);
      // The board calls report_delay itself; the App host does not log it in the
      // page's tool feed, so watch the plan revision the board is rendering.
      await waitFor(
        async () => (await frame.locator("#board").getAttribute("data-revision")) !== revisionBefore,
        30_000,
        "the board to replan after +10 MIN",
      );
      await sleep(1_600);
      rec.mark("board-tap");
      await spoken;
      await rec.padTo(TIMELINE_END.boardTap);
    });

    // ---- architecture ------------------------------------------------------
    await rec.scene("architecture", "How the pieces fit", async () => {
      await page!.setContent(architectureCard(), { waitUntil: "load" });
      await rec.installOverlay();
      await rec.speak("narrator", NARRATOR_ARCH);
      await rec.padTo(TIMELINE_END.architecture);
    });

    // ---- closing -----------------------------------------------------------
    await rec.scene("closing", "Closing card", async () => {
      await page!.setContent(endCard(), { waitUntil: "load" });
      await rec.installOverlay();
      await rec.speak("narrator", NARRATOR_END);
      await rec.padTo(TIMELINE_END.closing);
    });

    const wallMs = rec.now();
    const video = page.video();

    // Save the capture while the browser is still alive: saveAs() after
    // browser.close() fails with "Target page, context or browser has been closed".
    await context.close();
    context = undefined;
    const clip = join(rawDir, "capture.webm");
    if (video) await video.saveAs(clip);
    await browser.close();
    browser = undefined;
    if (!existsSync(clip)) throw new Error("Playwright did not produce a video");

    const timeline: Timeline = {
      version: 1,
      mode: options.mode,
      sample,
      createdAt: new Date().toISOString(),
      resolution: { width: 1280, height: 720 },
      clip,
      wallMs,
      lines: rec.lines,
      scenes: rec.scenes,
      marks: rec.marks,
    };
    writeFileSync(join(options.out, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
    const voiceList = spawnSync("bash", [join(HERE, "voice.sh"), "--list"], { encoding: "utf8" });
    writeFileSync(join(options.out, "voices.txt"), voiceList.stdout ?? "");

    const spokenMs = rec.lines.reduce((sum, line) => sum + (line.audio ? line.durationMs : 0), 0);
    log("");
    log(`recorded ${(wallMs / 1000).toFixed(1)}s of wall clock, ${(spokenMs / 1000).toFixed(1)}s of speech`);
    log(`  clip: ${clip}`);
    log(`  timeline: ${join(options.out, "timeline.json")}`);
  } catch (error) {
    if (page) {
      try {
        mkdirSync(join(options.out, "frames"), { recursive: true });
        await page.screenshot({ path: join(options.out, "frames", "error.png") });
      } catch {
        // the page may already be gone
      }
    }
    throw error;
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    await stack.stop();
    if (scriptedLlm) await scriptedLlm.close();
  }
}

main().catch((error: unknown) => {
  log(`record.ts failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
