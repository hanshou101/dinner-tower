# 05-SUBMISSION：提交包

> 角色：包装（T9）。目标：人打开 Devpost 提交页，照本文件逐字段复制粘贴、上传，十分钟内交完。
> 所有英文字段都可以直接粘贴；`<...>` 是留给人的值（视频链接、截图）。
> 仓库 URL 按 SPEC v1.5 写死为公开快照仓库 `https://github.com/hanshou101/dinner-tower`（主控在提交前从 main 建）。
> Open Source mini challenge 的字段来自 `submission/open-source.md`（T10 已合併），本文件已并入并改写成同一份提交包的一部分。

## 1. 提交平台与截止

- 提交入口：<https://amazonappdev2026.devpost.com/> → "Enter a Submission"（先在比赛页点 **Join hackathon**）
- 截止（北京时间）：**2026-10-24 03:00**（规则页 "Friday, October 23, 2026 (12:00 pm Pacific Time)"；Schedule 页 "October 23 at 7:00PM UTC"）
- 建议最晚提交时刻：**2026-10-24 01:00**（留 2 小时余量）
- 视频最晚上传：**2026-10-23 20:00**（官方 Update：「Don't leave your video upload to the last minute」）
- 截止后锁仓：**2026-10-24 03:00 至 12-04** 不改仓库 main、不改视频、不改任何作品材料

## 2. 表单字段（逐字段，原样可粘贴）

### 字段：Project name

```text
Dinner Tower
```

### 字段：Elevator pitch（一条话；≤ 200 字符）

```text
Air-traffic control for Thanksgiving: an MCP server schedules six dishes backwards from one serve time around an oven, asks the oven question via elicitation, and replans when the turkey runs late.
```

（197 字符。）

### 字段：About the project（文字说明；Devpost 的七个分段照抄）

```text
## Inspiration

Every Thanksgiving has the same bug. Six dishes have to be ready at the same
minute, and the kitchen has one oven that holds one temperature at a time, four
burners, and two pairs of hands.

The recipes collide. The turkey wants 325°F for three hours. The stuffing wants
350°F for forty-five minutes. The rolls want 400°F for twelve. Follow each
recipe literally and the stuffing is done at 3:20 PM and waits three hours and
forty minutes; switch the oven back and forth and you lose ten minutes on every
switch. People solve this with a spreadsheet, a paper list, and a certain amount
of shouting.

Voice assistants do not help, because they answer one question at a time. They
do not hold a six-hour plan, they cannot tell you what to do next when your
hands are covered in flour, and they forget everything when the session ends.

We wanted an assistant that behaves like air-traffic control for the kitchen:
one plan, every dish on one runway, and a controller that replans the moment
something is late.

## What it does

Dinner Tower takes a menu and a serve time and produces a minute-by-minute
plan, scheduled backwards from the moment dinner lands.

For the classic Thanksgiving menu — turkey, stuffing, mashed potatoes, green
beans, gravy, rolls — served at 7:00 PM, it produces thirteen steps starting at
3:10 PM, with the oven held at 325°F for one continuous block and every dish
inside its hold window when the 7:00 PM line arrives.

It asks the one question only a person can answer. With one oven something has
to give, so the server sends a real MCP elicitation in the middle of the tool
call: share the oven (bake the stuffing and rolls at 325°F alongside the rest),
or keep recipe temperatures (the stuffing is ready at 3:20 PM and waits three
hours and forty minutes). The card is the server's own question, not a dialog
the interface invented.

It shows the plan as a departure board: TIME / DISH / STEP / STATION / STATUS,
with the oven temperature on every row and a timeline underneath. The board is
an MCP App, and it is also an input device — the +10 MIN button on the current
row calls the server directly, so you can replan with a knuckle when your hands
are full.

It remembers. The kitchen and the active plan live on the server, so at 6:20 PM
you can restart the server, open a new session, ask "what's next?", and get the
same 7:00 PM line: the turkey comes out at 6:30, trim the green beans at 6:27,
boil the potatoes at 6:30.

It replans. Say "the turkey needs twenty more minutes" and dinner moves to
7:20; the steps that already happened stay fixed, and only the steps that have
to move, move.

And it teaches other assistants how to drive it: an Agent Skill describes the
workflow — plan, ask, report a delay, read the next step — in the assistant's
own voice.

## How we built it

We wrote the spec before the code: protocol version, tool schemas, the
scheduling algorithm with golden time tables, the board layout, and a numbered
acceptance list. Every scheduled minute in the tests is asserted against those
tables, so a scheduling change that shifts dinner by five minutes fails loudly.

The server is a self-hosted MCP server on spec 2025-11-25 over Streamable HTTP,
with stateful sessions (each session gets its own server instance so elicitation
replies land in the right place) and a small JSON store for the kitchen and the
active plan. Six tools: list_dishes, get_kitchen, update_kitchen, plan_dinner,
whats_next, report_delay. Planning tools return a shared PlanView as structured
output, plus a short English sentence for hosts without a screen.

The scheduler is pure TypeScript with no runtime dependencies: a deterministic
backwards packer that places each step as late as possible before the serve
time, respecting oven temperature occupancy (one temperature at a time, plus a
ten-minute switch window), two oven racks, four burners, two cooks, and each
dish's hold limit. Replanning pins every step that has already started and
searches for the smallest delay that fits.

The board is a single self-contained HTML file built with Vite, using the MCP
Apps App API: it renders the tool result's structuredContent and calls tools
back through the host. The host is our Echo-style simulator, which is a real MCP
client in the browser — it negotiates the protocol, opens a Streamable HTTP
session, lists and calls tools, answers elicitation requests with a choice card,
and mounts ui:// resources in a double-iframe sandbox through AppBridge.

Agent mode is optional: the page runs a bounded tool loop (six rounds), the
model talks to an OpenAI-compatible chat-completions endpoint through the local
simulator server, and the key never reaches the browser. Without a key, direct
mode still works — the chips and the tool console are real tool calls too.

Finally, the demo video is a pipeline, not a screen recording: a headless
Playwright run drives the real simulator through the scripted story (including a
real server restart between sessions), macOS `say` produces three voices, and
ffmpeg muxes voice, subtitles and cards. The build refuses to finish unless
ffprobe reports H.264 + AAC, at least 1280x720, and less than 179 seconds.

## Challenges we ran into

The biggest one: the official Alexa+ developer tools — Category SDK, MCP
Toolkit, CLI, Web Simulator — are available to select partners only, and the
hackathon FAQ says there is no way for participants to apply. The track asks for
a working Alexa+ experience, so we built the surface ourselves, as a real MCP
client and MCP Apps host rather than a mock. It says "Simulated Alexa+
experience — unofficial demo" on the page, and uses no Amazon logos.

The second: MCP Apps 2.x is a different SDK generation from every tutorial
online. It needs the v2 split packages, its sandbox proxy has to serve its own
JavaScript from its own origin, and the App sends exactly one initialize message
with no retry — so the host must be listening before the App document exists.

The third: elicitation inside a tool call only works with stateful sessions. The
obvious stateless server (a new instance per request) silently breaks it: the
question goes out from one instance and the answer lands on another.

## Accomplishments that we're proud of

Everything on screen is the real system. The board, the question card, the
delay, the replan and the cross-session memory are the actual server responses;
the only simulated parts are labelled in the video (the demo clock, the
text-to-speech voice, and the Alexa+ surface).

The oven question is the protocol doing the work, not the UI: the two options in
the card are the exact strings the server sends in its elicitation request.

The plan survives a process restart, and the replan respects physics: a step
that has already started is never moved.

And the whole demo is one command: `bash scripts/demo/make.sh`.

## What we learned

A plan is a product. The scheduling engine is the value; the chat is just the
handle.

Elicitation is what separates an assistant from a chatbot. Being able to ask one
well-formed question at the right moment — with the consequences spelled out in
the options — is worth more than another paragraph of prose.

Determinism is a feature. A frozen demo clock plus golden scheduling tables made
both the tests and a three-minute video of a six-hour process possible.

And protocol work is host work. Half of the effort was not the server; it was
earning the sandbox, the session and the screen.

## What's next for Dinner Tower

A real Alexa+ surface when developer access opens up; multi-day prep (thaw,
brine, pie the day before); grocery quantities; per-household tastes; and more
appliances — sous-vide, air fryer, grill — so the tower can use every heat
source in the kitchen, not just the oven.
```

### 字段：Built with（逗号分隔）

```text
TypeScript, Node.js 20, Model Context Protocol 2025-11-25, Streamable HTTP, @modelcontextprotocol/server 2.3.1, @modelcontextprotocol/client 2.3.1, @modelcontextprotocol/node 2.1.1, @modelcontextprotocol/express 2.0.2, @modelcontextprotocol/ext-apps 2.0.3, MCP Apps, Agent Skills, Express 5, zod 4, Vite 8, Vitest 4, Playwright 1.64, ffmpeg, Zhipu GLM
```

### 字段：Try it out — 代码仓库 / 视频

| 字段 | 值 |
| --- | --- |
| GitHub repository URL | `https://github.com/hanshou101/dinner-tower` |
| Video demo link（YouTube / Vimeo，Public） | `<YOUTUBE_OR_VIMEO_URL>` |
| Live demo | 无（本地运行；FAQ：「A locally runnable public repo plus your demo video is enough」） |

### 字段：Primary track

```text
Alexa+
```

### 字段：Mini challenge

```text
Open Source
```

### 字段：Open Source mini challenge（若表单出现这四个附加栏）

取自 `submission/open-source.md`（T10，已合併；贡献仓库公开、MIT、E2E 绿）。

| 项 | 值 |
| --- | --- |
| Contribution URL（开源贡献仓库） | `https://github.com/hanshou101/echo-mcp-apps-sim` |
| Project repository URL（本次参赛项目） | `https://github.com/hanshou101/dinner-tower` |
| GitHub username | `hanshou101` |

**What I did**

```text
I built and open-sourced echo-mcp-apps-sim, a small web host that turns any MCP
server into something you can watch on an Echo Show-style screen.

Dinner Tower needs an MCP Apps surface (a departure board rendered from a
ui:// resource) and a way for the server to ask a question in the middle of a
tool call (elicitation). When we went looking for a host to develop against,
there was nothing we were allowed to use: the official voice-assistant
simulators are not publicly available, and the existing MCP inspectors show
JSON, not a screen. So I extracted the host half of our demo into its own
repository, replaced everything product-specific with configuration, and
published it under MIT so the next team does not lose the same days.

The result is a real MCP client in the browser, not a mock: Streamable HTTP
with stateful sessions, a double-iframe MCP Apps sandbox, form elicitation in
both the titled-enum and legacy-enum schema shapes, a tool console, an
optional OpenAI-compatible agent mode, and a headless Playwright suite that
proves each of those against a bundled example server.
```

**How it works**

```text
The page is a 1280x720 web app. The browser opens a Streamable HTTP session
with @modelcontextprotocol/client, declares elicitation(form) and the MCP Apps
UI extension, then lists and calls tools exactly like any other client. A tool
result that references a ui:// resource is read with resources/read, written
into a sandboxed iframe on a second origin, and wired to the server through
the MCP Apps AppBridge; calls the App makes itself are forwarded through the
host and shown in the log.

Elicitation requests arrive as elicitation/create and are rendered as a card
over the screen: the server's message plus one large button per option,
supplied either as a 2025-11-25 titled enum (oneOf: [{const, title}]) or as the
legacy enum + enumNames pair. The click is returned as
{action: "accept", content: {choice}}.

Two small Node processes serve it: the page and its JSON API on 8180, the
sandbox proxy on 8181 (a separate origin is what makes the sandbox meaningful),
and the server under test wherever it listens (3301 for the bundled example).
Everything the page needs to know comes from GET /api/config, so pointing it at
another server is one environment variable.

Direct mode (quick-action chips and a tool console) needs no model at all.
Agent mode is optional: with an OpenAI-compatible endpoint configured, the page
runs a bounded tool loop in the browser while the key stays on the host server,
and every elicitation is still answered by the person clicking.

The repository ships the tests that matter: the E2E suite connects over
Streamable HTTP, checks the negotiated protocol and session id, asserts the App
rendered inside the iframe by reading its DOM, clicks a button inside the App
and sees the forwarded tools/call, answers both elicitation schema shapes, and
checks the demo clock only appears when the server exposes it.
```

**Why it matters**

```text
MCP Apps put a real interface on the glass, but the feedback loop for building
one is bad: most clients show you protocol JSON, and the simulators for
voice-first assistants are not something a random developer can log into. You
end up shipping a board you have never seen, a sandbox CSP you have never
tripped, and an elicitation schema you have only read about.

This repository closes that gap for everyone, not just for us. Any MCP server
author can clone it, run two commands, and watch their App render and their
question get answered, on a screen shaped like the device the app is for. It is
deliberately small and product-neutral: no account, no cloud, no vendor SDK,
one JSON file for the quick actions you care about.

We also think the honest bits matter. The page says "Simulated Alexa+
experience - unofficial demo" and uses no Amazon logos, because pretending to
be the official simulator would be worse than having none. Where a capability
is missing (no voice input, Streamable HTTP only) the README says so in a
Limits section instead of hiding it. If this saves one team the two days we
spent reverse-engineering the sandbox handshake, it has done its job.
```

### 字段：既有项目说明（"Did your project exist before this hackathon?"）

```text
No. Dinner Tower was created entirely within the submission window.
```

### 字段：Product feedback（每个工具 / API / SDK 一段）

规则要求每个工具都回答五件事：拿它做了什么 / 什么好用 / 什么要改 / onboarding（从零到 hello world）/ 会不会再用及原因。

#### 1. Model Context Protocol specification 2025-11-25 (Streamable HTTP + elicitation)

```text
What we used it for: the whole product contract. The server speaks 2025-11-25
over Streamable HTTP with stateful sessions; plan_dinner sends a form
elicitation in the middle of the tool call; the board is served as a ui://
resource; every planning tool declares an outputSchema and returns
structuredContent.

What worked well: Streamable HTTP mapped cleanly onto Express and onto a
browser client, and stateful sessions are what make mid-call elicitation
possible at all — the question and the answer have to land in the same server
instance. The titled enum (oneOf: [{const, title}]) is exactly the right shape
for a two-option decision: the labels are sentences, and the values are stable
ids. structuredContent plus a short text fallback meant one tool could serve a
screen and a text-only host without a second endpoint.

What should change: the specification is precise about the wire and thin about
the host. Nothing tells you that a ui:// resource's sandbox needs its own
origin, that the sandbox bundle has to be served from that origin, or when the
host must be listening relative to the App document. The elicitation section
would also benefit from one complete stateful example — the stateless server in
most examples silently loses elicitation replies.

Onboarding, zero to hello world: with the TypeScript SDK, about thirty lines to
a stateful server that answers tools/list. Understanding why it must be
stateful took longer than writing it.

Would we use it again, and why: yes. The protocol is the product's backbone: it
is why the same server works with our simulator, MCP Inspector, and any other
host, and why the UI is a resource rather than a bespoke API.
```

#### 2. MCP TypeScript SDK v2 (`@modelcontextprotocol/server|client|node|express` 2.x)

```text
What we used it for: the server (McpServer, registerTool, registerAppTool,
elicitInput), the browser client (Client + StreamableHTTPClientTransport), the
Node transport, and the Express integration (createMcpExpressApp,
NodeStreamableHTTPServerTransport).

What worked well: the split packages are clean and small, and the Express +
Node transport path gives you a real stateful Streamable HTTP server without
hand-rolling session ids. Zod input schemas are ergonomic, outputSchema
plumbing works, and the client transport exposes the negotiated protocol
version and session id, which made the tests assert the real handshake instead
of trusting configuration.

What should change: the v2 packages ship no per-symbol API documentation —
just a generated .d.mts bundle, while every tutorial online targets the v1
@modelcontextprotocol/sdk. Two specific traps: Server.elicitInput is marked
deprecated with a pointer to a replacement that does not exist on the
2025-11-25 wire, and an empty elicitation: {} capability is silently rewritten
to {form:{}} before the server sees it. Both cost real debugging time.

Onboarding, zero to hello world: four packages, about forty lines, and a
working stateful server — once you accept the declarations as the source of
truth. Budget an afternoon if you are coming from v1.

Would we use it again, and why: yes, pinned to exact versions. The transport
and session handling are genuinely hard to get right, and the SDK gets them
right; we would just keep the .d.mts open in another window.
```

#### 3. MCP Apps (`@modelcontextprotocol/ext-apps` 2.0.3)

```text
What we used it for: registerAppTool and registerAppResource on the server, the
App class in the board, and AppBridge plus the double-iframe sandbox in the
host. The board renders the PlanView from structuredContent and calls
report_delay back through the host.

What worked well: a single self-contained HTML file is a great unit of
distribution, and the App-initiated callServerTool is the feature that made the
product: the +10 MIN button on the board is a real tool call from inside the
sandbox, with no voice and no host code in the middle. The double-iframe model
is the right security shape, and once it is wired, App and host code stay
pleasantly small.

What should change: the quickstart does not say that ext-apps 2.x needs the v2
split MCP SDK packages (not @modelcontextprotocol/sdk), and the basic-host
example's catch-all 404 on the sandbox origin also 404s the sandbox's own JS
bundle — the proxy then never becomes ready and the host times out. App.connect
sends ui/initialize exactly once with no retry, so if the host assigns the
iframe document before connecting the bridge, that message is lost and the App
never renders. Auto-resize also fights fixed-size hosts: size-changed has to be
advisory, not a command.

Onboarding, zero to hello world: roughly a day, and most of it was the sandbox
handshake rather than the App itself. With the ordering documented it would be
an hour.

Would we use it again, and why: yes. For any MCP server with a screen, this is
the difference between a JSON log and a product, and the App API is small
enough to keep in your head.
```

#### 4. Agent Skills

```text
What we used it for: skills/dinner-tower/SKILL.md is the system prompt for
agent mode. It teaches the host the four moves — plan, ask the oven question,
report a delay, read the next step — plus the speaking rules (12-hour times,
two short sentences, never read a step id aloud).

What worked well: a markdown file with name/description frontmatter is the
lowest-friction way to ship assistant behaviour we have used. It is
model-agnostic, reviewable in a pull request, and short enough that a person can
argue with it. Eighty lines replaced what would otherwise have been a long
prompt-engineering spiral, and because the same text is loaded at runtime, the
skill and the demo cannot drift apart.

What should change: there is no validator or lint — nothing checks the
frontmatter, the line budget, or that the tools named in the skill actually
exist on the server. There is also no guidance on precedence when a host merges
a skill with server instructions, and no versioning, so a host cannot tell
which revision of a skill it loaded.

Onboarding, zero to hello world: minutes. Writing the file is trivial; the real
work is deciding what belongs in it, which is a product question.

Would we use it again, and why: yes — it is now our default way to ship
assistant behaviour, because it keeps the workflow in the repository instead of
in someone's prompt history.
```

#### 5. LLM: Zhipu AI `glm-5.3-flash` via an OpenAI-compatible endpoint

```text
What we used it for: agent mode. The browser runs a bounded tool loop (six
rounds); the local simulator server forwards each round to
{LLM_BASE_URL}/chat/completions with tool_choice: auto and temperature 0.2; the
model picks among the six MCP tools and turns the results into two spoken
sentences.

What worked well: because the endpoint is OpenAI-compatible, the simulator
needed no provider SDK — one fetch call, and the same code works with any
compatible provider. Tool calling was reliable enough to drive a six-tool
workflow in a live demo, latency was comfortably inside a conversation, and
the key stayed on the server.

What should change: "OpenAI-compatible" is not total. Error shapes, streaming
details and usage reporting differ between providers, and model naming and
versioning across providers is confusing enough that pinning a model in a demo
takes a round of trial and error. A shared, explicit compatibility statement
(what is guaranteed, what is best-effort) would save that round.

Onboarding, zero to hello world: about ten minutes from an existing OpenAI
client, with no new dependency.

Would we use it again, and why: yes for demos and prototypes — the
compatibility layer is worth more than any single provider feature. For
production we would want stronger structured-output guarantees and a fallback
provider behind the same interface.
```

### 字段：Feature requests（选填；每条带优先级）

```text
1. A public Alexa+ add-on simulator for hackathon participants.
Description: a hosted, rate-limited web simulator (or a read-only mode of the
official Web Simulator) that renders MCP Apps and can answer elicitation, so a
team without partner access can test the surface the track asks for.
Why it matters to this project: our entire demo surface had to be built from
scratch because the official tools are partner-only; every Alexa+ entrant pays
that cost.
Priority: Critical

2. Version-pinned API reference for the MCP TypeScript SDK v2 split packages.
Description: one API.md per package generated from the declarations, linked
from the package README, with the v2 constructor / registerTool / transport
signatures on the front page.
Why it matters: the only reference for 2.3.1 is a generated .d.mts, while every
search result is v1; we lost hours to overloads and exports that moved.
Priority: Important

3. State the SDK-generation requirement and the sandbox hosting contract at the
top of the MCP Apps quickstart.
Description: say that ext-apps 2.x requires the v2 split packages, that the
sandbox origin must serve its own JS/CSS assets, and that the host must be
listening before the App document exists.
Why it matters: these three facts are the difference between a one-hour setup
and a one-day setup, and all three are currently learned from failures.
Priority: Important

4. Make App.connect() retry ui/initialize (or document the ordering).
Description: a bounded retry with backoff, or an explicit "connect the bridge
before assigning srcdoc" line in every AppBridge example.
Why it matters: the failure is silent — the App simply never renders and the
host times out.
Priority: Nice-to-have

5. Era-aware deprecation notices for Server.elicitInput.
Description: mark the method as era-specific ("2025-era sessions") rather than
deprecated when the server negotiates 2025-11-25, since the suggested
replacement does not exist on that wire.
Why it matters: the current JSDoc sends 2025 implementers toward an API they
cannot use.
Priority: Nice-to-have

6. A skill validator for Agent Skills.
Description: a small CLI that checks frontmatter, the line budget, and that
every tool named in a SKILL.md exists on a given MCP server.
Why it matters: skills are becoming the packaging format for assistant
behaviour; a broken skill fails at runtime, in front of a user, not in CI.
Priority: Nice-to-have
```

### 字段：Friction log（选填，最高 10% 加分；六条真实记录）

规则要求每条含：具体任务、步骤、预期 vs 实际、严重度、绕过办法、可执行建议。

```text
### 1. Alexa+ developer tools are unavailable to hackathon participants

Task attempted: find an official way to test a self-hosted MCP server inside an
Alexa+ experience.
Steps taken: read the hackathon Resources page and the add-on setup guides, then
the FAQ.
Expected: a web simulator or test console for Alexa+ add-ons, since the track
asks for Alexa+ MCP servers.
Actual: FAQ says the tools are "available to select partners only - there is
currently no way for hackathon participants to apply for or gain access". The
individual setup-guide pages do not say so, so the dead end only appears after
reading the FAQ.
Severity: Major.
Workaround: built our own Echo-style web simulator that is a real MCP client
and MCP Apps host (open-sourced separately as echo-mcp-apps-sim).
Suggestion: ship a public, rate-limited Alexa+ add-on simulator for hackathons,
and put the "partners only" note on every setup-guide page.

### 2. MCP Apps 2.x needs the split v2 MCP SDK packages, not @modelcontextprotocol/sdk

Task attempted: pick an SDK version for a server with an MCP App UI.
Steps taken: installed @modelcontextprotocol/sdk 1.32.1 together with
@modelcontextprotocol/ext-apps 2.0.3 in a scratch project, then inspected the
peer dependencies and the official examples' package.json.
Expected: ext-apps works with @modelcontextprotocol/sdk, the name the TypeScript
SDK used until v2.
Actual: ext-apps 2.0.3 peer-depends on @modelcontextprotocol/client|core|server
^2.0.0 and zod ^4.2, not on @modelcontextprotocol/sdk (latest 1.32.1); the
official examples import the v2 split packages.
Severity: Minor (but it decides the whole dependency set).
Workaround: pinned @modelcontextprotocol/server|client 2.3.1, node 2.1.1,
express 2.0.2, zod 4.
Suggestion: state the SDK generation requirement at the top of the MCP Apps
quickstart and in the Alexa+ resources section.

### 3. The sandbox origin must serve the sandbox page's own bundle

Task attempted: serve the MCP Apps sandbox proxy from its own origin and load an
App through it, following the basic-host example.
Steps taken: copied basic-host's serve.ts pattern — the sandbox Express app
answers /sandbox.html with a CSP header and 404s everything else; built
sandbox.html with Vite as a separate HTML entry.
Expected: the proxy posts ui/notifications/sandbox-proxy-ready once its bundle
loads.
Actual: the built page requests /assets/sandbox-*.js and /assets/app-bridge-*.js
from the sandbox origin; both 404 (net::ERR_ABORTED), the proxy never becomes
ready, and the host fails with "Sandbox proxy did not become ready" after 8 s.
Severity: Blocker.
Workaround: also serve /assets from the sandbox origin (or inline the sandbox
bundle into sandbox.html), keeping every other path 404.
Suggestion: say in the basic-host README that a built sandbox.html needs its
JS/CSS assets on the sandbox origin — the example's catch-all 404 is easy to copy
verbatim.

### 4. AppBridge must be connected before the App document exists

Task attempted: mount the built board into a test host iframe and push a tool
result into it.
Steps taken: created the iframe, set srcdoc to the board HTML, then built the
bridge and called bridge.connect(...).
Expected: the App's ui/initialize request arrives after the bridge is listening.
Actual: the board never rendered. App.connect() sends ui/initialize exactly once
(no retry) as soon as its script runs; because the iframe document existed
first, that message was posted before the host had a listener and was lost, and
await app.connect() hung until its request timeout.
Severity: Major.
Workaround: connect the bridge to iframe.contentWindow first, then assign
srcDoc — or use the double-iframe sandbox proxy, which injects the HTML only
after sendSandboxResourceReady.
Suggestion: document the ordering in the AppBridge examples ("connect() before
the App document is created") and/or retry ui/initialize a few times.

### 5. The MCP SDK v2 split packages ship no per-symbol API docs

Task attempted: find how to construct an McpServer with instructions, register a
tool with an input schema and annotations, and choose transport options for a
stateful Streamable HTTP server.
Steps taken: read @modelcontextprotocol/server/README.md (1.9 KB, points at an
external site, nothing version-pinned in the package, no docs folder) — the
package has only dist/index.mjs plus a 4000-line dist/index.d.mts. Grepped for
declare class McpServer, McpServerOptions and
WebStandardStreamableHTTPServerTransportOptions in that file.
Expected: a per-export declaration file or a doc page matching the installed
version.
Actual: no error, just time lost. The first lines are minified re-export aliases
("w as McpServer"), so a grep for McpServer lands on an import list, not the
class; registerTool has two overloads and the raw-shape one is deprecated; and
isInitializeRequest is exported from @modelcontextprotocol/server, not from the
subpath a v1 user would try.
Severity: Minor.
Workaround: treat dist/*.d.mts as the source of truth, and confirm exports at
runtime with node --input-type=module -e "import * as m from
'@modelcontextprotocol/server'; console.log(Object.keys(m))".
Suggestion: generate one API.md per split package from the declarations and put
the v2 constructor / registerTool signature on the package README.

### 6. elicitInput is deprecated in the typings, but its replacement does not exist on 2025-11-25

Task attempted: call form elicitation from inside a tools/call handler, on a
server that negotiates protocol 2025-11-25.
Steps taken: read Server.elicitInput in the typings; its JSDoc says "Deprecated.
Throws on a 2026-07-28-era request — use inputRequired (multi-round-trip)
instead", and Server._assertPushApiInServedEra backs that up.
Expected: a single obvious API to call.
Actual: two eras, two idioms — push-style elicitInput on 2025-era sessions,
input_required results on 2026-07-28. The inputRequired(...) path the JSDoc
steers to is not available on the 2025-11-25 wire the competition asks for, so
the deprecation notice is misleading for anyone pinned to the 2025 revision.
Severity: Minor.
Workaround: kept server.server.elicitInput({ mode: "form", ... }) (the 2025-era
path) and asserted the negotiated version (2025-11-25) in the tests, which
proves the era.
Suggestion: make the JSDoc conditional on the negotiated era, or mark the method
"era-specific" rather than "deprecated" when the server serves 2025.
```

## 3. 链接与文件

| 项 | 地址 / 文件 | 状态 |
| --- | --- | --- |
| 代码仓库（公开？） | `https://github.com/hanshou101/dinner-tower`（公开、MIT） | 已建（main 快照，单提交） |
| 演示视频 | `<YOUTUBE_OR_VIMEO_URL>`（Public；成片在 GitHub Release：`https://github.com/hanshou101/dinner-tower/releases/tag/demo-v2`） | 待用户上传 YouTube |
| 在线演示地址 | 无（本地运行，规则允许） | — |
| PPT / PDF | 无（规则不要求） | — |
| 开源贡献仓库 | `https://github.com/hanshou101/echo-mcp-apps-sim`（公开、MIT） | 已上线 |
| 视频源文件 | Release `demo-v2` 附件 `dinner-tower-demo.mp4`（2:48 = 168 s，真模型 `glm-5.3-flash`，主控在 macmini2 录制；本地产物在 `scripts/demo/out/`，不进 Git） | 已发布 |
| 封面图（Devpost 缩略图，3:2） | `submission/cover-1500x1000.png`（设备框里的出发看板 + 字标 + 一句话） | 已产出 |

## 4. 对照 BRIEF §2 的提交物清单

| # | 提交物 | 准备好了吗 | 证据 |
| --- | --- | --- | --- |
| 1 | 文字说明（英文） | ✅ | 本文件 §2「About the project」 |
| 2 | GitHub 仓库 URL（公开 + 许可证可见） | ✅ `https://github.com/hanshou101/dinner-tower`（公开、MIT，main 快照） | `LICENSE`；SPEC v1.5 |
| 3 | Alexa+ 技术硬钩（MCP 2025-11-25 over Streamable HTTP，代码里真实 import 并调用） | ✅ | `server/src/index.ts` import `@modelcontextprotocol/server|node|express`；`bash scripts/verify.sh` 的协议检查；`proof/T7-AC1-AC7-probe.txt` |
| 4 | 演示视频（< 3:00、YouTube/Vimeo 公开、英文、无第三方商标/版权音乐） | ⏳ 成片已发 Release `demo-v2`（2:48 = 168 s、H.264+AAC、1280×720、真模型 `glm-5.3-flash`）；待用户上传 YouTube | Release `demo-v2` 附件 `dinner-tower-demo.mp4`；本地 `scripts/demo/out/`（不进 Git） |
| 5 | 产品反馈（每个工具五问） | ✅ | 本文件 §2「Product feedback」（5 个工具） |
| 6 | 赛道 + mini challenge | ✅ | 本文件 §2：Alexa+ / Open Source |
| 7 | Open Source mini challenge 附加字段 | ✅ | 本文件 §2 与 `submission/open-source.md` |
| 8 | 既有项目说明 | ✅ | 本文件 §2：「No.」 |
| 9 | Feature requests（选填） | ✅ | 本文件 §2（6 条，带优先级） |
| 10 | Friction log（选填，最高 10%） | ✅ | 本文件 §2（6 条，全部来自 `docs/friction/`） |

## 5. 人工步骤（给用户：按顺序做）

1. **现在**：用 GitHub 账号确认 `https://github.com/hanshou101/dinner-tower` 已由主控建好、公开、About 显示 MIT；若还没建，先找主控。
2. **10-23 12:00 前**：准备可上传公开视频的 YouTube（或 Vimeo）账号。
3. **10-23 20:00 前**：从 Release（`https://github.com/hanshou101/dinner-tower/releases/tag/demo-v2`）下载 `dinner-tower-demo.mp4`，上传 YouTube，标题写 `Dinner Tower — Alexa+ hackathon demo`，可见性 **Public**，语言标 English；把链接回帖到本单。**不要**用样例片 `dinner-tower-sample.mp4`（片尾有 `SAMPLE — SCRIPTED LLM` 字样，只用于自测）。
4. 打开 <https://amazonappdev2026.devpost.com/>，点 **Join hackathon**（若还没点）。
5. 点 **Enter a Submission**，按本文件 §2 的顺序逐字段粘贴：Project name → Elevator pitch → About the project → Built with → 仓库 URL → 视频 URL → Track（Alexa+）→ Mini challenge（Open Source）→ 产品反馈 → Feature requests → Friction log。
6. 缩略图（Thumbnail，3:2）上传 `submission/cover-1500x1000.png`（Release `demo-v2` 也附了一份）；Image gallery 可再放这张封面和 `proof/ui/board-1280x720.png`、`proof/ui/replan-1280x720.png`。
7. Open Source 的四个附加栏：Contribution URL、Project repository URL、GitHub username、What I did / How it works / Why it matters（照 §2 粘贴）。
8. 视频链接填好后，回到本文件把 `<YOUTUBE_OR_VIMEO_URL>` 替换成真实链接，并在本单评论里贴一次，方便复核。
9. 提交前最后检查：仓库公开可访问、About 有 MIT、视频 Public 且能播放、表单没有空着的必填项。
10. 点 **Submit**，截图（提交成功页 + 作品页 URL）回帖到本单。
11. **10-24 03:00 起至 12-04**：不改仓库 main、不改视频、不改任何作品材料。

## 6. 提交后确认

- 提交成功的截图或邮件：`<待填>`
- 作品页链接：`<待填>`
- 提交时间（北京时间）：`<待填>`
