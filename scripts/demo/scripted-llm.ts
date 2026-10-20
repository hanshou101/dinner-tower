/**
 * A scripted, OpenAI-compatible `chat/completions` endpoint for the demo
 * pipeline's self-test (SPEC §3, §6.7).
 *
 * It replays the demo script: the first turn calls `plan_dinner` with the
 * golden menu, the second calls `whats_next`, the third calls `report_delay`,
 * and each turn answers with the line the script says next. The simulator's
 * `/api/chat` proxy cannot tell it apart from a real provider — same request
 * shape, same bearer token, same JSON response — so the recording exercises the
 * real agent loop, the real MCP server and the real board.
 *
 * Anything recorded this way carries a burned-in "SAMPLE — scripted LLM" badge.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface ScriptedTurn {
  match: RegExp;
  tool: string;
  args: Record<string, unknown>;
  reply: string;
}

export const GOLDEN_MENU = [
  "turkey",
  "stuffing",
  "mashed_potatoes",
  "green_beans",
  "gravy",
  "rolls",
];

/** The three turns of the demo, in order (SPEC §3). */
export const SCRIPTED_TURNS: ScriptedTurn[] = [
  {
    match: /hosting thanksgiving/i,
    tool: "plan_dinner",
    args: { dishes: GOLDEN_MENU, serveAt: "19:00" },
    reply: "Done — everything lands at 7:00. First up at 3:10: season and truss the turkey.",
  },
  {
    match: /what'?s next/i,
    tool: "whats_next",
    args: {},
    reply:
      "The turkey comes out at 6:30. Next: trim the green beans at 6:27 and boil the potatoes at 6:30.",
  },
  {
    match: /twenty more minutes|20 more minutes/i,
    tool: "report_delay",
    args: { target: "turkey", minutes: 20 },
    reply:
      "No problem. Dinner now lands at 7:20 — I pushed the potatoes, green beans, gravy and rolls, and the stuffing can hold until then.",
  },
];

interface ChatMessage {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
}

interface ChatRequest {
  messages?: ChatMessage[];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

/** Which turn the conversation is on, and whether its tool already ran. */
export function decide(messages: ChatMessage[]): { turn: ScriptedTurn; callTool: boolean } {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  const userText = lastUser >= 0 ? textOf(messages[lastUser]?.content) : "";
  const afterUser = lastUser >= 0 ? messages.slice(lastUser + 1) : messages;
  const callTool = !afterUser.some((message) => message.role === "tool");
  const turn = SCRIPTED_TURNS.find((candidate) => candidate.match.test(userText)) ?? SCRIPTED_TURNS[0]!;
  return { turn, callTool };
}

function completion(model: string, message: Record<string, unknown>): string {
  return JSON.stringify({
    id: "chatcmpl-scripted",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

export interface ScriptedLlm {
  url: string;
  port: number;
  requests: ChatRequest[];
  close(): Promise<void>;
}

/** Starts the endpoint on 127.0.0.1:<port> (0 → ephemeral) and resolves once listening. */
export async function startScriptedLlm(port = 0, delayMs = 260): Promise<ScriptedLlm> {
  const requests: ChatRequest[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body: ChatRequest = {};
      try {
        body = JSON.parse(raw) as ChatRequest;
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      requests.push(body);
      const requested = (body as { model?: unknown }).model;
      const model = typeof requested === "string" ? requested : "scripted-llm";
      const { turn, callTool } = decide(Array.isArray(body.messages) ? body.messages : []);

      const message = callTool
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: `call_${turn.tool}`,
                type: "function",
                function: { name: turn.tool, arguments: JSON.stringify(turn.args) },
              },
            ],
          }
        : { role: "assistant", content: turn.reply };

      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(completion(model, message));
      }, delayMs);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://127.0.0.1:${actualPort}/v1`,
    port: actualPort,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
