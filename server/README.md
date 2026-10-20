# Dinner Tower — MCP server

The kitchen control tower: a self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server that schedules a multi-dish dinner backwards from one serve time, around one oven, four burners and two cooks.

- Protocol: **2025-11-25**, **stateful** Streamable HTTP (`Mcp-Session-Id` per session)
- Transport endpoint: `http://127.0.0.1:3001/mcp`
- Household state: one JSON file, survives a server restart

This package ships the protocol/transport layer, the dish catalog, the kitchen tools, the three planning tools (`plan_dinner`, `whats_next`, `report_delay`), the `ui://` board resource, the `thanksgiving` prompt and persistence.

## Requirements

Node **20.19.x** (the repo is developed on fnm's 20.19.4). No global installs.

## Run it

```bash
npm --prefix server install
npm --prefix server start          # tsx src/index.ts
```

```
[dinner-tower] MCP server listening on http://127.0.0.1:3001/mcp (protocol 2025-11-25)
```

Health check (AC-1):

```bash
curl -s http://localhost:3001/health
# {"ok":true,"name":"dinner-tower","protocolVersion":"2025-11-25"}
```

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address. |
| `PORT` | `3001` | HTTP port. |
| `DT_DATA_FILE` | `server/data/household.json` | Household JSON store (kitchen + active plan). Created on first write; `server/data/` is git-ignored. |
| `DEMO_MODE` | off | `1` freezes the clock so a 3-minute video can walk through an afternoon (SPEC §7 allows this mock). |
| `DEMO_CLOCK_START` | `13:00` | Where the demo clock starts when `DEMO_MODE=1`. |
| `DT_BOARD_HTML` | `board/dist/board.html` | The single-file MCP App served at `ui://dinner-tower/board.html`. A relative path is resolved from the repo root. |

The store is written by writing a temp file next to the target and renaming it into place, so an interrupted write never leaves a half file.

## Demo clock

Only available with `DEMO_MODE=1`; otherwise both routes answer `404`.

```bash
curl -s http://localhost:3001/demo/clock                        # {"time":"13:00","demoClock":true}
curl -s -X POST http://localhost:3001/demo/clock \
  -H 'content-type: application/json' -d '{"time":"18:20"}'     # {"time":"18:20","demoClock":true}
```

## Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `list_dishes` | `{}` | All 10 catalog dishes with `totalMinutes` and `ovenTempsF`. Read-only. |
| `get_kitchen` | `{}` | `{ovens, ovenRacks, burners, cooks, ovenSwitchMinutes}`. Read-only. |
| `update_kitchen` | any subset of the kitchen fields | The full kitchen, persisted. Out-of-range values → tool result with `isError: true`. Idempotent. |
| `plan_dinner` | `{dishes: string[] (1–8 catalog ids), serveAt: "HH:MM", option?: "share-oven" \| "keep-temps"}` | A `PlanView` for the whole dinner; replaces the active plan. |
| `whats_next` | `{}` | The active plan as a `PlanView` with live `done` / `active` / `upcoming` statuses and the next three steps. Read-only; `isError` with `No dinner planned yet…` when nothing is planned. |
| `report_delay` | `{target: stepId \| dishId, minutes: 1–180}` | A replanned `PlanView`: later `serveAt`, `originalServeAt` unchanged, `changes` listing every step that moved, `revision` +1. |

Kitchen ranges: ovens 1–2, ovenRacks 1–3, burners 1–8, cooks 1–4, ovenSwitchMinutes 0–30.

Both `structuredContent` and a short English `text` are returned, so non-UI hosts still get a readable answer.

### Planning tools

`plan_dinner`, `whats_next` and `report_delay` all answer with the same `PlanView` object and all declare it as their `outputSchema`. It is the board's data source: `serveAt` / `originalServeAt` / `now` / `demoClock`, the kitchen, one entry per dish (`readyAt`, `waitMinutes`, `ok`), every step with its `start`, `end`, station (`oven` is 1-based, `ovenTempF`), `usedAlt` and `status`, the next three step ids, the `conflict` (when the oven forces a choice) and the `changes` from the last replan. Times are 24-hour `HH:MM`; the board is what turns them into `7:00 PM`.

The scheduling itself is `scheduler/` — the server only resolves the request, asks the oven question, persists the winner and formats the view.

**The oven question (elicitation).** With one oven, six dishes and recipe temperatures, something waits too long. When two real options exist and the caller did not pass `option`, `plan_dinner` sends a form `elicitation/create` in the middle of the tool call: one `choice` field, two titled options (`share-oven`, `keep-temps`), the labels being the exact copy of SPEC §6.2.3. `accept` uses the chosen plan; `decline`, `cancel` or anything else keeps the recipe temperatures. A host that does not declare form elicitation is never asked — it gets the recipe-temperature plan with `conflict.options` filled in, and can pass `option:"share-oven"` on the next call (the board offers the same two buttons).

**Too late.** If the dinner cannot physically fit before the requested time, `plan_dinner` returns `isError` with the earliest serve time it can manage (`Too late to serve at 7:00 PM. The earliest I can land everything is 9:50 PM.`) and leaves the active plan untouched.

**Board resource.** `ui://dinner-tower/board.html`, MIME type `text/html;profile=mcp-app`, body read from `DT_BOARD_HTML`. If that file is missing the resource answers with an MCP error (`Board UI not built. Run: npm --prefix board run build`) — never placeholder HTML. `npm --prefix board run build` produces it.

**Prompt.** `thanksgiving` returns one user message: *Plan Thanksgiving dinner for 7:00 PM: turkey, stuffing, mashed potatoes, green beans, gravy and rolls.*

## Connect with any MCP client

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector: **Transport = Streamable HTTP**, **URL = `http://localhost:3001/mcp`**, then Connect → List Tools.

### Code (`@modelcontextprotocol/client`)

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client({ name: "my-host", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3001/mcp"));
await client.connect(transport);

console.log(client.getNegotiatedProtocolVersion()); // "2025-11-25"
console.log(transport.sessionId);                   // the Mcp-Session-Id
console.log(client.getInstructions());              // how to use this server
const { tools } = await client.listTools();
const dishes = await client.callTool({ name: "list_dishes", arguments: {} });

await client.close();
```

Every session gets its own `McpServer` instance (so elicitation replies land on the right one) but all sessions share the same household store.

CORS allows `localhost` / `127.0.0.1` / `[::1]` origins and exposes `Mcp-Session-Id`, so a browser-based host (the simulator in `sim/`) can read the session id.

## Tests

```bash
npm --prefix server run typecheck
npm --prefix server test
```

The tests spawn the real server process (`tsx src/index.ts`) on a random port with a temporary `DT_DATA_FILE` and talk to it through `@modelcontextprotocol/client` over Streamable HTTP — no in-process mocks. The restart test stops the process, starts a new one on the same data file and re-reads the kitchen in a brand-new session.

`test/plan.test.ts` drives the planning tools the same way with `DEMO_MODE=1`: it moves `now` with `POST /demo/clock`, asserts every step time against the SPEC §6.2.6 golden tables A–D, answers the oven question from a second client that declares form elicitation (accept / accept / decline), checks the `ui://` resource and the prompt, and replays a plan after a restart. `test/plan-persistence.test.ts` is the restart half on its own.

`bash scripts/verify.sh` at the repo root runs these same checks through `scripts/verify.d/20-server.sh`.
