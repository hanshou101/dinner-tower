# 04-PROOF：你能证明它能用吗？

> 角色：举证。只看实物（运行结果、文件、diff），不看任何人的总结。
> 本轮：T7（AME-857）· 2026-10-20（北京时间）· 证据文件 `proof/T7-*`。

## 1. 复验环境

- 全新 clone 的目录：Multica 工作目录下新建的 `t7-fresh/`，`git clone https://github.com/hanshou101/hackathon-2026-amazon-alexa`，**没有**从工作区 checkout 复制任何文件（`git status --short` 为空）。
- commit：`18b2a45b8d4a36322d454cdbb6b726e52fd9ee3e`（`AME-838: 第二階段收尾 — README 補 board install、SPEC v1.2 記錄驗收裁定、AC-10 真模型證據 (#13)`），等于 `origin/main`。
- 日期：2026-10-20（北京时间）。
- 机器 / 运行时：macOS Darwin 25.2.0（Apple Silicon）· Node **v20.19.4**（fnm）· npm 10.8.2 · Playwright chromium 1.64.1（headless，1280×720）。
- `.env`：照 README `cp .env.example .env`，`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` **三个键留空**（本机没有产品可用的 OpenAI 相容端点，见 SPEC §10 v1.2）。

## 2. 只照 README 从零跑通

| README 步骤 | 实际命令 | 结果（输出摘要或截图） | 通过？ |
| --- | --- | --- | --- |
| 前置：Node 20.19+ | `node -v` | `v20.19.4` | ✅ |
| clone | `git clone https://github.com/hanshou101/hackathon-2026-amazon-alexa t7-fresh` | `HEAD 18b2a45`，`git status --short` 为空 | ✅ |
| 1 | `npm --prefix server install` | `added 147 packages … found 0 vulnerabilities` | ✅ |
| 2 | `npm --prefix sim install` | `added 151 packages … found 0 vulnerabilities` | ✅ |
| 3 | `npm --prefix board install` | `added 151 packages … found 0 vulnerabilities` | ✅ |
| 4 | `npm --prefix scheduler install` | `added 49 packages … found 0 vulnerabilities` | ✅ |
| 5 | `cp .env.example .env` | 12 个键全部为空；`.env` 被 `.gitignore` 忽略（`git status --short` 仍为空） | ✅ |
| 6 | `bash scripts/dev.sh` | 先构建看板（`dist/board.html 252.77 kB`），MCP server 起在 `http://127.0.0.1:3001`（`protocol 2025-11-25, demo clock 13:00`）；随后打印 `[sim] …/sim/dist/index.html is missing — run: npm --prefix sim run build`，但仍然打印 `Dinner Tower is up` | ⚠️ 见右 |
| 7 | 打开 `http://localhost:8080`（README 的下一步） | `HTTP/1.1 503`，正文 `Simulator is not built. Run: npm --prefix sim run build` | ❌ **FAIL-1** |
| 补做（sim/README 写的命令，根 README 没写） | `npm --prefix sim run build` 后重试 | `GET /` → `HTTP 200`，4627 字节，含 `<html` | ✅ 页面可用 |

**§2 判定：FAIL。** 根 README 的 Quick start 在全新 clone 上走不通第 7 步：`scripts/dev.sh` 只构建 `board/`，不构建 `sim/`，所以按 README 打开 `http://localhost:8080` 得到 503，看不到任何产品画面。补跑 `npm --prefix sim run build` 后一切正常——也就是说缺的是一条 README 命令（或 dev.sh 少一步构建），不是产品缺陷。原始现场见 `proof/T7-README-quickstart.txt`（含 `dev.sh` 完整启动日志与三条 curl 输出）。

> 偏差记录：为了让 AC-8/AC-9 能在**真实 server + sim** 上跑，我在这次复验里补跑了 `npm --prefix sim run build`（sim/README「Run it」一节的命令）。这是对 README 的偏离，已按失败项交回（§5.1）。

## 3. 逐条验收

判定口径：AC-1～AC-11 逐条跑；每条至少一份真实输出或截图。**AC-10 本机无 LLM key，判定引用主控在 macmini2 的真模型实测**（SPEC §10 v1.2），本机只补脚本化端点的证据。

| AC | 操作 / 命令 | 真实输出或截图（`proof/` 下的文件） | 判定 |
| --- | --- | --- | --- |
| AC-1 协议与传输 | 独立探针起真 `tsx src/index.ts` 进程，用 `@modelcontextprotocol/client` 走 Streamable HTTP | `T7-AC1-AC7-probe.txt`：`AC-1 /health body`、`initialize protocolVersion === 2025-11-25`、`Mcp-Session-Id present (stateful)`（session `926ca60d-…`）、`follow-up request on same session` 全 PASS | PASS |
| AC-2 工具面 | 同一会话 `tools/list` / `resources/read` / `prompts/list` / `initialize.instructions` | `T7-AC1-AC7-probe.txt`：6 个工具恰好、每个有 title/description/inputSchema、3 个 UI 工具带 `outputSchema` + `_meta.ui.resourceUri`、3 个只读工具的 `readOnlyHint`、`ui://dinner-tower/board.html` → `text/html;profile=mcp-app`（252748 字节）、`prompts/list` 有 `thanksgiving`、`instructions` 非空 | PASS |
| AC-3 排程正确性 | 黄金输入 + `option:"share-oven"`，逐步骤对 §6.2.6 表 B；另用独立于引擎的循环校验资源约束 | `T7-AC1-AC7-probe.txt`：`share-oven steps === table B [13 steps exact]`、`constraints on table B (hands/racks/temps/deps/hold)`、`same input twice → byte-identical JSON` | PASS |
| AC-4 冲突与选项 | 无 elicitation 能力的客户端 / 声明 form 能力的客户端（accept share-oven、decline）/ 显式 `option` | `T7-AC1-AC7-probe.txt`：`primary steps === table A`、`stuffing wait 220 min`、`elicitation/create sent exactly once`、`message` 与两个选项 id、`accept share-oven → table B`、`decline → table A`；界面截图 `T7-AC4-03-elicitation-card.png` | PASS |
| AC-5 进行中重排 | 时钟 18:20 `report_delay turkey 20`；另起：重建表 B 后 18:40 `report_delay turkey.rest 15` | `T7-AC1-AC7-probe.txt`：`serveAt 19:20 / original 19:00`、`table C [13 steps exact]`、`changes lists exactly the 9 moved steps with from/to`、`revision incremented`、`19:15` + `table D [13 steps exact]` | PASS |
| AC-6 跨会话状态 | `update_kitchen({cooks:3})` + `plan_dinner(share-oven)` → **SIGTERM 结束 server 进程** → 同一数据文件重启 → 新 MCP 会话 | `T7-AC1-AC7-probe.txt`：`kitchen survives a real process restart + new session`、`whats_next returns the same serveAt and the same step times`（`before restart: cooks=3 serveAt=19:00`） | PASS |
| AC-7 太晚了 | 时钟 18:00，`plan_dinner(黄金菜单,"19:00")` | `T7-AC1-AC7-probe.txt`：`isError` + `Too late to serve at 7:00 PM. The earliest I can land everything is 9:50 PM.`，且 `whats_next` 仍是原计划 | PASS |
| AC-8 看板 MCP App | 真 server（DEMO_MODE=1）+ 真 sim：直连模式 `plan_dinner` → 选 share-oven → 18:20 `whats_next` → 点 NOW 行 `+10 MIN` | `T7-AC8-01-board-serve-1900.png`（SERVE 7:00 PM、13 行、OVEN 1 · 325°F）、`T7-AC8-02-board-now-1820.png`（NOW 6:20 PM，`turkey.roast` 行 NOW + `+10 MIN`）、`T7-AC8-03-board-after-plus10.png`（SERVE 7:10 PM）；`board/test/real` 真实栈 E2E 1 passed | PASS |
| AC-9 模拟器是真 client 与 Apps 宿主 | 同一页面：连接徽章、工具列表、直连动作的真实 `tools/call`（含耗时）、elicitation 选择卡（点选后 `accept`） | `T7-AC9-01-connected.png`、`T7-AC9-toolcalls.txt`（`plan_dinner … 115 ms ✓`、`whats_next … 4 ms ✓`、`report_delay … 4 ms ✓`）、`T7-capture-log.txt`（badge 与 6 工具） | PASS |
| AC-10 代理模式 | **本机无 LLM key，不做真模型验证**：引用 SPEC §10 v1.2 主控在 macmini2 的实测定论与 `proof/AC10-macmini2-01-elicitation.png`、`proof/AC10-macmini2-02-board-reply.png`；本机补：脚本化端点 E2E（3 passed / 1 skipped）、未配置时输入框禁用截图 | `T7-AC10-03-agent-disabled.png`（输入框灰、提示 `Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env to enable agent mode`）；`npx playwright test test/e2e/agent.test.ts` → 3 passed（第 4 条真模型 AC-10 按设计 skipped） | **PASS（主控在 macmini2 用真模型实测）** |
| AC-11 Agent Skill | 读 `skills/dinner-tower/SKILL.md`；跑 sim 单元测试断言系统提示 = SKILL 正文 + instructions + 固定句 | `T7-AC11-skill.txt`（frontmatter `name: dinner-tower`、47 行、`agent.test.ts 19 passed`）；`scripts/verify.d/31-agent.sh` 的 AC-11 静态检查全 PASS | PASS |

### 3.1 AC-1～AC-7 的取数方式（不是跑别人的测试）

`scripts/verify.d/90-proof.sh` 里嵌了一支独立探针：它自己 `spawn` 一个真的 `node_modules/.bin/tsx src/index.ts`（`PORT` 由 `node` 现取一个空闲端口、`DEMO_MODE=1`、`DEMO_CLOCK_START=13:00`、临时 `DT_DATA_FILE`、`DT_BOARD_HTML=board/dist/board.html`），用 `@modelcontextprotocol/client` 连 `/mcp`，断言全部写在探针里（黄金表 A/B/C/D 直接抄 SPEC §6.2.6）。运行记录：`proof/T7-AC1-AC7-probe.txt`（39 条 PASS、0 FAIL，末尾 `ALL PASS`）。

探针第一次跑报过一条 FAIL（`AC-7 failed plan does not touch the active plan [steps changed]`）——查出来是**探针自己的比较方式**错了：`JSON.stringify` 比较对象时键顺序随看板排序变化，改成按键逐条比对后 PASS。产品侧没有改动。

### 3.2 AC-8 / AC-9：真实 server + sim，不是测试替身

- 起法：`bash scripts/dev.sh`（`DEMO_MODE=1`，server `127.0.0.1:3001`，sim `127.0.0.1:8080`，sandbox `8081`）；Playwright headless 1280×720 打开 `http://127.0.0.1:8080/`，**没有**开浏览器窗口，也没有用 fixture server。
- 截图一律用 `prefers-reduced-motion: reduce` 打开页面（看板按 SPEC §6.4 关掉翻牌动画），这样图里读到的是最终值；等 5 秒 `changes` 高亮结束再截。
- AC-8 另有仓库自带真实栈 E2E：`npm --prefix board run test:real` → `✓ 1 test/real/board-real.spec.ts:14 › AC-8: plan, 6:20 PM NOW row, +10 MIN, SERVE 7:10 PM (1.7s) 1 passed`。

### 3.3 数据全链路：看板 DOM ↔ structuredContent

同一个页面里，把工具调用记录里的 `result.structuredContent`（浏览器真的收到的那一份）与看板 iframe 的 13 行 DOM 逐行比对：

| 状态 | 结果 |
| --- | --- |
| 13:00 计划完成 | `T7-AC8-board-vs-structuredContent-1300.txt`：13 rows，**0 differences**；SERVE 看板 7:00 PM ↔ structured `19:00` |
| 时钟 18:20 `whats_next` | `…-1820.txt`：13 rows，**0 differences**；SERVE 7:00 PM ↔ `19:00`，NOW 6:20 PM ↔ `18:20` |
| 点 `+10 MIN` 后 | `…-after-plus10.txt`：13 rows，**0 differences**；SERVE 7:10 PM ↔ `19:10` |

原始 `structuredContent` 三份存在 `T7-AC8-structuredContent-{1300,1820,after-plus10}.json`。抽 `turkey.roast` 一条对 SPEC §6.2.6 表 B：structured `15:30–18:30`，看板行 `3:30 PM | Roast the turkey | OVEN 1 · 325°F`，一致。

## 4. `scripts/verify.sh` 运行记录

命令（在带本票改动的 checkout 上，先 `npm --prefix <pkg> install` 与 `npm --prefix board run build`、`npm --prefix sim run build`）：

```bash
bash scripts/verify.sh        # 第 1 次：52 PASS，1 SKIP，exit 0
bash scripts/verify.sh        # 第 2 次：52 PASS，1 SKIP，exit 0
bash scripts/verify.sh --ci   # CI 模式：41 PASS，12 SKIP，exit 0
```

两次完整运行**逐字节相同**：`sha256(fab3afb2…)`，`diff` 为空。

```text
PASS  文档存在 docs/00-BRIEF.md
PASS  文档存在 docs/01-SPEC.md
PASS  文档存在 docs/02-TICKETS.md
PASS  文档存在 docs/03-PROCESS.md
PASS  文档存在 docs/04-PROOF.md
PASS  文档存在 docs/05-SUBMISSION.md
PASS  没有提交 .env
PASS  T1 scheduler 单元测试（表 A/B/C/D、选项文案、earliest、validatePlan）
PASS  T1 scheduler 类型检查（tsc --noEmit）
PASS  server: typecheck
PASS  server: integration tests (real process · stateful Streamable HTTP)
PASS  server: catalog has the 10 SPEC dishes
PASS  T4 plan: typecheck
PASS  T4 plan: planning tools + elicitation + restart (plan.test.ts, plan-persistence.test.ts)
PASS  T3 sim 依賴版本鎖定（SPEC §6.0）
PASS  T3 sim 頁腳明示模擬（SPEC §6.5）
PASS  T3/T6 sim /api/chat 接到 LLM 代理
PASS  T3 sim 沙箱代理走獨立來源
PASS  T3 AC-9 sim 單元測試（vitest）
PASS  T3 AC-9 sim E2E（Playwright headless + fixture server）
PASS  T6 AC-11 Skill 有 Agent Skills frontmatter（name/description）
PASS  T6 AC-11 Skill 正文写明工作流（4 个工具 + 冲突 + 12 小时制）
PASS  T6 AC-11 Skill 正文 ≤ 80 行且不含 frontmatter 以外的 YAML
PASS  T6 AC-10 系统提示由 SKILL 正文 + instructions + 固定句组成（§6.5）
PASS  T6 /api/chat 转发到 ${LLM_BASE_URL}/chat/completions（tool_choice auto、temperature 0.2）
PASS  T6 密鑰只在伺服器端（頁面代碼不引用 LLM_API_KEY）
PASS  T6 未配置 LLM 時輸入框禁用並顯示 §6.5 提示文案
PASS  T6 最多 6 轮工具调用
PASS  T6 工具结果回填去掉 kitchen、steps 只留 4 个字段
PASS  T6 语音用 speechSynthesis 且有开关
PASS  T6 scripts/dev.sh 一键启动（board 可选、DEMO_MODE=1、Ctrl-C 一起停）
PASS  T6 README Quick start 在「文档组织」之前且覆盖前置/install/.env/dev.sh/8080
PASS  T6 .env.example 已列出 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
PASS  T6 F1 dev.sh 用 .env.example 的空值副本也能起、TERM 后端口全释放（Quick start 回归）
PASS  T6 AC-10/AC-11 sim 单元测试（系统提示含 SKILL 正文、工具映射、结果精简、循环、/api/chat）
PASS  T6 代理模式 E2E（真实 MCP server + 脚本化 LLM 端点；AC-10 在无密鑰时跳过）
SKIP  T6 AC-10 代理模式 E2E（真实 LLM）—— .env 里没有 LLM_API_KEY（need_local；见 docs/process/T6.md 第 6 节）
PASS  T5 board 依賴版本鎖定（SPEC §6.0）
PASS  T5 board 單文件入口 board/board.html
PASS  T5 board 用 App.callServerTool 回調伺服器
PASS  T5 board NOW 行 +10 MIN 調 report_delay
PASS  T5 board 衝突橫幅調 plan_dinner（帶 option）
PASS  T5 board 12 小時制格式化
PASS  T5 board 翻牌尊重 prefers-reduced-motion
PASS  T5 board 變化行高亮 5 秒
PASS  T5 board 沒有 Amazon 商標字樣或圖形
PASS  T5 board 產品代碼不引用測試夾具
PASS  T5 board 構建單文件（vite + singlefile）
PASS  T5 board dist/board.html 自包含無外部請求
PASS  T5 board 單元測試（vitest：格式化・徽章・工位・時間軸）
PASS  T5 AC-8 測試宿主 E2E（Playwright headless）
PASS  T5 AC-8 真實 server（DEMO_MODE=1）+ sim 端到端
PASS  T7 独立探针：AC-1..AC-7（真 server 进程 · 真 Streamable HTTP · 表 A/B/C/D · 真重启）
ALL PASS
```

第 2 次运行输出与上面完全一致：

```text
$ diff <(bash scripts/verify.sh 2>&1) <(bash scripts/verify.sh 2>&1) ; echo $?
0
$ shasum -a 256 verify-run1.log verify-run2.log
fab3afb20f5567ac44abd39c8243d3805ff1c93a72b825a04aa44cfcf3e832cc  verify-run1.log
fab3afb20f5567ac44abd39c8243d3805ff1c93a72b825a04aa44cfcf3e832cc  verify-run2.log
```

（唯一 SKIP 是 T6 的真模型 AC-10：`.env` 里没有 `LLM_API_KEY`，与本票前提一致。）

`--ci` 完整输出：

```text
PASS  文档存在 docs/00-BRIEF.md
PASS  文档存在 docs/01-SPEC.md
PASS  文档存在 docs/02-TICKETS.md
PASS  文档存在 docs/03-PROCESS.md
PASS  文档存在 docs/04-PROOF.md
PASS  文档存在 docs/05-SUBMISSION.md
PASS  没有提交 .env
PASS  T1 scheduler 单元测试（表 A/B/C/D、选项文案、earliest、validatePlan）
PASS  T1 scheduler 类型检查（tsc --noEmit）
PASS  server: typecheck
PASS  server: integration tests (real process · stateful Streamable HTTP)
PASS  server: catalog has the 10 SPEC dishes
PASS  T4 plan: typecheck
PASS  T4 plan: planning tools + elicitation + restart (plan.test.ts, plan-persistence.test.ts)
PASS  T3 sim 依賴版本鎖定（SPEC §6.0）
PASS  T3 sim 頁腳明示模擬（SPEC §6.5）
PASS  T3/T6 sim /api/chat 接到 LLM 代理
PASS  T3 sim 沙箱代理走獨立來源
SKIP  T3 AC-9 sim 單元測試（vitest）（CI 模式，需本地环境）
SKIP  T3 AC-9 sim E2E（Playwright headless + fixture server）（CI 模式，需本地环境）
PASS  T6 AC-11 Skill 有 Agent Skills frontmatter（name/description）
PASS  T6 AC-11 Skill 正文写明工作流（4 个工具 + 冲突 + 12 小时制）
PASS  T6 AC-11 Skill 正文 ≤ 80 行且不含 frontmatter 以外的 YAML
PASS  T6 AC-10 系统提示由 SKILL 正文 + instructions + 固定句组成（§6.5）
PASS  T6 /api/chat 转发到 ${LLM_BASE_URL}/chat/completions（tool_choice auto、temperature 0.2）
PASS  T6 密鑰只在伺服器端（頁面代碼不引用 LLM_API_KEY）
PASS  T6 未配置 LLM 時輸入框禁用並顯示 §6.5 提示文案
PASS  T6 最多 6 轮工具调用
PASS  T6 工具结果回填去掉 kitchen、steps 只留 4 个字段
PASS  T6 语音用 speechSynthesis 且有开关
PASS  T6 scripts/dev.sh 一键启动（board 可选、DEMO_MODE=1、Ctrl-C 一起停）
PASS  T6 README Quick start 在「文档组织」之前且覆盖前置/install/.env/dev.sh/8080
PASS  T6 .env.example 已列出 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
SKIP  T6 F1 dev.sh 用 .env.example 的空值副本也能起、TERM 后端口全释放（Quick start 回归）（CI 模式，需本地环境）
SKIP  T6 AC-10/AC-11 sim 单元测试（系统提示含 SKILL 正文、工具映射、结果精简、循环、/api/chat）（CI 模式，需本地环境）
SKIP  T6 代理模式 E2E（真实 MCP server + 脚本化 LLM 端点；AC-10 在无密鑰时跳过）（CI 模式，需本地环境）
SKIP  T6 AC-10 代理模式 E2E（真实 LLM）—— .env 里没有 LLM_API_KEY（need_local；见 docs/process/T6.md 第 6 节）
PASS  T5 board 依賴版本鎖定（SPEC §6.0）
PASS  T5 board 單文件入口 board/board.html
PASS  T5 board 用 App.callServerTool 回調伺服器
PASS  T5 board NOW 行 +10 MIN 調 report_delay
PASS  T5 board 衝突橫幅調 plan_dinner（帶 option）
PASS  T5 board 12 小時制格式化
PASS  T5 board 翻牌尊重 prefers-reduced-motion
PASS  T5 board 變化行高亮 5 秒
PASS  T5 board 沒有 Amazon 商標字樣或圖形
PASS  T5 board 產品代碼不引用測試夾具
SKIP  T5 board 構建單文件（vite + singlefile）（CI 模式，需本地环境）
SKIP  T5 board dist/board.html 自包含無外部請求（CI 模式，需本地环境）
SKIP  T5 board 單元測試（vitest：格式化・徽章・工位・時間軸）（CI 模式，需本地环境）
SKIP  T5 AC-8 測試宿主 E2E（Playwright headless）（CI 模式，需本地环境）
SKIP  T5 AC-8 真實 server（DEMO_MODE=1）+ sim 端到端（CI 模式，需本地环境）
SKIP  T7 独立探针：AC-1..AC-7（真 server 进程 · 真 Streamable HTTP · 表 A/B/C/D · 真重启）（CI 模式，需本地环境）
ALL PASS
```

## 5. 失败项、密钥扫描与交回

### 5.1 失败项（交回，不在本票修）

**FAIL-1（README Quick start 缺 `npm --prefix sim run build`，页面 503）**

- 归属票：**T6**（`scripts/dev.sh` 与根 README 的 Quick start 都是 T6 交付的，SPEC §10「2026-10-20 README Quick start 補 board install」那条同源）；README 的最终措辞归 T9 包装票。
- 复现（全新 clone，照 README 走到最后一步）：

```bash
git clone https://github.com/hanshou101/hackathon-2026-amazon-alexa t7-fresh && cd t7-fresh
npm --prefix server install && npm --prefix sim install && npm --prefix board install && npm --prefix scheduler install
cp .env.example .env
bash scripts/dev.sh          # 打印 "Dinner Tower is up"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:8080/
```

- 实际输出：

```text
[sim] <clone>/sim/dist/index.html is missing — run: npm --prefix sim run build
Simulator: http://127.0.0.1:8080
…
Dinner Tower is up:
  Simulator  http://localhost:8080
…
HTTP 503
body: Simulator is not built. Run: npm --prefix sim run build
```

- 影响：评委照 README 走，打开的就是一个 503 文本页，看不到看板、看不到对话、看不到任何产品行为；`dev.sh` 的就绪探针打的是 `/api/config`（一直 200），所以它照样打印「Dinner Tower is up」，误导性更强。AC-8、AC-9 在 README 路径下无法复现。
- 修法建议（给 T6）：`scripts/dev.sh` 在构建 board 之后加一行 `npm --prefix sim run build`（或在 `sim/package.json` 加 `prepare`），根 README 的 Quick start 补这条命令；`dev.sh` 的就绪探针改为探 `GET /` 而不是 `/api/config`。
- 本票的证据：`proof/T7-README-quickstart.txt`。本票不改产品代码、也不改 README。

### 5.2 密钥扫描

命令（在仓库根，扫全部历史）：

```bash
git log -p | grep -inE "api[_-]?key|secret|token|password|sk-[a-z0-9]{16,}"
```

- 全量 `git log -p` 27398 行；上面这条命中 **45 行**，逐条判读（45 行全部看过，没有一条是凭证值）：

| 命中类型 | 条数 | 判读 |
| --- | --- | --- |
| `token` 作循环变量（`board/src/flip.ts` 的 `for (const token of text.split(/(\s+)/))`） | 4 | 代码标识符，不是凭证 |
| 环境变量名 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`（代码、测试、README、SPEC、verify 脚本、process 文档） | 29 | 只有键名，没有值；`.env.example` 对应行是 `LLM_API_KEY=`（空） |
| 测试里的假凭证 `sk-test-secret`、`stub-key-not-a-secret` | 4 | 测试夹具；另有一条断言「body 里不出现 `sk-test-secret`」 |
| 代码里的 `apiKey` 标识符（`chat-handler.ts` / `agent.test.ts` 等，值来自 `process.env.LLM_API_KEY`） | 6 | 变量名与读取路径，不含值 |
| 文档复述扫描命令本身（`AGENTS.md` §4.5）、T6 friction 里的 `*_API_KEY` 字样 | 2 | 说明文字 |

- 追加检查：`grep -ioE "sk-[A-Za-z0-9_-]{10,}"` 全历史只回 `sk-test-secret`；`grep -ioE "\b[a-f0-9]{32,}\b"` 只回 git commit SHA。
- `git ls-files .env` 为空；`.env.example` 全部键值为空。
- **判定：无真实密钥进入仓库历史。**

### 5.3 其它观察（不构成失败项）

- 看板 `changes` 高亮那 5 秒内截图，TIME 列首字会被左边缘裁掉（读起来像把 `6:37` 看成 `3:37`）；同一行的 `getBoundingClientRect` 在高亮前后完全相同（cell x=14、宽 84，DOM 文本 `6:37 PM`），高亮结束后渲染恢复正常——量到的差异只在 Chromium 截图光栅化这一层，不是布局或数据问题。测试与录屏（T9）如果在同窗口截图/录屏，可能撞上，已写进 `docs/friction/T7.md`。
- `proof/AC10-macmini2-*.png` 是主控在第二台 Mac mini 上用真模型（`GLM-5.3-FLASH`）跑出来的，本票只引用、没有复跑。

## 主控複核（閘 C，2026-10-20）

- **FAIL-1 已修**：照 README 啟動後頁面回 503。本 PR 改了 `scripts/dev.sh` 三處：
  - 啟動前先 `npm --prefix sim run build`；
  - 模擬器的就緒探針改成探 `GET /`；
  - 兩段就緒輪詢逾時就報錯退出，不再照樣印「is up」。

  F1 回歸檢查（`scripts/verify.d/31-agent.sh`）加上「頁面 `GET /` 回 200」的斷言。
- **主控在 macmini2 上複驗**：全新 clone、沒有 `sim/dist`，照 README 逐字走：
  - `bash scripts/dev.sh` 4 秒就緒，`GET /` 回 200；
  - 無頭瀏覽器打開頁面，連上 `dinner-tower 1.0.0 · MCP 2025-11-25`，列出 6 個工具，沒有頁面錯誤；
  - 帶真模型 key 跑 `bash scripts/verify.sh`：53 PASS / 0 SKIP / 0 FAIL。
- **閘 C 的產品部分通過**：AC-1～AC-11 全部 PASS，其中 AC-10 是主控在 macmini2 用真模型實測的（SPEC §10 v1.2）。AC-12（視頻）、AC-13（提交包）在 T9 驗收時判。
