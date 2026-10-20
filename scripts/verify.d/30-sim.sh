# T3：Echo 風格模擬器（真正的 MCP client + MCP Apps 宿主）— 驗收 AC-9。
# 版本鎖定與靜態檢查不需要依賴，可直接在 CI 跑；測試需要 sim/node_modules、
# Playwright 瀏覽器與本地埠，因此用 need_local。

check "T3 sim 依賴版本鎖定（SPEC §6.0）" node -e 'const p=require("./sim/package.json");const want={"@modelcontextprotocol/client":"2.3.1","@modelcontextprotocol/ext-apps":"2.0.3","vite":"8.3.4","vitest":"4.1.12","@playwright/test":"1.64.1"};for(const [k,v] of Object.entries(want)){const got=(p.dependencies&&p.dependencies[k])||(p.devDependencies&&p.devDependencies[k]);if(got!==v){console.error(k+": expected "+v+", got "+got);process.exit(1)}}'

check "T3 sim 頁腳明示模擬（SPEC §6.5）" grep -qF "Simulated Alexa+ experience · unofficial demo" sim/index.html

# T6 接上了 /api/chat 的 LLM 代理（原 T3 的 501 占位已按计划移除）。
check "T3/T6 sim /api/chat 接到 LLM 代理" grep -qF "createChatHandler" sim/server.ts

check "T3 sim 沙箱代理走獨立來源" grep -qF "SANDBOX_PORT" sim/server.ts

need_local "T3 AC-9 sim 單元測試（vitest）" bash -c 'npm --prefix sim run test:unit --silent'

need_local "T3 AC-9 sim E2E（Playwright headless + fixture server）" bash -c 'npm --prefix sim run test:e2e --silent'
