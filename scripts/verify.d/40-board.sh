# T5：出發看板 MCP App — 驗收 AC-8（SPEC §6.4）。
# 版本鎖定、原始碼約定與夾具隔離不需要依賴，CI 可跑；構建、單元測試與
# E2E（含真實 server + sim）需要各包 node_modules 與 Playwright 瀏覽器，
# 用 need_local。

check "T5 board 依賴版本鎖定（SPEC §6.0）" node -e 'const p=require("./board/package.json");const want={"@modelcontextprotocol/ext-apps":"2.0.3","vite":"8.3.4","vite-plugin-singlefile":"2.3.4","vitest":"4.1.12","@playwright/test":"1.64.1"};for(const [k,v] of Object.entries(want)){const got=(p.dependencies&&p.dependencies[k])||(p.devDependencies&&p.devDependencies[k]);if(got!==v){console.error(k+": expected "+v+", got "+got);process.exit(1)}}'

check "T5 board 單文件入口 board/board.html" test -s board/board.html

check "T5 board 用 App.callServerTool 回調伺服器" grep -qF "callServerTool" board/src/main.ts

check "T5 board NOW 行 +10 MIN 調 report_delay" grep -qF '"report_delay"' board/src/main.ts

check "T5 board 衝突橫幅調 plan_dinner（帶 option）" node -e 'const s=require("fs").readFileSync("board/src/main.ts","utf8");if(!s.includes("\"plan_dinner\"")){console.error("plan_dinner not called");process.exit(1)}if(!s.includes("option,")){console.error("option not forwarded");process.exit(2)}'

check "T5 board 12 小時制格式化" grep -qF "AM" board/src/format.ts

check "T5 board 翻牌尊重 prefers-reduced-motion" grep -qF "prefers-reduced-motion" board/src/board.css

check "T5 board 變化行高亮 5 秒" grep -qF "CHANGE_HIGHLIGHT_MS = 5000" board/src/board-view.ts

check "T5 board 沒有 Amazon 商標字樣或圖形" bash -c '! grep -qiE "amazon|alexa" board/board.html board/src/board.css board/src/board-view.ts'

check "T5 board 產品代碼不引用測試夾具" bash -c '! grep -rqE "test/fixtures|plan-1300|plan-1820|delayed\.json|conflict\.json" board/src'

need_local "T5 board 構建單文件（vite + singlefile）" bash -c 'npm --prefix board run build --silent >/dev/null'

need_local "T5 board dist/board.html 自包含無外部請求" node -e 'const fs=require("fs");const p="board/dist/board.html";if(!fs.existsSync(p)){console.error("missing "+p);process.exit(1)}const h=fs.readFileSync(p,"utf8");if(!h.includes("<html")){console.error("not an HTML document");process.exit(2)}if(/<script[^>]+src=/.test(h)||/<link[^>]+href=/.test(h)||/src="https?:|href="https?:/.test(h)){console.error("external reference found");process.exit(3)}if(!h.includes("DINNER TOWER")){console.error("board markup missing from the bundle");process.exit(4)}console.log("self-contained, bytes="+h.length);'

need_local "T5 board 單元測試（vitest：格式化・徽章・工位・時間軸）" bash -c 'npm --prefix board run test:unit --silent'

need_local "T5 AC-8 測試宿主 E2E（Playwright headless）" bash -c 'npm --prefix board run test:e2e --silent'

need_local "T5 AC-8 真實 server（DEMO_MODE=1）+ sim 端到端" bash -c 'npm --prefix board run test:real --silent'
