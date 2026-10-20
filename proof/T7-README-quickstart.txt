# T7 举证：全新 clone，只照根 README 的 Quick start（2026-10-20，北京时间）

## 1) clone
$ git clone https://github.com/hanshou101/hackathon-2026-amazon-alexa t7-fresh
Cloning into 't7-fresh'...
$ git rev-parse HEAD
18b2a45b8d4a36322d454cdbb6b726e52fd9ee3e
$ git status --short -uno    # 只看已跟踪文件（新 clone 里应为空；未跟踪的 T7-* 是本票自己生成的证据）
(empty)

## 2-5) npm install（README 的四条）
$ npm --prefix server install
48 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
$ npm --prefix sim install
48 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
$ npm --prefix board install
48 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
$ npm --prefix scheduler install
17 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

## 6) cp .env.example .env
$ cp .env.example .env && cut -d= -f1 .env | grep -v "^#" | grep .
HOST
PORT
DT_DATA_FILE
DT_BOARD_HTML
DEMO_MODE
DEMO_CLOCK_START
MCP_URL
SIM_PORT
SANDBOX_PORT
LLM_BASE_URL
LLM_API_KEY
LLM_MODEL
$ git status --short -uno   # .env 在 .gitignore 里，已跟踪文件没有变化
(empty，.env 被 gitignore)

## 7) bash scripts/dev.sh（README 的最后一步）+ 打开 http://localhost:8080
注：下面这段是清掉 sim/dist 后重跑的一次，现场与第一次一致。
Building the board…

> dinner-tower-board@1.0.0 build
> vite build && vite build --config vite.harness.config.ts

vite v8.3.4 building client environment for production...
transforming...
✓ 166 modules transformed.
rendering chunks...
[plugin vite:singlefile] 

[plugin vite:singlefile] Inlining: board-CovVg5Uz.js
[plugin vite:singlefile] Inlining: style-xuzhyAHG.css
computing gzip size...
dist/board.html  252.77 kB │ gzip: 66.86 kB

✓ built in 81ms
vite v8.3.4 building client environment for production...
transforming...
✓ 162 modules transformed.
rendering chunks...
[plugin vite:singlefile] 

[plugin vite:singlefile] Inlining: harness-D3MtIj1C.js
[plugin vite:singlefile] Inlining: style-CJecIpQ2.css
computing gzip size...
test/harness/dist/harness.html  342.02 kB │ gzip: 91.26 kB

✓ built in 61ms
MCP server starting on http://127.0.0.1:3001 (DEMO_MODE=1)…
[dinner-tower] MCP server listening on http://127.0.0.1:3001/mcp (protocol 2025-11-25, demo clock 13:00)
[sim] <clone>/sim/dist/index.html is missing — run: npm --prefix sim run build
Simulator: http://127.0.0.1:8080
MCP URL:   http://localhost:3001/mcp
Sandbox:   http://127.0.0.1:8081/sandbox.html

Dinner Tower is up:
  Simulator  http://localhost:8080
  MCP        http://localhost:3001/mcp
  Agent mode disabled — set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env
Ctrl-C stops both.

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8080/
HTTP 503

body: Simulator is not built. Run: npm --prefix sim run build

$ curl -s http://localhost:8080/api/config | head -c 120
{"mcpUrl":"http://localhost:3001/mcp","sandboxUrl":"http://localhost:8081/sandbox.html","agent":{"enabled":false},"skill

$ curl -s http://localhost:3001/health
{"ok":true,"name":"dinner-tower","protocolVersion":"2025-11-25"}
