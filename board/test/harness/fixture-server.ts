#!/usr/bin/env npx tsx
/**
 * TEST-ONLY MCP server for the T5 board E2E run.
 *
 * Product code must not import this file. It exists so the board can be driven
 * by a real host against a real MCP server, with the PlanView payloads coming
 * from the hand-written fixtures in `board/test/fixtures/` (SPEC §6.2.6 tables
 * B/C and §6.3 shape) instead of from the T4 planning tools, which this ticket
 * does not own.
 *
 *   show_plan    → one fixture, exposed as a UI tool on ui://dinner-tower/board.html
 *   report_delay → returns the table C fixture (9 changed steps) and records the call
 *   plan_dinner  → returns the table B fixture and records the call
 *
 * Every tools/call that reaches the server is also recorded and served at
 * GET /__calls so a test can prove the board's button really hit the server.
 */
import cors from "cors";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const BOARD_HTML = resolve(here, "..", "..", "dist", "board.html");
const FIXTURES = resolve(here, "..", "fixtures");
const HARNESS_DIST = resolve(here, "dist");

const PORT = Number.parseInt(process.env.HARNESS_PORT ?? "3301", 10);
const HOST = "127.0.0.1";
const UI_URI = "ui://dinner-tower/board.html";

type FixtureName = "plan-1300" | "plan-1820" | "conflict" | "delayed";
const FIXTURE_NAMES: FixtureName[] = ["plan-1300", "plan-1820", "conflict", "delayed"];

interface RecordedCall {
  name: string;
  arguments: Record<string, unknown>;
}

const calls: RecordedCall[] = [];
const sessions = new Map<string, { server: McpServer; transport: NodeStreamableHTTPServerTransport }>();

function readFixture(name: FixtureName): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as unknown;
}

function readBoardHtml(): string {
  if (!existsSync(BOARD_HTML)) {
    throw new Error(`Board UI not built: ${BOARD_HTML}. Run: npm --prefix board run build`);
  }
  return readFileSync(BOARD_HTML, "utf8");
}

function createServer(): McpServer {
  const server = new McpServer({ name: "dinner-tower-board-fixture", version: "0.1.0" });

  registerAppTool(
    server,
    "show_plan",
    {
      title: "Show a plan on the board",
      description: "Render one of the hand-written PlanView fixtures on the departure board.",
      inputSchema: z.object({
        fixture: z.enum(FIXTURE_NAMES as [FixtureName, ...FixtureName[]]),
      }),
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ fixture }) => {
      calls.push({ name: "show_plan", arguments: { fixture } });
      return {
        content: [{ type: "text", text: `Showing ${fixture} on the departure board.` }],
        structuredContent: readFixture(fixture) as Record<string, unknown>,
      };
    },
  );

  registerAppTool(
    server,
    "report_delay",
    {
      title: "Report a delay",
      description: "Push a step back by N minutes and return the re-planned board.",
      inputSchema: z.object({ target: z.string(), minutes: z.number().int() }),
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async (args) => {
      calls.push({ name: "report_delay", arguments: { ...args } });
      return {
        content: [{ type: "text", text: `Delayed ${args.target} by ${args.minutes} minutes.` }],
        structuredContent: readFixture("delayed") as Record<string, unknown>,
      };
    },
  );

  registerAppTool(
    server,
    "plan_dinner",
    {
      title: "Plan dinner",
      description: "Plan the dinner again with one of the oven options.",
      inputSchema: z.object({
        dishes: z.array(z.string()),
        serveAt: z.string(),
        option: z.enum(["share-oven", "keep-temps"]).optional(),
      }),
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async (args) => {
      calls.push({ name: "plan_dinner", arguments: { ...args } });
      return {
        content: [{ type: "text", text: `Planned dinner with ${args.option ?? "default"} option.` }],
        structuredContent: readFixture("plan-1300") as Record<string, unknown>,
      };
    },
  );

  registerAppResource(
    server,
    "Dinner Tower board",
    UI_URI,
    { description: "Departure board MCP App for Dinner Tower." },
    async () => ({
      contents: [{ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: readBoardHtml() }],
    }),
  );

  return server;
}

const app = createMcpExpressApp({ host: HOST });

app.use(
  cors({
    origin: true,
    allowedHeaders: ["content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id", "authorization"],
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "dinner-tower-board-fixture", sessions: sessions.size });
});

app.get("/__calls", (_req, res) => {
  res.json(calls);
});

app.post("/__reset", (_req, res) => {
  calls.length = 0;
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  // The harness page is built into one self-contained file as well.
  res.sendFile(join(HARNESS_DIST, "harness.html"));
});

app.all("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  const existing = sessionId ? sessions.get(sessionId) : undefined;

  if (existing) {
    await existing.transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.method !== "POST") {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: no valid session id" },
      id: null,
    });
    return;
  }

  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport });
      console.log(`[harness] session ${id} initialized`);
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
      void server.close().catch(() => undefined);
      console.log(`[harness] session ${id} closed`);
    },
  });
  transport.onerror = (error) => console.error("[harness] transport error:", error);

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`Board fixture server: http://${HOST}:${PORT}/ (MCP at /mcp)`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[harness] ${signal}, closing ${sessions.size} session(s)`);
  for (const [id, session] of sessions) {
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
    sessions.delete(id);
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
