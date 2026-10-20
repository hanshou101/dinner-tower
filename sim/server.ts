#!/usr/bin/env npx tsx
/**
 * Simulator server.
 *
 * Two origins on purpose:
 *  - SIM_PORT (default 8080): the simulator page, `/api/config`, and
 *    `/api/chat` (agent mode — the only place the LLM key lives).
 *  - SANDBOX_PORT (default 8081): the MCP Apps sandbox proxy page, served with
 *    a CSP header derived from the App's `_meta.ui.csp`.
 *
 * Adapted from modelcontextprotocol/ext-apps `examples/basic-host/serve.ts`
 * (MIT, https://github.com/modelcontextprotocol/ext-apps): the two-origin
 * split, CSP header builder, and sandbox-only 404 handler.
 */
import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps/app-bridge";
import { createChatHandler, llmSettings } from "./src/agent/chat-handler";
import { readSkillBody } from "./src/agent/skill";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST = join(__dirname, "dist");

const SIM_PORT = Number.parseInt(process.env.SIM_PORT ?? "8080", 10);
const SANDBOX_PORT = Number.parseInt(process.env.SANDBOX_PORT ?? "8081", 10);
const MCP_URL = process.env.MCP_URL ?? "http://localhost:3001/mcp";
const HOST = "127.0.0.1";

// ---------------------------------------------------------------- host app

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/config", (req, res) => {
  const hostname = req.hostname;
  const settings = llmSettings(process.env);
  res.json({
    mcpUrl: MCP_URL,
    sandboxUrl: `http://${hostname}:${SANDBOX_PORT}/sandbox.html`,
    // Agent mode (T6): the page composes the system prompt from this skill
    // body + the MCP server instructions. Empty when the file is missing.
    agent: settings
      ? { enabled: true, model: settings.model }
      : { enabled: false },
    skill: readSkillBody(),
  });
});

// Agent mode: the browser loop talks to the LLM only through this route, so
// the key stays server-side (SPEC §6.5). 503 when the endpoint is not set.
app.post("/api/chat", createChatHandler());

app.use(express.static(DIST));

app.get("/", (_req, res) => {
  const index = join(DIST, "index.html");
  if (!existsSync(index)) {
    res.status(503).send("Simulator is not built. Run: npm --prefix sim run build");
    return;
  }
  res.sendFile(index);
});

// ---------------------------------------------------------------- sandbox app

function sanitizeCspDomains(domains?: string[]): string[] {
  if (!domains) return [];
  return domains.filter((d) => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

function buildCspHeader(csp?: McpUiResourceCsp): string {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(" ") || null;
  const baseUriDomains = sanitizeCspDomains(csp?.baseUriDomains).join(" ") || null;

  const directives = [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ];

  return directives.join("; ");
}

const sandboxApp = express();
sandboxApp.use(cors());

// The sandbox page's own JS/CSS bundle. Nothing else from dist is exposed here.
sandboxApp.use("/assets", express.static(join(DIST, "assets")));

sandboxApp.get(["/", "/sandbox.html"], (req, res) => {
  let cspConfig: McpUiResourceCsp | undefined;
  if (typeof req.query.csp === "string") {
    try {
      cspConfig = JSON.parse(req.query.csp) as McpUiResourceCsp;
    } catch (error) {
      console.warn("[sandbox] invalid csp query param:", error);
    }
  }

  res.setHeader("Content-Security-Policy", buildCspHeader(cspConfig));
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const file = join(DIST, "sandbox.html");
  if (!existsSync(file)) {
    res.status(503).send("Simulator is not built. Run: npm --prefix sim run build");
    return;
  }
  res.sendFile(file);
});

sandboxApp.use((_req, res) => {
  res.status(404).send("Only sandbox.html is served on this port");
});

// ---------------------------------------------------------------- start

if (!existsSync(join(DIST, "index.html"))) {
  console.warn(`[sim] ${DIST}/index.html is missing — run: npm --prefix sim run build`);
}

app.listen(SIM_PORT, HOST, () => {
  console.log(`Simulator: http://${HOST}:${SIM_PORT}`);
  console.log(`MCP URL:   ${MCP_URL}`);
});

sandboxApp.listen(SANDBOX_PORT, HOST, () => {
  console.log(`Sandbox:   http://${HOST}:${SANDBOX_PORT}/sandbox.html`);
});
