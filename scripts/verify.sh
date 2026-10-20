#!/usr/bin/env bash
# 确定性复验：把 SPEC 里每条能脚本化的验收条件写成一个 check。全部通过退出 0。
# 用法：bash scripts/verify.sh          本地完整复验
#       bash scripts/verify.sh --ci     CI 模式：need_local 标记的检查（要密钥、要本地服务）跳过并注明
set -uo pipefail
cd "$(dirname "$0")/.."

CI_MODE=0
[ "${1:-}" = "--ci" ] && CI_MODE=1
fail=0

check() {            # check "<名称>" <命令...>
  local name="$1"; shift
  if "$@" >/tmp/verify.$$.log 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"; sed 's/^/      /' /tmp/verify.$$.log | tail -20; fail=1
  fi
}
need_local() {       # need_local "<名称>" <命令...>：CI 模式跳过
  if [ "$CI_MODE" = 1 ]; then echo "SKIP  $1（CI 模式，需本地环境）"; else check "$@"; fi
}

# ---- 作战文档齐全（模板自带，别删）----
for f in docs/00-BRIEF.md docs/01-SPEC.md docs/02-TICKETS.md docs/03-PROCESS.md docs/04-PROOF.md docs/05-SUBMISSION.md; do
  check "文档存在 $f" test -s "$f"
done
check "没有提交 .env" bash -c '! git ls-files --error-unmatch .env >/dev/null 2>&1'

# ---- 验收条件（举证票按 SPEC 的 AC 编号往下加）----
# check      "AC-1 单元测试"   npm test --silent
# need_local "AC-2 健康检查"   curl -fsS http://localhost:8080/health
# 並行票各自把檢查寫進 scripts/verify.d/NN-<名字>.sh（只用上面的 check / need_local），這裡按文件名順序載入。
for vf in scripts/verify.d/*.sh; do
  [ -e "$vf" ] || continue
  # shellcheck source=/dev/null
  . "$vf"
done

rm -f /tmp/verify.$$.log
[ "$fail" = 0 ] && echo "ALL PASS" || echo "HAS FAIL"
exit $fail
