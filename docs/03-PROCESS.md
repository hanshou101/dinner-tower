# 03-PROCESS：过程打卡与稽核表

> 施工票的六步打卡寫在各自的 `docs/process/Tn.md`（格式見 `docs/process/README.md`）；本文件只放索引與稽核表。稽核票只在文末「稽核表」寫判定，不改各票打卡。
> 這樣拆的原因：階段 2 三張票並行，同改一張表必衝突（SPEC §10 決策記錄）。

## 每票打卡（索引）

| 票 | Multica 子單 | 打卡文件 | Friction 文件 |
| --- | --- | --- | --- |
| T1 排程引擎 | AME-851 | `docs/process/T1.md` | `docs/friction/T1.md` |
| T2 MCP server 骨架 | AME-852 | `docs/process/T2.md` | `docs/friction/T2.md` |
| T3 Echo 模擬器骨架 | AME-853 | `docs/process/T3.md` | `docs/friction/T3.md` |
| T4 規劃工具 | AME-854 | `docs/process/T4.md` | `docs/friction/T4.md` |
| T5 出發看板 | AME-855 | `docs/process/T5.md` | `docs/friction/T5.md` |
| T6 代理模式 + Skill | AME-856 | `docs/process/T6.md` | `docs/friction/T6.md` |
| T7 舉證 | AME-857 | `docs/process/T7.md` | `docs/friction/T7.md` |

## 稽核表

> 稽核日期：2026-10-20（T8，AME-858）· 稽核依據：AGENTS.md 第 4.5 節

| 票 | 证据齐 | 测试先行且通过 | PR 已合并 | 无范围外改动 | 无造假 | 无密钥 | 判定 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1（AME-851） | ✔ | ✔ | ✔ #3 #4 | ✔ | ✔ | ✔ | PASS | 无。打卡 §5 的 `gh pr view` 原文由 #4 补（#3 首发时无法写合并后输出）。 |
| T2（AME-852） | ✔ | ✔ | ✔ #2 | ✔ | ✔ | ✔ | PASS | `docs/process/T2.md` §5 无 `gh pr view` 原始输出（`docs/process/README.md` 要求）；§2 把 `server/test/{helpers,client}` 写成 `*.test.ts`，与交付文件名不符（笔误）。 |
| T3（AME-853） | ✔ | ✘ | ✔ #6 #7 | ✔ | ✔ | ✔ | FAIL | `docs/process/T3.md:38-40` 自认：单元测试（11 条）在实现后才写、无红灯记录；§2 的 E2E 红是沙箱缺 `/assets` 的真实缺陷，不是「功能未实现而失败」；§5 原文由 #7 补。 |
| T4（AME-854） | ✔ | ✔ | ✔ #8 | ✘ | ✔ | ✔ | FAIL | 6 个文件（2 组）超出「只改这些路径」：`scheduler/src/{index,options,replan,schedule,validate}.ts`（NodeNext 补 `.js`）、`server/test/mcp-protocol.test.ts`（「恰好 3 个工具」放宽）。**主控已接受（SPEC §10）**；依 §4.5 仍判 FAIL。 |
| T5（AME-855） | ✔ | ✔ | ✔ #11 #12 | ✔ | ✔ | ✔ | PASS | E2E 首红是测试自己写错（烤鸡徽章、手部泳道合并），非功能缺失；单测有真红灯（`docs/process/T5.md:13-36`）。§5 原文由 #12 补。 |
| T6（AME-856） | ✔ | ✘ | ✔ #9 #10 | ✘ | ✔ | ✔ | FAIL | ①`docs/process/T6.md:13-26` 先实现后补测试，首红是测试自身 `ReferenceError: tools is not defined`；②`scripts/verify.d/30-sim.sh` 改一行（T3 的档案），**主控已接受（SPEC §10）**；③AC-10 本机 skip，证据是主控在 macmini2 代跑（SPEC §10 v1.2、`proof/AC10-macmini2-*.png`）；④`docs/process/T6.md:179` 引用的 `T6-agent-04-live-conversation.png` 不在 `proof/`。 |

### 稽核依据与方法（T8 实跑，2026-10-20）

- **PR 状态**：`gh pr view <号> --json number,state,mergedAt,mergeCommit` 逐个跑过，10 个 PR（#2 #3 #4 #6 #7 #8 #9 #10 #11 #12）全为 `MERGED`，合并时间 2026-10-20T02:58:45Z–07:46:42Z，squash commit 均落在 main（HEAD `18b2a45`）。
- **测试通过（独立复跑，不是转抄打卡）**：node v20.19.4，main `18b2a45` 上 `npm ci` 后跑——`scheduler` 39 passed、`server` 35 passed、`sim test:unit` 30 passed、`board test:unit` 18 passed，合计 122 条全绿。
- **本地 `bash scripts/verify.sh`**（main `18b2a45`）：`50 PASS / 1 SKIP / 1 FAIL`。唯一 FAIL 是 `T5 AC-8 真實 server（DEMO_MODE=1）+ sim 端到端`——3001 当时被并行的 T7 举证 run（`ame-857-…/t7-fresh`，PID 13419）占着，Playwright 的 `webServer`（`reuseExistingServer:false`）直接报 `http://127.0.0.1:3001/health is already used`，属环境冲突不是产品缺陷，该路径由 T7 验证。SKIP 是 `T6 AC-10`（无 `LLM_API_KEY`）。
- **CI**：`verify` run `39393730602`（push 到 main）`success`；`--ci` 模式下 `need_local` 全部 `SKIP`（E2E、board 构建、dev.sh 回归、AC-10）。
- **测试先行的时序**：squash 合并抹掉提交顺序，无法从 git 复原「红在绿前」，只能看 `docs/process/Tn.md` §2 记录的失败输出。T1/T2/T4/T5 的红灯是「模块不存在 / 进程起不来」这类真缺失；T3/T6 自己写明没有做到（见上表）。
- **写死数据 / stub**：`grep -rn "fixtures" board/src sim/src server/src scheduler/src` 只命中 2 处注释（`server/src/plan/board.ts:27`、`server/src/catalog.ts:6`），产品代码零引用；`scheduler/fixtures/thanksgiving.json` 只被 `scheduler/test/helpers.ts:1` 引用；`server/test/fixtures/board.html` 只经 `DT_BOARD_HTML` 测试注入；`board/test/harness/fixture-server.ts` 只在测试宿主里起。`DEMO_MODE` 时钟是 SPEC §7 明列的允许 mock。`sim` 的 `STUB-MODEL` 截图如实标注，未冒充真模型。
- **密钥**：`git ls-files` 只有 `.env.example`（全为空值键名），`.env` 在 `.gitignore`；`git log -p --all | grep -inE "api[_-]?key|secret|token|password|sk-[a-z0-9]{16,}"` 89 处命中全是变量名、文档、`stub-key-not-a-secret` 测试值，无 `sk-` 形态的真实密钥。`docs/friction/T6.md:7-9` 只描述了机器上没有可用端点，未写入任何 key 值。
- **截图抽验**：`proof/T3-02-app-rendered.png`（fixture-tower 的 MCP App 在沙箱内渲染，含 args 与工具结果）、`proof/T5-board-1300.png`（SERVE 7:00 PM、DEMO CLOCK、五列表格与时间轴）、`proof/T6-agent-02-conversation.png`（AGENT MODE 标 `STUB-MODEL`，看板未构建时如实报 `Board UI not built`）、`proof/AC10-macmini2-02-board-reply.png`（AGENT MODE `GLM-5.3-FLASH`、真实模型回覆与看板同屏）——与各自打卡文件的描述一致。

### 闸 B 结论

- **功能面**：T1–T6 的交付物都在 main 上，10 个 PR 全 `MERGED`，122 条测试独立复跑全过，CI 绿；无造假、无密钥、无未合并 PR。六票的验收条件逐条都有证据（T6 的 AC-10 是主控代跑）。
- **过程面**：3 票 FAIL——T3、T6 未做到测试先行；T4、T6 有超出路径清单的改动（其中 T4 的两组、T6 的一处主控已在 SPEC §10 接受）。
- **「我们走完整个流程了吗？」**：按 §4.5 逐格判定，答案是「还没有全数走完」——缺口全部在过程记录，不影响产品可运行性；是否放行下一阶段（T9）由主控拍板。
- **建议**：①若要闸 B 全绿，需主控在 SPEC §10 补一条对「测试先行偏差」的统一裁定（接受或不接受）；②下一轮模板把「红→绿」输出列为 PR 必附证据（T6 §6 已提）。

### 主控複核（閘 B，2026-10-20）

- 稽核表照收，判定不改：3 PASS / 3 FAIL，FAIL 全屬過程。
- 閘 B **有條件通過**，第四階段照常推進：
  - 測試先行偏差（T3、T6）：接受，不返工。紅階段事後補不出真的；兩票的行為已由測試覆蓋且全綠，主控驗收時另用獨立探針複驗過（見 AME-838 的驗收評論）。
  - 範圍外改動（T4、T6）：SPEC §10 已接受；表裡照字面判的 FAIL 保留，作為記錄。
  - `docs/process/T6.md:179` 引的截圖不在 `proof/`：同一步驟的真模型證據是 `proof/AC10-macmini2-02-board-reply.png`。
- 回流：下一輪模板把「紅→綠」的失敗輸出列為 PR 必附證據，寫進 `docs/06-RETRO.md`。
