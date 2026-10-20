#!/usr/bin/env bash
# Dinner Tower demo — one command, one MP4 (AC-12, SPEC §6.7).
#
#   bash scripts/demo/make.sh              # real model when .env has the keys, else scripted
#   bash scripts/demo/make.sh --scripted   # force the scripted endpoint (SAMPLE badge)
#   bash scripts/demo/make.sh --real       # require LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
#
# Output (scripts/demo/out/):
#   dinner-tower-demo.mp4   the cut — upload this to YouTube as Public
#   dinner-tower-sample.mp4 only in scripted mode: the same cut, burned-in
#                           "SAMPLE — scripted LLM" badge, never upload it
#   timeline.json           every spoken line with its offset and audio file
#   frames/frame-*.png      five stills at the named marks
#   ffprobe.txt             stream + duration facts
#   record.log, logs/       what the recorder and both servers said
#
# Requirements: macOS (for `say`), Node 20.19+, ffmpeg via the bundled
# ffmpeg-static, and a Chromium for Playwright (installed on first run).
set -euo pipefail
cd "$(dirname "$0")/../.."

DEMO=scripts/demo
MODE=auto
for arg in "$@"; do
  case "$arg" in
    --scripted) MODE=scripted ;;
    --real) MODE=real ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg (use --scripted or --real)" >&2
      exit 2
      ;;
  esac
done

for tool in node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not on PATH" >&2; exit 1; }
done
command -v say >/dev/null 2>&1 || { echo "macOS 'say' is required for the voice-over" >&2; exit 1; }

# ---- dependencies ----------------------------------------------------------
if [ ! -d "$DEMO/node_modules" ]; then
  echo "Installing the demo pipeline's own dependencies…"
  npm --prefix "$DEMO" install --no-audit --no-fund
fi

for pkg in server sim board scheduler; do
  if [ ! -d "$pkg/node_modules" ]; then
    echo "Missing $pkg/node_modules — run: npm --prefix $pkg install" >&2
    exit 1
  fi
done

# The recording drives the built board and the built simulator page.
echo "Building board and simulator…"
npm --prefix board run build >/dev/null
npm --prefix sim run build >/dev/null

# First run on a fresh Mac downloads Chromium; a no-op when it is there.
( cd "$DEMO" && npx playwright install chromium >/dev/null 2>&1 ) || true

# ---- which model? ----------------------------------------------------------
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  for name in $(sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' .env); do
    if [ -z "${!name}" ]; then unset "$name"; fi
  done
fi

keys=0
if [ -n "${LLM_BASE_URL:-}" ] && [ -n "${LLM_API_KEY:-}" ] && [ -n "${LLM_MODEL:-}" ]; then
  keys=1
fi

if [ "$MODE" = auto ]; then
  if [ "$keys" = 1 ]; then MODE=real; else MODE=scripted; fi
fi
if [ "$MODE" = real ] && [ "$keys" != 1 ]; then
  echo "--real needs LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in the repository-root .env" >&2
  exit 1
fi
if [ "$MODE" = scripted ]; then
  echo "Mode: scripted LLM — the cut gets a burned-in \"SAMPLE — scripted LLM\" badge."
else
  echo "Mode: real model (${LLM_MODEL:-?}) — the cut is the one to upload."
fi

# ---- record → mux → frames -------------------------------------------------
mkdir -p "$DEMO/out"
rm -rf "$DEMO/out/frames" "$DEMO/out/raw" "$DEMO/out/voice" "$DEMO/out/logs" "$DEMO/out/state"
rm -f "$DEMO/out/dinner-tower-demo.mp4" "$DEMO/out/dinner-tower-sample.mp4" "$DEMO/out/audio-master.wav"
mkdir -p "$DEMO/out"

set -o pipefail
"$DEMO/node_modules/.bin/tsx" "$DEMO/record.ts" --mode="$MODE" --out="$DEMO/out" 2>&1 | tee "$DEMO/out/record.log"

"$DEMO/node_modules/.bin/tsx" "$DEMO/mux.ts" \
  --out="$DEMO/out/dinner-tower-demo.mp4" \
  --timeline="$DEMO/out/timeline.json" 2>&1 | tee "$DEMO/out/mux.log"

if [ "$MODE" = scripted ]; then
  cp "$DEMO/out/dinner-tower-demo.mp4" "$DEMO/out/dinner-tower-sample.mp4"
  echo
  echo "SAMPLE cut: $DEMO/out/dinner-tower-sample.mp4 (scripted LLM — do not upload)."
  echo "Final cut with the real model: run this on the Mac that has the keys in .env."
else
  echo
  echo "Final cut: $DEMO/out/dinner-tower-demo.mp4 — upload to YouTube as Public, then post the link."
fi

echo "Frames: $DEMO/out/frames/"
echo "Timeline: $DEMO/out/timeline.json"
