# T1 排程引擎（AME-851）：SPEC §6.2 的单元测试与类型检查。
# 由 scripts/verify.sh source，只用它提供的 check / need_local；两条都能在 CI 跑。

if [ ! -d scheduler/node_modules ]; then
  check "T1 scheduler 安装依赖（npm ci）" npm --prefix scheduler ci --no-audit --no-fund
fi

check "T1 scheduler 单元测试（表 A/B/C/D、选项文案、earliest、validatePlan）" npm --prefix scheduler test --silent
check "T1 scheduler 类型检查（tsc --noEmit）" npm --prefix scheduler run typecheck --silent
