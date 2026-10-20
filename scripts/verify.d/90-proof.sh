# T7（AME-857）举证：AC-1..AC-7 的独立探针。
#
# 不看任何人的总结：自己 spawn 一个真的 `tsx src/index.ts` 进程（DEMO_MODE=1、临时
# DT_DATA_FILE），用 @modelcontextprotocol/client 走 Streamable HTTP，逐条断言 SPEC §5
# 的 AC-1～AC-7 与 §6.2.6 表 A/B/C/D；AC-6 真的 SIGTERM 结束进程再用同一个数据文件重启。
# 需要 server/node_modules 与构建好的 board/dist/board.html（AC-2 要读 ui:// 资源），
# 所以整条用 need_local：CI 模式跳过。
_t7_probe() {
  local code port
  # 现取一个空闲端口，避免与别的本地服务撞车
  port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  code=$(cat <<'PROBE_JS'
// T7 举证：独立探针。不读任何人的总结，直接对真实 dinner-tower server 的
// Streamable HTTP 端点与 /health 做断言，逐条对 SPEC §5 的 AC-1..AC-7、§6.2.6 黄金值。
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const SERVER_DIR = resolve(".");
const REPO = resolve("..");
const PORT = Number(process.env.PROBE_PORT || 3411);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const MCP_URL = `${URL_BASE}/mcp`;
const BOARD = join(REPO, "board/dist/board.html");
const DATA = join(mkdtempSync(join(tmpdir(), "t7-probe-")), "household.json");

let failures = 0;
const pass = (name, detail = "") => console.log(`PASS  ${name}${detail ? "  [" + detail + "]" : ""}`);
const fail = (name, detail = "") => { failures += 1; console.log(`FAIL  ${name}${detail ? "  [" + detail + "]" : ""}`); };
const info = (msg) => console.log(`      ${msg}`);
function check(name, fn) { try { fn(); pass(name); } catch (e) { fail(name, e.message); } }

const GOLDEN = ["turkey", "stuffing", "mashed_potatoes", "green_beans", "gravy", "rolls"];

// SPEC §6.2.6 表 A / B / C / D（start,end）
const TABLE_A = {
  "turkey.prep": ["15:10", "15:30"], "turkey.roast": ["15:30", "18:30"], "turkey.rest": ["18:30", "19:00"],
  "stuffing.prep": ["14:20", "14:35"], "stuffing.bake": ["14:35", "15:20"],
  "mashed_potatoes.peel": ["18:15", "18:30"], "mashed_potatoes.boil": ["18:30", "18:50"], "mashed_potatoes.mash": ["18:50", "19:00"],
  "green_beans.trim": ["18:27", "18:37"], "green_beans.blanch": ["18:37", "18:42"], "green_beans.saute": ["18:42", "18:50"],
  "gravy.make": ["18:45", "19:00"], "rolls.bake": ["18:48", "19:00"],
};
const TABLE_B = {
  "turkey.prep": ["15:10", "15:30"], "turkey.roast": ["15:30", "18:30"], "turkey.rest": ["18:30", "19:00"],
  "stuffing.prep": ["17:50", "18:05"], "stuffing.bake": ["18:05", "19:00"],
  "mashed_potatoes.peel": ["18:15", "18:30"], "mashed_potatoes.boil": ["18:30", "18:50"], "mashed_potatoes.mash": ["18:50", "19:00"],
  "green_beans.trim": ["18:27", "18:37"], "green_beans.blanch": ["18:37", "18:42"], "green_beans.saute": ["18:42", "18:50"],
  "gravy.make": ["18:45", "19:00"], "rolls.bake": ["18:42", "19:00"],
};
const TABLE_C = {
  "turkey.prep": ["15:10", "15:30"], "turkey.roast": ["15:30", "18:50"], "turkey.rest": ["18:50", "19:20"],
  "stuffing.prep": ["17:50", "18:05"], "stuffing.bake": ["18:05", "19:00"],
  "mashed_potatoes.peel": ["18:15", "18:30"], "mashed_potatoes.boil": ["18:50", "19:10"], "mashed_potatoes.mash": ["19:10", "19:20"],
  "green_beans.trim": ["18:47", "18:57"], "green_beans.blanch": ["18:57", "19:02"], "green_beans.saute": ["19:02", "19:10"],
  "gravy.make": ["19:05", "19:20"], "rolls.bake": ["19:02", "19:20"],
};
const TABLE_D = {
  "turkey.prep": ["15:10", "15:30"], "turkey.roast": ["15:30", "18:30"], "turkey.rest": ["18:30", "19:15"],
  "stuffing.prep": ["17:50", "18:05"], "stuffing.bake": ["18:05", "19:00"],
  "mashed_potatoes.peel": ["18:15", "18:30"], "mashed_potatoes.boil": ["18:30", "18:50"], "mashed_potatoes.mash": ["19:05", "19:15"],
  "green_beans.trim": ["18:27", "18:37"], "green_beans.blanch": ["18:37", "18:42"], "green_beans.saute": ["18:57", "19:05"],
  "gravy.make": ["19:00", "19:15"], "rolls.bake": ["18:57", "19:15"],
};
const HOLDS = { turkey: 30, stuffing: 20, mashed_potatoes: 30, green_beans: 10, gravy: 15, rolls: 15 };
const DISH_STEPS = {
  turkey: ["turkey.prep", "turkey.roast", "turkey.rest"],
  stuffing: ["stuffing.prep", "stuffing.bake"],
  mashed_potatoes: ["mashed_potatoes.peel", "mashed_potatoes.boil", "mashed_potatoes.mash"],
  green_beans: ["green_beans.trim", "green_beans.blanch", "green_beans.saute"],
  gravy: ["gravy.make"],
  rolls: ["rolls.bake"],
};
const AFTER = [
  ["turkey.roast", "turkey.prep"], ["turkey.rest", "turkey.roast"], ["stuffing.bake", "stuffing.prep"],
  ["mashed_potatoes.boil", "mashed_potatoes.peel"], ["mashed_potatoes.mash", "mashed_potatoes.boil"],
  ["green_beans.blanch", "green_beans.trim"], ["green_beans.saute", "green_beans.blanch"],
  ["gravy.make", "turkey.roast"], ["rolls.bake", null],
];
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const stepsMap = (plan) => Object.fromEntries(plan.steps.map((s) => [s.stepId, [s.start, s.end]]));

let server;
function startServer() {
  server = spawn("node_modules/.bin/tsx", ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT), DEMO_MODE: "1", DEMO_CLOCK_START: "13:00", DT_DATA_FILE: DATA, DT_BOARD_HTML: BOARD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (d) => process.env.PROBE_VERBOSE && process.stderr.write(d));
  return server;
}
async function waitHealth(ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`${URL_BASE}/health`); if (r.ok) return r; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become healthy");
}
async function stopServer() {
  if (!server) return;
  const dead = new Promise((r) => server.once("exit", r));
  server.kill("SIGTERM");
  await Promise.race([dead, new Promise((r) => setTimeout(r, 8000))]);
  server = null;
}
async function connect(opts = {}) {
  const client = new Client({ name: "t7-proof", version: "1.0.0" }, opts.capabilities ? { capabilities: opts.capabilities } : undefined);
  if (opts.onElicit) client.setRequestHandler("elicitation/create", opts.onElicit);
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  return { client, transport };
}
const call = async (c, name, args) => {
  const res = await c.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name} isError: ${res.content?.[0]?.text}`);
  if (!res.structuredContent) throw new Error(`${name} returned no structuredContent`);
  return res.structuredContent;
};
const setClock = async (hhmm) => {
  const r = await fetch(`${URL_BASE}/demo/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ time: hhmm }) });
  if (!r.ok) throw new Error("clock set failed " + r.status);
};
function expectSteps(label, plan, table) {
  const got = stepsMap(plan);
  const diffs = [];
  for (const [id, [s, e]] of Object.entries(table)) {
    const g = got[id];
    if (!g) diffs.push(`${id}: missing`);
    else if (g[0] !== s || g[1] !== e) diffs.push(`${id}: got ${g[0]}-${g[1]} want ${s}-${e}`);
  }
  if (diffs.length) fail(label, diffs.slice(0, 6).join("; "));
  else pass(label, `${Object.keys(table).length} steps exact`);
  return diffs.length === 0;
}
function validatePlan(label, plan, kitchen) {
  const mins = plan.steps.map((s) => ({ ...s, a: toMin(s.start), b: toMin(s.end) }));
  const problems = [];
  const at = (res, m) => mins.filter((s) => s.uses.includes(res) && s.a <= m && m < s.b);
  for (let m = 0; m < 1440; m++) {
    if (at("hands", m).length > kitchen.cooks) problems.push(`hands>${kitchen.cooks} @${m}`);
    if (at("burner", m).length > kitchen.burners) problems.push(`burners>${kitchen.burners} @${m}`);
    const perOven = {};
    for (const s of at("oven", m)) { perOven[s.oven] = (perOven[s.oven] || []); perOven[s.oven].push(s.ovenTempF); }
  }
  // oven racks + one temperature per minute
  const ovens = [...new Set(mins.filter((s) => s.uses.includes("oven")).map((s) => s.oven))];
  for (const o of ovens) {
    for (let m = 0; m < 1440; m++) {
      const at_ = mins.filter((s) => s.uses.includes("oven") && s.oven === o && s.a <= m && m < s.b);
      if (at_.length > kitchen.ovenRacks) problems.push(`oven${o} racks @${m}=${at_.length}`);
      const temps = new Set(at_.map((s) => s.ovenTempF));
      if (temps.size > 1) problems.push(`oven${o} two temps @${m}: ${[...temps]}`);
    }
    const blocks = mins.filter((s) => s.uses.includes("oven") && s.oven === o).sort((x, y) => x.a - y.a);
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].ovenTempF !== blocks[i - 1].ovenTempF && blocks[i].a - blocks[i - 1].b < kitchen.ovenSwitchMinutes) {
        problems.push(`oven${o} temp switch gap ${blocks[i].a - blocks[i - 1].b} < ${kitchen.ovenSwitchMinutes}`);
      }
    }
  }
  for (const [child, parent] of AFTER) {
    if (!parent) continue;
    if (mins.find((s) => s.stepId === child).a < mins.find((s) => s.stepId === parent).b) problems.push(`${child} before ${parent} ends`);
  }
  const serve = toMin(plan.serveAt);
  for (const [dish, ids] of Object.entries(DISH_STEPS)) {
    const last = mins.find((s) => s.stepId === ids[ids.length - 1]);
    if (last.b > serve || serve - last.b > HOLDS[dish]) problems.push(`${dish} ready ${last.end} outside hold window`);
  }
  if (problems.length) fail(label, problems.slice(0, 6).join("; "));
  else pass(label, "hands/burners/racks/temps/deps/hold-window ok");
  return problems.length === 0;
}

// ---------------------------------------------------------------- run
startServer();
await waitHealth();
console.log("      server up on " + URL_BASE + " (demo clock 13:00, data " + DATA + ", board " + (existsSync(BOARD) ? "built" : "MISSING") + ")");

const { client, transport } = await connect();

// ---- AC-1
{
  const health = await (await fetch(`${URL_BASE}/health`)).json();
  check("AC-1 /health body", () => {
    const want = { ok: true, name: "dinner-tower", protocolVersion: "2025-11-25" };
    if (JSON.stringify(health) !== JSON.stringify(want)) throw new Error(JSON.stringify(health));
  });
  check("AC-1 initialize protocolVersion === 2025-11-25", () => {
    const v = client.getNegotiatedProtocolVersion();
    if (v !== "2025-11-25") throw new Error(String(v));
  });
  check("AC-1 Mcp-Session-Id present (stateful)", () => {
    if (!transport.sessionId) throw new Error("no sessionId");
    info("session " + transport.sessionId);
  });
  const tools1 = await client.listTools();
  check("AC-1 follow-up request on same session", () => { if (!tools1.tools.length) throw new Error("empty tools"); });
}

// ---- AC-2
{
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check("AC-2 tools/list is exactly the 6 SPEC tools", () => {
    const want = ["get_kitchen", "list_dishes", "plan_dinner", "report_delay", "update_kitchen", "whats_next"];
    if (JSON.stringify(names) !== JSON.stringify(want)) throw new Error(names.join(","));
  });
  const missing = tools.filter((t) => !t.title || !t.description || !t.inputSchema).map((t) => t.name);
  check("AC-2 every tool has title/description/inputSchema", () => { if (missing.length) throw new Error(missing.join(",")); });
  for (const t of ["plan_dinner", "whats_next", "report_delay"]) {
    const tool = tools.find((x) => x.name === t);
    check(`AC-2 ${t} has outputSchema + _meta.ui.resourceUri`, () => {
      if (!tool.outputSchema) throw new Error("no outputSchema");
      if (tool._meta?.ui?.resourceUri !== "ui://dinner-tower/board.html") throw new Error(JSON.stringify(tool._meta));
    });
  }
  for (const t of ["list_dishes", "get_kitchen", "whats_next"]) {
    const tool = tools.find((x) => x.name === t);
    check(`AC-2 ${t} annotations.readOnlyHint === true`, () => { if (tool.annotations?.readOnlyHint !== true) throw new Error(JSON.stringify(tool.annotations)); });
  }
  const res = await client.readResource({ uri: "ui://dinner-tower/board.html" });
  check("AC-2 resources/read board.html → ext-apps MIME + HTML", () => {
    const c = res.contents[0];
    if (c.mimeType !== "text/html;profile=mcp-app") throw new Error("mime=" + c.mimeType);
    const text = c.text ?? "";
    if (!text.includes("<html")) throw new Error("no <html>, bytes=" + text.length);
    info("board bytes=" + text.length);
  });
  const prompts = await client.listPrompts();
  check("AC-2 prompts/list contains thanksgiving", () => { if (!prompts.prompts.some((p) => p.name === "thanksgiving")) throw new Error(JSON.stringify(prompts.prompts.map((p) => p.name))); });
  check("AC-2 initialize instructions non-empty", () => { const i = client.getInstructions(); if (!i || !i.trim()) throw new Error("empty"); });
}

// ---- AC-4 (host without elicitation)
let planB;
{
  const r = await call(client, "plan_dinner", { dishes: GOLDEN, serveAt: "19:00" });
  check("AC-4 no-elicitation host → option keep-temps + conflict.options both ids", () => {
    if (r.option !== "keep-temps") throw new Error("option=" + r.option);
    const ids = (r.conflict?.options || []).map((o) => o.id).join(",");
    if (ids !== "share-oven,keep-temps") throw new Error("options=" + ids);
  });
  const wait = r.conflict?.waits?.find((w) => w.dishId === "stuffing");
  check("AC-4 primary has stuffing wait 220 min", () => { if (!wait || wait.waitMinutes !== 220) throw new Error(JSON.stringify(r.conflict?.waits)); });
  expectSteps("AC-4 primary steps === table A", r, TABLE_A);
  const shared = await call(client, "plan_dinner", { dishes: GOLDEN, serveAt: "19:00", option: "share-oven" });
  check("AC-4 explicit option share-oven → option + no conflict", () => {
    if (shared.option !== "share-oven") throw new Error("option=" + shared.option);
    if (shared.conflict) throw new Error("conflict still present");
  });
  expectSteps("AC-4 share-oven steps === table B", shared, TABLE_B);
  planB = shared;
}

// ---- AC-3 (independent constraint check + determinism on table B)
{
  const again = await call(client, "plan_dinner", { dishes: GOLDEN, serveAt: "19:00", option: "share-oven" });
  check("AC-3 same input twice → byte-identical JSON", () => {
    if (JSON.stringify(again) !== JSON.stringify(planB)) throw new Error("differs");
  });
  validatePlan("AC-3 constraints on table B (hands/racks/temps/deps/hold)", planB, planB.kitchen);
}

// ---- AC-4 (host with form elicitation)
{
  const requests = [];
  const el = await connect({ capabilities: { elicitation: { form: {} } }, onElicit: async (req) => { requests.push(req.params); return { action: "accept", content: { choice: "share-oven" } }; } });
  const r = await call(el.client, "plan_dinner", { dishes: GOLDEN, serveAt: "19:00" });
  check("AC-4 elicitation/create sent exactly once (form)", () => { if (requests.length !== 1) throw new Error("count=" + requests.length); });
  const schema = requests[0]?.requestedSchema;
  const opts = schema?.properties?.choice?.oneOf?.map((o) => o.const) ?? schema?.properties?.choice?.enum;
  check("AC-4 elicitation message + options share-oven/keep-temps", () => {
    if (!/Your oven can only hold one temperature at a time/.test(requests[0].message)) throw new Error("message=" + requests[0].message);
    if (JSON.stringify(opts) !== JSON.stringify(["share-oven", "keep-temps"])) throw new Error("opts=" + JSON.stringify(opts));
    info("message: " + requests[0].message);
  });
  expectSteps("AC-4 accept share-oven → table B", r, TABLE_B);
  check("AC-4 accept share-oven → option share-oven, conflict null", () => {
    if (r.option !== "share-oven" || r.conflict) throw new Error(`option=${r.option} conflict=${JSON.stringify(r.conflict)}`);
  });
  await el.client.close();

  const dec = await connect({ capabilities: { elicitation: { form: {} } }, onElicit: async () => ({ action: "decline" }) });
  const d = await call(dec.client, "plan_dinner", { dishes: GOLDEN, serveAt: "19:00" });
  check("AC-4 decline → keep-temps + conflict", () => { if (d.option !== "keep-temps" || !d.conflict) throw new Error("option=" + d.option); });
  expectSteps("AC-4 decline → table A", d, TABLE_A);
  await dec.client.close();

  // put the active plan back to table B
  await call(client, "plan_dinner", { dishes: GOLDEN, serveAt: "19:00", option: "share-oven" });
}

// ---- AC-7
{
  await setClock("18:00");
  const res = await client.callTool({ name: "plan_dinner", arguments: { dishes: GOLDEN, serveAt: "19:00" } });
  check("AC-7 clock 18:00 → isError + 9:50 PM", () => {
    if (res.isError !== true) throw new Error("isError=" + res.isError);
    const text = res.content?.[0]?.text ?? "";
    if (!text.includes("9:50 PM")) throw new Error("text=" + text);
    info("text: " + text);
  });
  const after = await call(client, "whats_next", {});
  check("AC-7 failed plan does not touch the active plan", () => {
    if (after.serveAt !== "19:00") throw new Error("serveAt=" + after.serveAt);
    const got = stepsMap(after);
    const diffs = Object.entries(TABLE_B).filter(([id, v]) => !got[id] || got[id][0] !== v[0] || got[id][1] !== v[1]).map(([id, v]) => `${id} got ${got[id]} want ${v}`);
    if (diffs.length) throw new Error(diffs.slice(0, 6).join("; "));
  });
}

// ---- AC-5
{
  await setClock("18:20");
  const before = await call(client, "whats_next", {});
  const c = await call(client, "report_delay", { target: "turkey", minutes: 20 });
  check("AC-5 turkey +20 @18:20 → serveAt 19:20 / original 19:00", () => {
    if (c.serveAt !== "19:20" || c.originalServeAt !== "19:00") throw new Error(`${c.serveAt}/${c.originalServeAt}`);
  });
  expectSteps("AC-5 steps === table C", c, TABLE_C);
  check("AC-5 changes lists exactly the 9 moved steps with from/to", () => {
    const ids = c.changes.map((x) => x.stepId);
    const want = ["turkey.roast", "turkey.rest", "mashed_potatoes.boil", "mashed_potatoes.mash", "green_beans.trim", "green_beans.blanch", "green_beans.saute", "gravy.make", "rolls.bake"];
    if (JSON.stringify(ids.slice().sort()) !== JSON.stringify(want.slice().sort())) throw new Error(ids.join(","));
    if (!c.changes.every((x) => /^\d\d:\d\d–\d\d:\d\d$/.test(x.from) && /^\d\d:\d\d–\d\d:\d\d$/.test(x.to))) throw new Error("from/to format");
    info("changes: " + c.changes.map((x) => `${x.stepId} ${x.from}→${x.to}`).join(" | "));
  });
  check("AC-5 revision incremented", () => { if (c.revision !== before.revision + 1) throw new Error(`${before.revision}→${c.revision}`); });
  check("AC-5 nothing starts before 18:20 except steps already begun", () => {
    const bad = c.steps.filter((s) => toMin(s.start) < toMin("18:20") && !before.steps.find((b) => b.stepId === s.stepId && toMin(b.start) < toMin("18:20")));
    if (bad.length) throw new Error(bad.map((s) => s.stepId).join(","));
  });

  // table D: rebuild table B at 13:00, then turkey.rest +15 at 18:40
  await setClock("13:00");
  await call(client, "plan_dinner", { dishes: GOLDEN, serveAt: "19:00", option: "share-oven" });
  await setClock("18:40");
  const d = await call(client, "report_delay", { target: "turkey.rest", minutes: 15 });
  check("AC-5 second case: turkey.rest +15 @18:40 → serveAt 19:15", () => { if (d.serveAt !== "19:15") throw new Error(d.serveAt); });
  expectSteps("AC-5 steps === table D", d, TABLE_D);
}

// ---- AC-6 (real restart, new session)
{
  await setClock("13:00");
  const k = await call(client, "update_kitchen", { cooks: 3 });
  await call(client, "plan_dinner", { dishes: GOLDEN, serveAt: "19:00", option: "share-oven" });
  const before = await call(client, "whats_next", {});
  info("before restart: cooks=" + k.cooks + " serveAt=" + before.serveAt + " revision=" + before.revision);
  await client.close();
  await stopServer();
  startServer();
  await waitHealth();
  const fresh = await connect();
  const k2 = await call(fresh.client, "get_kitchen", {});
  check("AC-6 kitchen survives a real process restart + new session", () => { if (k2.cooks !== 3) throw new Error("cooks=" + k2.cooks); });
  const n2 = await call(fresh.client, "whats_next", {});
  check("AC-6 whats_next returns the same serveAt and the same step times", () => {
    if (n2.serveAt !== before.serveAt) throw new Error(`serveAt ${before.serveAt}→${n2.serveAt}`);
    if (JSON.stringify(stepsMap(n2)) !== JSON.stringify(stepsMap(before))) throw new Error("step times changed");
  });
  await fresh.client.close();
}

await stopServer();
console.log(failures === 0 ? "ALL PASS" : `HAS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
PROBE_JS
)
  ( cd server && PROBE_PORT="$port" node --input-type=module -e "$code" )
}

need_local "T7 独立探针：AC-1..AC-7（真 server 进程 · 真 Streamable HTTP · 表 A/B/C/D · 真重启）" _t7_probe
