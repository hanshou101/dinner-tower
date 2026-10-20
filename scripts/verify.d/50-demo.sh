# T9（AME-859）包装：演示视频流水线的确定性检查（AC-12）。
#
# 成片不进 Git（.gitignore 排除 scripts/demo/out/ 与 *.mp4），所以：
# - 静态部分随时可跑（CI 也跑）：一条命令、驱动真实系统、产物不入库、自检断言存在；
# - 规格部分在本机有成片时才跑：ffprobe 断言时长 / 分辨率 / 编码，没有成片就 SKIP。

check "T9 AC-12 一条命令出片（make.sh 可执行，record/mux/voice/scripted-llm 齐全）" bash -c '
  test -x scripts/demo/make.sh &&
  test -s scripts/demo/record.ts &&
  test -s scripts/demo/mux.ts &&
  test -x scripts/demo/voice.sh &&
  test -s scripts/demo/scripted-llm.ts &&
  bash scripts/demo/make.sh --help | grep -q "dinner-tower-demo.mp4"'

check "T9 流水线驱动真实系统（DEMO_MODE=1、跨会话真重启 server、LLM 键读 .env）" bash -c '
  grep -q "DEMO_MODE" scripts/demo/record.ts &&
  grep -q "DEMO_CLOCK_START" scripts/demo/record.ts &&
  grep -q "restartServer" scripts/demo/record.ts &&
  grep -q "LLM_API_KEY" scripts/demo/make.sh &&
  grep -q "\.env" scripts/demo/make.sh'

check "T9 脚本化 LLM 只用于自测且成片打 SAMPLE 标（不冒充真模型）" bash -c '
  grep -q "scripted-llm" scripts/demo/record.ts &&
  grep -q "SAMPLE — scripted LLM" scripts/demo/record.ts &&
  grep -q "dinner-tower-sample.mp4" scripts/demo/make.sh'

check "T9 AC-12 自检写在 mux.ts（<179s、1280x720、H.264+AAC、5 帧）" bash -c '
  grep -q "179" scripts/demo/mux.ts &&
  grep -q "1280" scripts/demo/mux.ts &&
  grep -q "h264" scripts/demo/mux.ts &&
  grep -q "aac" scripts/demo/mux.ts'

check "T9 成片不进 Git（.gitignore 排除 out/ 与 *.mp4）" bash -c '
  grep -q "^scripts/demo/out/" .gitignore &&
  grep -q "^\*\.mp4$" .gitignore &&
  ! git ls-files --error-unmatch scripts/demo/out/dinner-tower-demo.mp4 >/dev/null 2>&1'

_t9_video() {
  local f=scripts/demo/out/dinner-tower-demo.mp4
  local dur vinfo abits w h codec
  dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f") || return 1
  vinfo=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 "$f") || return 1
  abits=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$f") || return 1
  codec=${vinfo%%,*}; w=$(echo "$vinfo" | cut -d, -f2); h=$(echo "$vinfo" | cut -d, -f3)
  [ "$codec" = "h264" ] || { echo "video codec is $codec, want h264"; return 1; }
  [ "$abits" = "aac" ] || { echo "audio codec is $abits, want aac"; return 1; }
  [ "$w" -ge 1280 ] && [ "$h" -ge 720 ] || { echo "resolution ${w}x${h}, want >= 1280x720"; return 1; }
  awk -v d="$dur" 'BEGIN { exit !(d > 0 && d < 179) }' || { echo "duration $dur s, want < 179"; return 1; }
  test "$(ls scripts/demo/out/frames/frame-*.png 2>/dev/null | wc -l | tr -d " ")" -ge 5 || {
    echo "want at least 5 stills in scripts/demo/out/frames/"; return 1; }
  echo "duration: $dur s · video: $codec ${w}x${h} · audio: $abits"
}

if [ -s scripts/demo/out/dinner-tower-demo.mp4 ] && command -v ffprobe >/dev/null 2>&1; then
  need_local "T9 AC-12 成片规格（ffprobe：<179s、>=1280x720、H.264+AAC、5 张帧）" _t9_video
else
  echo "SKIP  T9 AC-12 成片规格（本机还没有成片或没有 ffprobe：bash scripts/demo/make.sh）"
fi
