import { randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { isInitializeRequest } from "@modelcontextprotocol/server";
import cors from "cors";
import type { Request, Response } from "express";
import { loadCatalog } from "./catalog.js";
import { createClock } from "./clock.js";
import { createServer, PROTOCOL_VERSION, SERVER_NAME } from "./mcp.js";
import { Store } from "./store.js";

/**
 * HTTP entry point (SPEC §6.3).
 *
 * Stateful Streamable HTTP: one transport and one McpServer per MCP session,
 * keyed by the `Mcp-Session-Id` the server issues on initialize. All sessions
 * share one household Store. The server is deliberately NOT the stateless
 * shape of the official example — stateful sessions are what make elicitation
 * (T4) and cross-session state (AC-6) possible.
 */

const HOST = process.env.HOST?.trim() || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);

const store = Store.fromEnv();
const clock = createClock();
const dishes = loadCatalog();
const ctx = { store, clock, dishes };

const app = createMcpExpressApp({ host: HOST });

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
app.use(
  cors({
    origin(origin, callback) {
      // Non-browser MCP clients send no Origin at all.
      callback(null, origin === undefined || LOCAL_ORIGIN.test(origin));
    },
    allowedHeaders: [
      "content-type",
      "mcp-session-id",
      "mcp-protocol-version",
      "last-event-id",
      "authorization",
    ],
    // Without this the browser cannot read the session id (SPEC §6.3).
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, name: SERVER_NAME, protocolVersion: PROTOCOL_VERSION });
});

app.get("/demo/clock", (_req: Request, res: Response) => {
  if (!clock.demoClock) {
    res.status(404).json({ error: "demo clock is off (set DEMO_MODE=1)" });
    return;
  }
  res.json({ time: clock.currentTime(), demoClock: true });
});

app.post("/demo/clock", (req: Request, res: Response) => {
  if (!clock.demoClock) {
    res.status(404).json({ error: "demo clock is off (set DEMO_MODE=1)" });
    return;
  }
  const time = (req.body as { time?: unknown } | undefined)?.time;
  if (typeof time !== "string") {
    res.status(400).json({ error: 'body must be {"time":"HH:MM"}' });
    return;
  }
  try {
    clock.setTime(time);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  res.json({ time: clock.currentTime(), demoClock: true });
});

/** Live MCP sessions, keyed by session id. */
const transports = new Map<string, NodeStreamableHTTPServerTransport>();

function forgetSession(sessionId: string | undefined): void {
  if (!sessionId) return;
  transports.delete(sessionId);
}

app.all("/mcp", async (req: Request, res: Response) => {
  const headerSessionId = req.headers["mcp-session-id"];
  const sessionId = typeof headerSessionId === "string" ? headerSessionId : undefined;

  try {
    // Existing session: hand the request to the transport that owns it.
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.handleRequest(req, res, req.body);
        return;
      }
      if (!(req.method === "POST" && isInitializeRequest(req.body))) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
        return;
      }
      // Stale session id plus a fresh initialize: fall through and make a new session.
    }

    if (req.method === "POST" && isInitializeRequest(req.body)) {
      const server = createServer(ctx);
      const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
        },
        onsessionclosed: (closedSessionId) => {
          forgetSession(closedSessionId);
        },
      });
      transport.onclose = () => {
        forgetSession(transport.sessionId);
        void server.close().catch(() => {});
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: Mcp-Session-Id header required" },
      id: null,
    });
  } catch (error) {
    console.error("[dinner-tower] MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const httpServer = app.listen(PORT, HOST, () => {
  const address = httpServer.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : PORT;
  console.log(
    `[dinner-tower] MCP server listening on http://${HOST}:${actualPort}/mcp ` +
      `(protocol ${PROTOCOL_VERSION}${clock.demoClock ? `, demo clock ${clock.currentTime()}` : ""})`,
  );
});

const shutdown = (signal: string): void => {
  console.log(`[dinner-tower] ${signal} — closing ${transports.size} session(s)`);
  for (const transport of transports.values()) {
    void transport.close().catch(() => {});
  }
  transports.clear();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
