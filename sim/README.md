# sim/ — Echo-style simulator (MCP client + MCP Apps host)

A 1280×720 web page that plays the part of an Echo Show for the Dinner Tower
MCP server. It is **not** a mock: the page speaks MCP over Streamable HTTP with
`@modelcontextprotocol/client`, lists and calls tools, hosts `ui://` Apps through
the MCP Apps `AppBridge` in a double-iframe sandbox, and answers server
`elicitation/create` requests with a choice card.

Built in T3 (AME-853). Agent mode (LLM) and speech are T6 and live in
`src/agent/`; `POST /api/chat` is reserved and answers `501` for now.

## Run it

```bash
npm --prefix sim install
npm --prefix sim run build          # builds dist/ (page, sandbox, test App)
MCP_URL=http://localhost:3001/mcp npm --prefix sim start
```

Then open <http://localhost:8080> (the page is 1280×720; do not open it
automatically on a shared machine).

`npm --prefix sim run dev` starts Vite on 5173 with `/api` proxied to the
simulator server on 8080 — handy while editing the page, but the sandbox proxy
still has to come from the simulator server on `SANDBOX_PORT`.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_URL` | `http://localhost:3001/mcp` | Streamable HTTP endpoint the page connects to. |
| `SIM_PORT` | `8080` | Port for the page, `/api/config`, `/api/chat`. |
| `SANDBOX_PORT` | `8081` | Port for the MCP Apps sandbox proxy (must be a different origin). |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | — | Reserved for T6 agent mode. T3 never reads them; `/api/chat` always answers `501 {"error":"agent mode not configured"}`. |

`GET /api/config` returns `{mcpUrl, sandboxUrl}` so the browser knows where to
connect. `sandboxUrl` is built from the hostname the page was loaded with.

## Connecting another MCP server

Point `MCP_URL` at any MCP server that speaks Streamable HTTP. Because the
client runs in the browser, that server must:

- answer CORS for the page's origin (`http://localhost:8080` / `http://127.0.0.1:8080`),
- expose the `Mcp-Session-Id` response header (`Access-Control-Expose-Headers`)
  and allow the `mcp-session-id`, `mcp-protocol-version`, `last-event-id`,
  `content-type`, `authorization` request headers,
- declare `tools` in its capabilities, and
- serve Apps as `resources/read` of a `ui://…` resource with MIME type
  `text/html;profile=mcp-app` if it wants a rendered UI.

What the page adapts to:

- **Quick actions** (`src/presets.ts`) are Dinner Tower tools
  (`plan_dinner`, `whats_next`, `report_delay`, `get_kitchen`). A chip is greyed
  out when the connected server does not expose its tool.
- **Demo clock** (`DEMO CLOCK` in the top bar) appears only when the server
  answers `GET /demo/clock`. Setting it `POST`s `{time:"HH:MM"}` and re-runs
  `whats_next` if a plan exists in this session.
- Any tool is callable from the **tool console** (pick a tool, edit the JSON
  arguments, call).

## What the page shows

- Top bar: `server version · MCP <negotiated version> · Streamable HTTP · session <first 8>`.
- Left: Echo Show style screen (864×540) — idle clock, or the MCP App iframe.
  Under it, a cyan light bar that animates while a call or elicitation is open.
- Right (380 px): quick actions, tool list (`UI` badge for tools with a
  `ui://` resource), conversation bubbles + tool-call log (name, argument
  summary, duration, ✓/✗, expandable JSON), and the tool console.
- Elicitation renders as a card over the screen: message + one large button per
  option. Both the 2025-11-25 titled enum (`oneOf: [{const, title}]`) and the
  legacy `enum` + `enumNames` schema are supported (`src/elicitation.ts`).
- Footer: `Simulated Alexa+ experience · unofficial demo`. No Amazon logos or
  trademarks are used.

## Tests

```bash
npm --prefix sim run test:unit   # vitest: elicitation schema parsing, presets
npm --prefix sim run test:e2e    # playwright, headless; starts fixtures + sim
npm --prefix sim test            # build + unit + e2e
```

The E2E test (`test/e2e/sim.spec.ts`) starts two servers itself:

- `test/fixtures/fixture-server.ts` — **test-only** MCP server: stateful
  Streamable HTTP with CORS-exposed `Mcp-Session-Id`, a UI tool
  (`show_echo` → `ui://fixture/app.html`), a plain tool (`bump_counter`), and
  elicitation tools using both schemas (`ask_choice`, `ask_enum`).
  Product code must not import it.
- `server.ts` — this simulator, with `MCP_URL` pointed at the fixture.

Screenshots are written to `../proof/T3-*.png`.

## Files

```text
server.ts             two Express apps: page + API (SIM_PORT), sandbox proxy (SANDBOX_PORT)
sandbox.html          sandbox proxy page shell (served on SANDBOX_PORT)
src/sandbox.ts        relay between host and the inner App iframe
src/main.ts           page controller: feed, presets, console, clock, elicitation card
src/mcp.ts            MCP client (capabilities, elicitation handler, App tool-call logging)
src/app-host.ts       MCP Apps host: resources/read → sandbox → AppBridge → sendToolInput/Result
src/elicitation.ts    schema → card model (oneOf and enum), pure and unit-tested
src/presets.ts        direct-mode quick actions against the Dinner Tower tool names
src/styles.css        1280×720 layout
test/fixtures/        test-only MCP server + its single-file App
test/unit/            vitest specs
test/e2e/             Playwright spec (headless)
```

## Attribution

The sandbox architecture, the sandbox relay, and the AppBridge host sequence
are adapted from the official MCP Apps examples
[`modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps)
(`examples/basic-host/serve.ts`, `sandbox.html`, `src/sandbox.ts`,
`src/implementation.ts`), MIT licensed. The CSP header builder is copied from
`serve.ts`. Each adapted file says so at the top.

## Limits

- No LLM, no speech: `/api/chat` is a reserved route (T6).
- No voice input; the demo drives tools with chips and the console.
- Only Streamable HTTP is used for the MCP connection (no SSE fallback).
