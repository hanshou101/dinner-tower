# T6：代理模式（OpenAI 相容 LLM 工具調用迴圈）+ Agent Skill + 一鍵啟動。
# 驗收 AC-10（需密鑰，need_local）、AC-11（Skill 存在並被真實載入）。
# 靜態檢查不需要依賴，CI 可跑；測試需要 sim/node_modules、Playwright 瀏覽器與本地埠。

check "T6 AC-11 Skill 有 Agent Skills frontmatter（name/description）" bash -c '
  f=skills/dinner-tower/SKILL.md
  test -s "$f" &&
  head -1 "$f" | grep -qx -- "---" &&
  grep -qx "name: dinner-tower" "$f" &&
  grep -q "^description: Run a multi-dish dinner so every dish is ready at the same minute" "$f"'

check "T6 AC-11 Skill 正文写明工作流（4 个工具 + 冲突 + 12 小时制）" bash -c '
  f=skills/dinner-tower/SKILL.md
  for t in list_dishes plan_dinner whats_next report_delay; do grep -q "$t" "$f" || exit 1; done
  grep -q "conflict" "$f" && grep -q "12-hour" "$f"'

check "T6 AC-11 Skill 正文 ≤ 80 行且不含 frontmatter 以外的 YAML" bash -c '
  test "$(wc -l < skills/dinner-tower/SKILL.md)" -le 80'

check "T6 AC-10 系统提示由 SKILL 正文 + instructions + 固定句组成（§6.5）" bash -c '
  grep -q "buildSystemPrompt" sim/src/main.ts &&
  grep -q "skills/dinner-tower/SKILL.md\|SKILL.md" sim/src/agent/skill.ts &&
  grep -q "You are Alexa+ (simulated) on an Echo Show in the kitchen" sim/src/agent/prompt.ts'

check "T6 /api/chat 转发到 \${LLM_BASE_URL}/chat/completions（tool_choice auto、temperature 0.2）" bash -c '
  grep -q "createChatHandler" sim/server.ts &&
  grep -q "chat/completions" sim/src/agent/chat-handler.ts &&
  grep -q "tool_choice" sim/src/agent/chat-handler.ts &&
  grep -q "temperature: 0.2" sim/src/agent/chat-handler.ts'

check "T6 密鑰只在伺服器端（頁面代碼不引用 LLM_API_KEY）" bash -c '
  ! grep -rq "LLM_API_KEY" sim/src/main.ts sim/src/agent/loop.ts sim/src/agent/speech.ts sim/src/agent/tools.ts'

check "T6 未配置 LLM 時輸入框禁用並顯示 §6.5 提示文案" bash -c '
  grep -q "Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env to enable agent mode" sim/src/agent/prompt.ts &&
  grep -q "agent-input" sim/index.html &&
  grep -q "agentHint" sim/src/main.ts'

check "T6 最多 6 轮工具调用" bash -c 'grep -q "MAX_TOOL_ROUNDS = 6" sim/src/agent/loop.ts'

check "T6 工具结果回填去掉 kitchen、steps 只留 4 个字段" bash -c '
  grep -q "\"kitchen\"" sim/src/agent/compact.ts &&
  grep -q "stepId\", \"start\", \"end\", \"status\"" sim/src/agent/compact.ts'

check "T6 语音用 speechSynthesis 且有开关" bash -c '
  grep -q "speechSynthesis" sim/src/agent/speech.ts &&
  grep -q "voice-toggle" sim/index.html'

check "T6 scripts/dev.sh 一键启动（board 可选、DEMO_MODE=1、Ctrl-C 一起停）" bash -c '
  test -x scripts/dev.sh &&
  grep -q "npm --prefix board run build" scripts/dev.sh &&
  grep -q "DEMO_MODE:-1" scripts/dev.sh &&
  grep -q "trap cleanup EXIT" scripts/dev.sh &&
  grep -q "trap .exit 130. INT" scripts/dev.sh'

check "T6 README Quick start 在「文档组织」之前且覆盖前置/install/.env/dev.sh/8080" node -e '
  const fs = require("fs");
  const readme = fs.readFileSync("README.md", "utf8");
  const quick = readme.indexOf("## Quick start");
  const docs = readme.indexOf("## 文档组织");
  if (quick < 0 || docs < 0 || quick > docs) { console.error("Quick start missing or after 文档组织"); process.exit(1); }
  for (const needle of ["Node **20.19+**", "npm --prefix server install", "npm --prefix board install", "cp .env.example .env", "bash scripts/dev.sh", "http://localhost:8080", "LLM_BASE_URL"]) {
    if (!readme.includes(needle)) { console.error("README missing: " + needle); process.exit(1); }
  }'

check "T6 .env.example 已列出 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL" bash -c '
  grep -q "^LLM_BASE_URL=" .env.example &&
  grep -q "^LLM_API_KEY=" .env.example &&
  grep -q "^LLM_MODEL=" .env.example'

# F1 回归：README 的 Quick start 是「cp .env.example .env → 只填 LLM 三个键 → bash scripts/dev.sh」。
# .env.example 其余键都是空值，空值必须当成「用默认值」，否则 server 会拿到 "" 而启动失败。
# 用 ENV_FILE 指向一份 .env.example 副本（不碰仓库里的 .env），端口换开，真起真停。
need_local "T6 F1 dev.sh 用 .env.example 的空值副本也能起、页面 GET / 200、TERM 后端口全释放（Quick start 回归，含 T7 FAIL-1）" bash -c '
  set -u
  tmp=$(mktemp -d)
  trap "rm -rf \"$tmp\"" EXIT
  cp .env.example "$tmp/.env"
  printf "PORT=3301\nSIM_PORT=8380\nSANDBOX_PORT=3381\n" >> "$tmp/.env"

  ENV_FILE="$tmp/.env" bash scripts/dev.sh >"$tmp/dev.log" 2>&1 &
  pid=$!
  up=0
  for _ in $(seq 1 80); do
    if curl -fsS http://127.0.0.1:3301/health >/dev/null 2>&1 &&
       curl -fsS http://127.0.0.1:8380/api/config >/dev/null 2>&1 &&
       curl -fsS http://127.0.0.1:8380/ >/dev/null 2>&1; then up=1; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done

  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  sleep 1

  if [ "$up" != 1 ]; then
    echo "dev.sh did not come up with an empty-value .env"
    tail -20 "$tmp/dev.log"
    exit 1
  fi
  for port in 3301 8380 3381; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port $port still listening after TERM"
      exit 1
    fi
  done
  echo "dev.sh came up and stopped cleanly"'

need_local "T6 AC-10/AC-11 sim 单元测试（系统提示含 SKILL 正文、工具映射、结果精简、循环、/api/chat）" \
  bash -c 'npm --prefix sim run test:unit --silent'

need_local "T6 代理模式 E2E（真实 MCP server + 脚本化 LLM 端点；AC-10 在无密鑰时跳过）" \
  bash -c 'cd sim && npx playwright test test/e2e/agent.test.ts'

if [ -f .env ] && grep -q '^LLM_API_KEY=.' .env; then
  need_local "T6 AC-10 代理模式 E2E（真实 LLM，AC-10 原句）" \
    bash -c 'set -a; . ./.env; set +a; cd sim && npx playwright test test/e2e/agent.test.ts -g "AC-10"'
else
  echo "SKIP  T6 AC-10 代理模式 E2E（真实 LLM）—— .env 里没有 LLM_API_KEY（need_local；见 docs/process/T6.md 第 6 节）"
fi
