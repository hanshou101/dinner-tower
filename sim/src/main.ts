/**
 * Dinner Tower — Echo-style simulator page.
 *
 * Left: an Echo Show style screen (idle clock, the mounted MCP App, or the
 * elicitation card that the server asks for mid-call).
 * Right: the conversation — user and Alexa bubbles, plus the tool capsule
 * under each answer.
 *
 * Demo mode is the default: no version string, no session id, no model name,
 * no raw JSON. Everything developer-facing sits behind `?dev=1`, which opens
 * the Developer panel and restores the tool log.
 *
 * All MCP traffic is real: this page is the MCP client and the MCP Apps host.
 */
import "./styles.css";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import { runAgentTurn } from "./agent/loop";
import { AGENT_DISABLED_MESSAGE, buildSystemPrompt } from "./agent/prompt";
import { createSpeaker } from "./agent/speech";
import { toOpenAiTools } from "./agent/tools";
import type { ChatCompletionResponse, ChatMessage, OpenAiTool } from "./agent/types";
import { AppHost } from "./app-host";
import { buildElicitationCard, selectionToContent, type ElicitCard } from "./elicitation";
import { connectMcp, withHostCall, type ElicitResultLike, type McpConnection } from "./mcp";
import { isPresetAvailable, PRESETS } from "./presets";
import type { CallSource, SimConfig, ToolCallRecord } from "./types";

/** `?dev=1` — the only way to see the Developer panel. */
const DEV = new URLSearchParams(window.location.search).has("dev");

/** Three things a person can actually say, used as the idle-screen guidance. */
const IDLE_EXAMPLES: readonly { label: string; say: string }[] = [
  {
    label: "Plan Thanksgiving for 7 PM",
    say: "Alexa, I'm hosting Thanksgiving at 7. Turkey, stuffing, mashed potatoes, green beans, gravy and rolls.",
  },
  { label: "What's next?", say: "Alexa, what's next?" },
  { label: "Turkey needs 20 more minutes", say: "Alexa, the turkey needs twenty more minutes" },
];

/** How many exchanges the conversation column keeps on screen. */
const VISIBLE_TURNS = 3;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const els = {
  stage: $("stage"),
  badge: $("badge"),
  idle: $("idle"),
  idleTime: $("idle-time"),
  idleChips: $("idle-chips"),
  appView: $("app-view"),
  serveFlash: $("serve-flash"),
  serveFlashTime: $("serve-flash-time"),
  elicitation: $("elicitation"),
  elicitationMessage: $("elicitation-message"),
  elicitationFields: $("elicitation-fields"),
  elicitationCancel: $<HTMLButtonElement>("elicitation-cancel"),
  presets: $("presets"),
  tools: $("tools"),
  toolCount: $("tool-count"),
  feed: $("feed"),
  consoleTool: $<HTMLSelectElement>("console-tool"),
  consoleArgs: $<HTMLTextAreaElement>("console-args"),
  consoleCall: $<HTMLButtonElement>("console-call"),
  consoleError: $("console-error"),
  clockControl: $("clock-control"),
  clockDev: $("clock-dev"),
  clockValue: $("clock-value"),
  clockInput: $<HTMLInputElement>("clock-input"),
  clockSet: $<HTMLButtonElement>("clock-set"),
  lightbar: $("lightbar"),
  agentPanel: $("agent-panel"),
  agentModel: $("agent-model"),
  agentForm: $<HTMLFormElement>("agent-panel"),
  agentInput: $<HTMLInputElement>("agent-input"),
  agentSend: $<HTMLButtonElement>("agent-send"),
  agentHint: $("agent-hint"),
  voiceToggle: $<HTMLInputElement>("voice-toggle"),
};

let connection: McpConnection | undefined;
let host: AppHost | undefined;
let hasPlan = false;
let demoClock: string | undefined;
let busyDepth = 0;
let lastServeAt: string | undefined;
let serveFlashTimer: number | undefined;

let config: SimConfig;
let agentEnabled = false;
let agentSystemPrompt = "";
let agentTools: OpenAiTool[] = [];
let agentHistory: ChatMessage[] = [];
const speaker = createSpeaker();

// ---------------------------------------------------------------- feed

/** Turns started by the person; the last VISIBLE_TURNS of them stay on screen. */
const turns: HTMLElement[] = [];
let currentTurn: HTMLElement | undefined;

function scrollFeed(): void {
  els.feed.scrollTop = els.feed.scrollHeight;
}

function pruneTurns(): void {
  while (turns.length > VISIBLE_TURNS) {
    const oldest = turns.shift();
    if (oldest) oldest.remove();
  }
}

/**
 * Keep whole turns only: a conversation column that cuts a bubble in half reads
 * as a layout bug, so drop the oldest turn while the column still overflows.
 */
function fitFeed(): void {
  while (els.feed.scrollHeight > els.feed.clientHeight + 1 && els.feed.children.length > 1) {
    const oldest = els.feed.firstElementChild as HTMLElement | null;
    if (!oldest) break;
    const index = turns.indexOf(oldest);
    if (index >= 0) turns.splice(index, 1);
    if (currentTurn === oldest) currentTurn = undefined;
    oldest.remove();
  }
}

/** The onboarding line is not part of the conversation once someone speaks. */
function dropPlaceholder(): void {
  const placeholder = els.feed.querySelector<HTMLElement>('.turn[data-placeholder="true"]');
  if (!placeholder) return;
  if (currentTurn === placeholder) currentTurn = undefined;
  placeholder.remove();
}

function startTurn(role: "user" | "alexa" | "system"): HTMLElement {
  const turn = document.createElement("div");
  turn.className = "turn";
  turn.dataset.role = role;
  if (role === "user") dropPlaceholder();
  els.feed.append(turn);
  if (role === "user") {
    turns.push(turn);
    pruneTurns();
    currentTurn = turn;
  } else if (!currentTurn) {
    currentTurn = turn;
  }
  return turn;
}

function turnFor(role: "user" | "alexa" | "system"): HTMLElement {
  return role === "user" ? startTurn("user") : (currentTurn ?? startTurn(role));
}

function addBubble(role: "user" | "alexa" | "system", text: string): HTMLElement | undefined {
  // System cards are developer information: they name tools, endpoints and
  // errors. They only exist in the Developer view.
  if (role === "system" && !DEV) return undefined;

  const turn = turnFor(role);
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.dataset.role = role;
  if (role === "user" || role === "alexa") bubble.dataset.testid = "utterance";
  bubble.textContent = text;
  turn.append(bubble);

  if (role === "alexa") attachCapsules(turn);
  fitFeed();
  scrollFeed();
  return bubble;
}

/**
 * Move the tool calls that produced this answer under the answer itself.
 * Re-appending the row keeps it last, so an elicitation card that arrives
 * mid-call never leaves the capsule stranded above the spoken reply.
 */
function attachCapsules(turn: HTMLElement): void {
  if (DEV) return;
  let row = turn.querySelector<HTMLElement>(".capsule-row");
  const loose = Array.from(turn.querySelectorAll<HTMLElement>(".entry:not(.in-capsules)"));
  if (!row) {
    if (loose.length === 0) return;
    row = document.createElement("div");
    row.className = "capsule-row";
  }
  for (const entry of loose) {
    entry.classList.add("in-capsules");
    row.append(entry);
  }
  turn.append(row);
}

const recordElements = new WeakMap<ToolCallRecord, HTMLElement>();

function summarize(value: unknown, max = 72): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text) text = "{}";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function textFromResult(result: CallToolResult): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter((block): block is { type: "text"; text: string } => block?.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

const logger = {
  begin(name: string, args: Record<string, unknown>, source: CallSource): ToolCallRecord {
    const record: ToolCallRecord = { name, args, source, status: "running" };

    const entry = document.createElement("div");
    entry.className = "entry";
    entry.dataset.status = "running";
    entry.dataset.testid = "tool-call";
    entry.dataset.source = source;
    // Demo mode: a capsule ("⚙ plan_dinner · 6 ms") that ends up under the
    // answer. Developer mode: the full record with the raw JSON below.
    if (!DEV) entry.dataset.compact = "true";

    const head = document.createElement("div");
    head.className = "entry-head";

    const nameEl = document.createElement("span");
    nameEl.className = "entry-name";
    nameEl.textContent = name;

    const sourceEl = document.createElement("span");
    sourceEl.className = "entry-source";
    sourceEl.textContent = source;

    const argsEl = document.createElement("span");
    argsEl.className = "entry-args";
    argsEl.textContent = summarize(args);

    const msEl = document.createElement("span");
    msEl.className = "entry-ms";
    msEl.textContent = "…";

    const statusEl = document.createElement("span");
    statusEl.className = "entry-status";
    statusEl.textContent = "•";

    head.append(nameEl, sourceEl, argsEl, msEl, statusEl);

    const textEl = document.createElement("div");
    textEl.className = "entry-text";
    textEl.hidden = true;

    const detail = document.createElement("details");
    detail.className = "entry-detail";
    const summary = document.createElement("summary");
    summary.textContent = "JSON";
    const pre = document.createElement("pre");
    detail.append(summary, pre);

    entry.append(head, textEl, detail);
    if (!DEV && source === "app") {
      // The board calls the server itself; there is no reply to hang the
      // capsule under, so give it its own row at the bottom of the column.
      const row = document.createElement("div");
      row.className = "capsule-row";
      row.dataset.standalone = "true";
      els.feed.append(row);
      row.append(entry);
      entry.classList.add("in-capsules");
    } else {
      (currentTurn ?? els.feed).append(entry);
    }
    scrollFeed();

    recordElements.set(record, entry);
    return record;
  },

  finish(record: ToolCallRecord, result: unknown, durationMs: number): void {
    const entry = recordElements.get(record);
    record.status = "ok";
    record.durationMs = durationMs;
    record.result = result;
    if (!entry) return;

    const failed = Boolean((result as { isError?: boolean })?.isError);
    entry.dataset.status = failed ? "error" : "ok";
    record.status = failed ? "error" : "ok";
    setEntryOutcome(entry, record, durationMs, failed ? "✗" : "✓");
    if (failed) entry.dataset.testid = "tool-call-error";
  },

  fail(record: ToolCallRecord, error: unknown, durationMs: number): void {
    const entry = recordElements.get(record);
    record.status = "error";
    record.durationMs = durationMs;
    record.error = error instanceof Error ? error.message : String(error);
    if (!entry) return;
    entry.dataset.status = "error";
    setEntryOutcome(entry, record, durationMs, "✗");
    entry.dataset.testid = "tool-call-error";
  },
};

function setEntryOutcome(
  entry: HTMLElement,
  record: ToolCallRecord,
  durationMs: number,
  mark: string,
): void {
  const msEl = entry.querySelector<HTMLElement>(".entry-ms");
  // A call that waits on an elicitation card can run for seconds; "13.6 s"
  // reads better than "13610 ms" and is still the same measurement.
  if (msEl) {
    msEl.textContent =
      durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)} s` : `${Math.round(durationMs)} ms`;
  }
  const statusEl = entry.querySelector<HTMLElement>(".entry-status");
  if (statusEl) statusEl.textContent = mark;

  const textEl = entry.querySelector<HTMLElement>(".entry-text");
  const pre = entry.querySelector<HTMLElement>("pre");
  const resultText = record.result ? textFromResult(record.result as CallToolResult) : "";
  const message =
    record.status === "error"
      ? record.error || resultText || "Tool call failed"
      : resultText;

  if (textEl && message) {
    textEl.textContent = message.length > 400 ? `${message.slice(0, 399)}…` : message;
    textEl.hidden = false;
  }
  if (pre) {
    pre.textContent = JSON.stringify(
      {
        request: { tool: record.name, arguments: record.args, source: record.source },
        ...(record.status === "error"
          ? { error: record.error ?? "(tool returned isError)" }
          : { result: record.result }),
      },
      null,
      2,
    );
  }
  scrollFeed();
}

// ---------------------------------------------------------------- busy indicator

function setBusy(delta: number): void {
  busyDepth = Math.max(0, busyDepth + delta);
  els.lightbar.dataset.active = busyDepth > 0 ? "true" : "false";
}

// ---------------------------------------------------------------- elicitation

function showElicitationCard(card: ElicitCard): Promise<ElicitResultLike> {
  return new Promise<ElicitResultLike>((resolve) => {
    let settled = false;
    const selections: Record<string, string | number | boolean> = {};

    const finish = (result: ElicitResultLike) => {
      if (settled) return;
      settled = true;
      els.elicitation.hidden = true;
      els.elicitationFields.replaceChildren();
      els.elicitationMessage.textContent = "";
      els.elicitationCancel.removeEventListener("click", onCancel);
      resolve(result);
    };

    const onCancel = () => finish({ action: "cancel" });

    els.elicitationMessage.textContent = card.message;
    els.elicitationFields.replaceChildren();

    for (const field of card.fields) {
      const group = document.createElement("div");
      group.className = "elicitation-field";

      const title = document.createElement("div");
      title.className = "elicitation-field-title";
      title.textContent = field.title;
      group.append(title);

      for (const option of field.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "elicitation-option";
        button.dataset.testid = "elicitation-option";
        button.dataset.value = String(option.value);
        button.textContent = option.label;
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          selections[field.name] = option.value;
          for (const sibling of group.querySelectorAll<HTMLButtonElement>(".elicitation-option")) {
            sibling.setAttribute("aria-pressed", sibling === button ? "true" : "false");
          }
          if (card.fields.length === 1) {
            finish({ action: "accept", content: selectionToContent(card, selections) });
          }
        });
        group.append(button);
      }

      els.elicitationFields.append(group);
    }

    if (card.fields.length > 1) {
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "btn";
      confirm.textContent = "Continue";
      confirm.dataset.testid = "elicitation-confirm";
      confirm.addEventListener("click", () => {
        finish({ action: "accept", content: selectionToContent(card, selections) });
      });
      els.elicitationFields.append(confirm);
    }

    els.elicitationCancel.addEventListener("click", onCancel);
    els.elicitation.hidden = false;
  });
}

async function handleElicitation(params: {
  message?: unknown;
  requestedSchema?: unknown;
}): Promise<ElicitResultLike> {
  const card = buildElicitationCard(params);
  addBubble("alexa", card.message);
  setBusy(1);
  try {
    return await showElicitationCard(card);
  } finally {
    setBusy(-1);
  }
}

// ---------------------------------------------------------------- tool calls

function uiResourceUri(result: CallToolResult, tool: Tool | undefined): string | undefined {
  const meta = (result as { _meta?: { ui?: { resourceUri?: unknown } } })._meta;
  const fromResult = meta?.ui?.resourceUri;
  if (typeof fromResult === "string" && fromResult.length > 0) return fromResult;
  return tool ? getToolUiResourceUri(tool) : undefined;
}

async function presentResult(
  tool: Tool | undefined,
  args: Record<string, unknown>,
  result: CallToolResult,
): Promise<void> {
  const text = textFromResult(result);
  if (result.isError) {
    if (text) addBubble("alexa", text);
    return;
  }

  const uri = uiResourceUri(result, tool);
  if (uri && host) {
    try {
      await host.show(uri, args, result);
      els.idle.hidden = true;
      els.appView.hidden = false;
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addBubble("system", `Could not render the App: ${message}`);
    }
  }

  if (text) addBubble("alexa", text);
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  source: CallSource,
  userUtterance?: string,
): Promise<void> {
  if (!connection) return;
  if (userUtterance) addBubble("user", userUtterance);

  const tool = connection.tools.find((candidate) => candidate.name === name);
  const record = logger.begin(name, args, source);
  const startedAt = performance.now();
  setBusy(1);
  try {
    const result = (await withHostCall(() =>
      connection!.client.callTool({ name, arguments: args }),
    )) as CallToolResult;
    logger.finish(record, result, performance.now() - startedAt);
    await presentResult(tool, args, result);
    notePlan(result);
    if (name === "plan_dinner" && !result.isError) hasPlan = true;
  } catch (error) {
    logger.fail(record, error, performance.now() - startedAt);
    addBubble("system", `Tool call failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(-1);
  }
}

// ---------------------------------------------------------------- agent mode

function setAgentBusy(busy: boolean): void {
  els.agentPanel.dataset.busy = busy ? "true" : "false";
  const disabled = busy || !agentEnabled;
  els.agentInput.disabled = disabled;
  els.agentSend.disabled = disabled;
  setBusy(busy ? 1 : -1);
}

function applyAgentConfig(): void {
  agentEnabled = config.agent?.enabled === true;
  els.agentPanel.dataset.enabled = agentEnabled ? "true" : "false";

  if (agentEnabled) {
    // The model name is developer information — only the Developer panel
    // shows it. Demo mode keeps the header clean.
    els.agentModel.textContent = DEV ? (config.agent?.model ?? "") : "";
    els.agentHint.hidden = true;
  } else {
    // Honest state: no endpoint, so the input stays disabled with the reason
    // from SPEC §6.5. Direct mode (the chips) keeps working.
    els.agentModel.textContent = "";
    els.agentInput.placeholder = DEV ? AGENT_DISABLED_MESSAGE : "Say something to Alexa…";
    els.agentHint.textContent = AGENT_DISABLED_MESSAGE;
    els.agentHint.hidden = !DEV;
  }

  els.agentInput.disabled = !agentEnabled;
  els.agentSend.disabled = !agentEnabled;
  els.voiceToggle.disabled = !agentEnabled;
}

async function agentChat(
  messages: ChatMessage[],
  tools: OpenAiTool[],
): Promise<ChatCompletionResponse> {
  const system: ChatMessage = { role: "system", content: agentSystemPrompt };
  // Some providers reject `content: null` on an assistant message that also
  // carries tool_calls; an empty string is accepted everywhere.
  const normalized = messages.map((message) => ({ ...message, content: message.content ?? "" }));
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      messages: [system, ...normalized],
      ...(tools.length > 0 ? { tools } : {}),
    }),
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const message = (data as { error?: string } | undefined)?.error ?? `HTTP ${response.status}`;
    return { error: { message } };
  }
  if (!data || typeof data !== "object") {
    return { error: { message: "empty response from /api/chat" } };
  }
  return data as ChatCompletionResponse;
}

async function mountAgentUi(
  tool: Tool | undefined,
  args: Record<string, unknown>,
  result: CallToolResult,
): Promise<void> {
  if (result.isError) return;
  const uri = uiResourceUri(result, tool);
  if (!uri || !host) return;
  try {
    await host.show(uri, args, result);
    els.idle.hidden = true;
    els.appView.hidden = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addBubble("system", `Could not render the App: ${message}`);
  }
}

async function agentCallTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!connection) throw new Error("MCP is not connected");
  const tool = connection.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`the server has no ${name} tool`);

  const record = logger.begin(name, args, "agent");
  const startedAt = performance.now();
  try {
    const result = (await withHostCall(() =>
      connection!.client.callTool({ name, arguments: args }),
    )) as CallToolResult;
    logger.finish(record, result, performance.now() - startedAt);
    notePlan(result);
    if (name === "plan_dinner" && !result.isError) hasPlan = true;
    await mountAgentUi(tool, args, result);
    return result;
  } catch (error) {
    logger.fail(record, error, performance.now() - startedAt);
    throw error;
  }
}

async function sendAgentTurn(text: string): Promise<void> {
  if (!connection || !agentEnabled) return;
  const utterance = text.trim();
  if (!utterance) return;

  addBubble("user", utterance);
  els.agentInput.value = "";
  setAgentBusy(true);
  try {
    // Elicitation inside a tool call is answered by the person clicking the
    // card, never by the model: the loop simply waits for the call to settle.
    const result = await runAgentTurn(
      { chat: agentChat, callTool: agentCallTool },
      agentHistory,
      agentTools,
      utterance,
    );
    agentHistory = result.history;
    if (result.reply) {
      addBubble("alexa", result.reply);
      speaker.speak(result.reply);
    } else {
      addBubble("system", "The assistant sent no text back.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addBubble("system", `Agent error: ${message}`);
  } finally {
    setAgentBusy(false);
  }
}

function wireAgent(): void {
  els.agentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendAgentTurn(els.agentInput.value);
  });
  els.voiceToggle.addEventListener("change", () => {
    speaker.setEnabled(els.voiceToggle.checked);
  });
  speaker.setEnabled(els.voiceToggle.checked);
}

// ---------------------------------------------------------------- rendering

function renderBadge(): void {
  if (!connection) return;
  const session = connection.sessionId ? connection.sessionId.slice(0, 8) : "(stateless)";
  els.badge.dataset.state = "connected";
  const dot = document.createElement("span");
  dot.className = "dot";
  const text = `${connection.serverName} ${connection.serverVersion} · MCP ${connection.protocolVersion} · Streamable HTTP · session ${session}`;
  els.badge.replaceChildren(dot, document.createTextNode(text));
}

function renderTools(tools: Tool[]): void {
  els.toolCount.textContent = String(tools.length);
  els.tools.replaceChildren();
  els.consoleTool.replaceChildren();

  for (const tool of tools) {
    const row = document.createElement("div");
    row.className = "tool-row";
    row.dataset.testid = "tool-item";
    row.dataset.tool = tool.name;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = tool.name;

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = tool.title ?? tool.description ?? "";

    row.append(name, title);

    if (getToolUiResourceUri(tool)) {
      const badge = document.createElement("span");
      badge.className = "tool-badge";
      badge.textContent = "UI";
      row.append(badge);
    }

    els.tools.append(row);

    const option = document.createElement("option");
    option.value = tool.name;
    option.textContent = tool.name;
    els.consoleTool.append(option);
  }
}

function renderPresets(tools: Tool[]): void {
  const names = tools.map((tool) => tool.name);
  els.presets.replaceChildren();

  for (const preset of PRESETS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.testid = "preset";
    chip.dataset.preset = preset.id;
    chip.textContent = preset.label;

    const available = isPresetAvailable(preset, names);
    chip.disabled = !available;
    if (!available) {
      chip.title = `Server has no ${preset.tool} tool`;
    } else {
      chip.addEventListener("click", () => {
        void runTool(preset.tool, preset.args, "preset", preset.label);
      });
    }
    els.presets.append(chip);
  }
}

function formatClock(hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return hhmm;
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function updateIdleClock(): void {
  const time = demoClock
    ? formatClock(demoClock)
    : new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (!els.idle.hidden) els.idleTime.textContent = time;
  if (!els.clockControl.hidden) els.clockValue.textContent = time;
}

/**
 * The signature moment: the plan came back with a different serve time, so the
 * new time pops once over the stage. The board itself does the row shuffle.
 */
function notePlan(result: CallToolResult): void {
  if (result.isError) return;
  const serveAt = (result as { structuredContent?: { serveAt?: unknown } }).structuredContent?.serveAt;
  if (typeof serveAt !== "string") return;
  if (lastServeAt !== undefined && serveAt !== lastServeAt) flashServe(serveAt);
  lastServeAt = serveAt;
}

function flashServe(hhmm: string): void {
  window.clearTimeout(serveFlashTimer);
  els.serveFlashTime.textContent = formatClock(hhmm);
  els.serveFlash.hidden = true;
  // Restart the pop animation from the top.
  void els.serveFlash.offsetWidth;
  els.serveFlash.hidden = false;
  serveFlashTimer = window.setTimeout(() => {
    els.serveFlash.hidden = true;
  }, 3_200);
}

/** One human sentence instead of a stack trace, on the screen itself. */
function showFatal(message: string): void {
  els.idleTime.textContent = "--:--";
  const hint = els.idle.querySelector<HTMLElement>(".idle-hint");
  if (hint) hint.textContent = message;
  els.idleChips.replaceChildren();
}

/** Idle-screen guidance: three real things a person can say. */
function renderIdleExamples(): void {
  const fallback = ["plan", "next", "delay"];
  els.idleChips.replaceChildren();
  IDLE_EXAMPLES.forEach((example, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "idle-chip";
    chip.dataset.testid = "example-chip";
    chip.textContent = example.label;
    chip.addEventListener("click", () => {
      if (agentEnabled) {
        void sendAgentTurn(example.say);
        return;
      }
      const preset = PRESETS.find((candidate) => candidate.id === fallback[index]);
      if (preset && connection?.tools.some((tool) => tool.name === preset.tool)) {
        void runTool(preset.tool, preset.args, "preset", example.say);
      }
    });
    els.idleChips.append(chip);
  });
}

// ---------------------------------------------------------------- demo clock

async function initDemoClock(): Promise<void> {
  const clockUrl = new URL("/demo/clock", config.mcpUrl).href;
  let current: string | undefined;
  try {
    const response = await fetch(clockUrl, { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const data = (await response.json()) as { time?: unknown };
    current = typeof data.time === "string" ? data.time : undefined;
  } catch {
    return; // no demo clock on this server — the control stays hidden
  }

  els.clockControl.hidden = false;
  els.clockDev.hidden = false;
  if (current) {
    demoClock = current;
    els.clockInput.value = current;
    updateIdleClock();
  }

  els.clockSet.addEventListener("click", async () => {
    const time = els.clockInput.value;
    if (!time) return;
    try {
      const response = await fetch(clockUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ time }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      demoClock = time;
      updateIdleClock();
      if (hasPlan && connection?.tools.some((tool) => tool.name === "whats_next")) {
        await runTool("whats_next", {}, "clock", `Demo clock set to ${time}`);
      }
    } catch (error) {
      addBubble(
        "system",
        `Demo clock update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

// ---------------------------------------------------------------- boot

function wireConsole(): void {
  els.consoleCall.addEventListener("click", () => {
    els.consoleError.hidden = true;
    const name = els.consoleTool.value;
    if (!name) return;
    let args: Record<string, unknown> = {};
    const raw = els.consoleArgs.value.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("arguments must be a JSON object");
        }
        args = parsed as Record<string, unknown>;
      } catch (error) {
        els.consoleError.textContent = `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
        els.consoleError.hidden = false;
        return;
      }
    }
    void runTool(name, args, "console", `${name} ${summarize(args, 48)}`);
  });
}

async function boot(): Promise<void> {
  els.stage.dataset.dev = DEV ? "true" : "false";
  document.getElementById("dev-panel")!.hidden = !DEV;
  renderIdleExamples();
  els.badge.dataset.state = "connecting";
  setInterval(updateIdleClock, 1000);

  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`/api/config returned HTTP ${response.status}`);
    config = (await response.json()) as SimConfig;
  } catch (error) {
    els.badge.dataset.state = "error";
    els.badge.textContent = `Simulator server error · ${error instanceof Error ? error.message : String(error)}`;
    showFatal("Alexa can't reach the kitchen right now.");
    return;
  }

  try {
    connection = await connectMcp({
      mcpUrl: config.mcpUrl,
      logger,
      onElicitation: handleElicitation,
    });
  } catch (error) {
    els.badge.dataset.state = "error";
    els.badge.textContent = `MCP server unreachable · ${config.mcpUrl}`;
    showFatal("Alexa can't reach the kitchen right now.");
    addBubble(
      "system",
      `Could not connect to ${config.mcpUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  applyAgentConfig();
  wireAgent();
  agentTools = toOpenAiTools(connection.tools);
  agentSystemPrompt = buildSystemPrompt({
    skill: config.skill ?? "",
    instructions: connection.instructions,
  });

  // The AppHost needs the connected client for resources and AppBridge forwarding.
  host = new AppHost({
    container: els.appView,
    sandboxUrl: config.sandboxUrl,
    client: connection.client,
  });

  renderBadge();
  renderTools(connection.tools);
  renderPresets(connection.tools);
  wireConsole();
  updateIdleClock();
  await initDemoClock();

  if (connection.instructions) {
    addBubble("system", connection.instructions);
  }

  // An empty column reads as an unfinished screen: give it one honest line so
  // the person knows the right-hand side is a conversation, not a blank panel.
  if (!DEV) {
    const greeting = addBubble(
      "alexa",
      "I'll keep the board in sync. Ask me to plan dinner, or tap an example on the screen.",
    );
    greeting?.closest<HTMLElement>(".turn")?.setAttribute("data-placeholder", "true");
  }
}

void boot();
