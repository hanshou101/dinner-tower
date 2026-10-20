# T4（AME-854）規劃工具：plan_dinner / whats_next / report_delay、elicitation、ui:// 看板資源、thanksgiving prompt。
# 只用 verify.sh 提供的 check / need_local；兩條都能在 CI 跑（CI 只跑 verify.sh --ci，不會先 npm install）。

if [ ! -d server/node_modules ]; then
  echo "      (server/node_modules missing — npm ci)"
  npm --prefix server ci --no-audit --no-fund >/dev/null 2>&1 || true
fi

check "T4 plan: typecheck" bash -c 'npm --prefix server run typecheck --silent'

# 單獨再跑一遍 T4 的兩支集成測試：它們 spawn 真伺服器，用 DEMO_MODE 控時間，
# 逐步驟斷言 SPEC §6.2.6 表 A/B/C/D，並真的走 elicitation 與重啟。
check "T4 plan: planning tools + elicitation + restart (plan.test.ts, plan-persistence.test.ts)" \
  bash -c 'cd server && npx vitest run test/plan.test.ts test/plan-persistence.test.ts'
