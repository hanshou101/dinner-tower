# T2（AME-852）MCP server 骨架：协议/传输、菜品目录、厨房工具、持久化、演示时钟。
# 只用 verify.sh 提供的 check / need_local。

# CI 的 verify.yml 只跑 verify.sh --ci，不會先 npm install；
# 本脚本自己补依赖（已有 node_modules 时是空操作）。
if [ ! -d server/node_modules ]; then
  echo "      (server/node_modules missing — npm ci)"
  npm --prefix server ci --no-audit --no-fund >/dev/null 2>&1 || true
fi

check "server: typecheck" bash -c 'npm --prefix server run typecheck --silent'
check "server: integration tests (real process · stateful Streamable HTTP)" bash -c 'npm --prefix server test --silent'
check "server: catalog has the 10 SPEC dishes" node -e '
const dishes = require("./server/catalog/dishes.json");
const ids = dishes.map((d) => d.id).sort().join(",");
const expected = "broccoli,gravy,green_beans,mashed_potatoes,pumpkin_pie,rice,rolls,salmon,stuffing,turkey";
if (ids !== expected) {
  console.error("unexpected dish ids: " + ids);
  process.exit(1);
}
const turkey = dishes.find((d) => d.id === "turkey");
const total = turkey.steps.reduce((n, s) => n + s.minutes, 0);
if (total !== 230) {
  console.error("turkey totalMinutes is " + total + ", expected 230");
  process.exit(1);
}
'
