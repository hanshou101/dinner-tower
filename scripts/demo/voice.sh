#!/usr/bin/env bash
# English voice-over for the Dinner Tower demo, generated with macOS `say`.
#
#   voice.sh --list
#       Print the three role voices picked on THIS machine (role=voice).
#
#   voice.sh --one <role> <out.aiff> < text
#       Synthesise one line (text on stdin) and print "<voice>\t<durationSec>".
#
# Voices are picked from `say -v '?'` at run time — only en_US voices present on
# the machine are considered — so the pipeline runs unchanged on a Mac with a
# different voice set. Override one role with DEMO_VOICE_NARRATOR /
# DEMO_VOICE_USER / DEMO_VOICE_ALEXA, and the speed with DEMO_VOICE_RATE (wpm).
# This is why the video sounds the same on the build machine and on the Mac mini
# that records the final cut with a real model.
set -euo pipefail

RATE_NARRATOR="${DEMO_VOICE_RATE:-168}"
RATE_USER="${DEMO_VOICE_RATE_USER:-178}"
RATE_ALEXA="${DEMO_VOICE_RATE_ALEXA:-182}"

# ── the voices this Mac actually has (en_US only) ────────────────────────────
VOICES=()
while IFS= read -r name; do
  [ -n "$name" ] && VOICES+=("$name")
done < <(say -v '?' 2>/dev/null | sed -nE 's/^(.*[^[:space:]])[[:space:]]+en_US[[:space:]]+#.*$/\1/p')

if [ "${#VOICES[@]}" -eq 0 ]; then
  echo "voice.sh: no en_US voice found (say -v '?')" >&2
  exit 1
fi

has_voice() {
  local want="$1" v
  for v in "${VOICES[@]}"; do
    [ "$v" = "$want" ] && return 0
    [ "$(base_name "$v")" = "$want" ] && return 0
  done
  return 1
}

# Newer macOS releases list the same voice as "Reed (英语（美国）)"; match on the
# base name and hand the full name to `say`.
base_name() {
  printf '%s' "$1" | sed -E 's/[[:space:]]+\(.*\)$//'
}

# resolve <base-or-full name> → prints the full entry from `say -v '?'`.
resolve() {
  local want="$1" v
  for v in "${VOICES[@]}"; do
    if [ "$v" = "$want" ] || [ "$(base_name "$v")" = "$want" ]; then
      printf '%s' "$v"
      return 0
    fi
  done
  return 1
}

is_novelty() {
  case "$(base_name "$1")" in
    Albert|"Bad News"|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Fred|"Good News"|Jester|Organ|Superstar|Ralph|Trinoids|Whisper|Zarvox|Grandma|Grandpa|Junior) return 0 ;;
    *) return 1 ;;
  esac
}

pick() {
  # pick <role> [already-used names...] — prints the full name `say` accepts.
  local role="$1"; shift
  # bash 3.2 (macOS): expanding an empty array under `set -u` is an error, so
  # guard every expansion with ${arr[@]+"${arr[@]}"}.
  local used=()
  [ "$#" -gt 0 ] && used=("$@")
  local override_name="DEMO_VOICE_$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')"
  local override="${!override_name:-}"
  local v full

  if [ -n "$override" ]; then
    full="$(resolve "$override")" && { printf '%s' "$full"; return 0; }
  fi

  local prefs=()
  case "$role" in
    narrator) prefs=(Samantha Flo Shelley Sandy Ava Allison Susan Tom Alex Daniel) ;;
    user)     prefs=(Reed Rocko Tom Daniel Arthur Aaron Eddy Alex) ;;
    alexa)    prefs=(Flo Shelley Kathy Sandy Ava Allison Karen Samantha) ;;
    *)        prefs=(Samantha) ;;
  esac

  not_used() {
    local name="$1" u base
    base="$(base_name "$name")"
    for u in ${used[@]+"${used[@]}"}; do
      [ "$(base_name "$u")" = "$base" ] && return 1
    done
    return 0
  }

  for v in "${prefs[@]}"; do
    full="$(resolve "$v")" || continue
    if not_used "$full" && ! is_novelty "$full"; then printf '%s' "$full"; return 0; fi
  done
  for v in "${VOICES[@]}"; do
    if not_used "$v" && ! is_novelty "$v"; then printf '%s' "$v"; return 0; fi
  done
  for v in "${VOICES[@]}"; do
    if not_used "$v"; then printf '%s' "$v"; return 0; fi
  done
  # Only one usable voice on this machine: reuse it rather than fail.
  printf '%s' "${VOICES[0]}"
}

NARRATOR_VOICE="$(pick narrator)"
USER_VOICE="$(pick user "$NARRATOR_VOICE")"
ALEXA_VOICE="$(pick alexa "$NARRATOR_VOICE" "$USER_VOICE")"

rate_for() {
  case "$1" in
    narrator) printf '%s' "$RATE_NARRATOR" ;;
    user)     printf '%s' "$RATE_USER" ;;
    alexa)    printf '%s' "$RATE_ALEXA" ;;
    *)        printf '%s' "$RATE_NARRATOR" ;;
  esac
}

voice_for() {
  case "$1" in
    narrator) printf '%s' "$NARRATOR_VOICE" ;;
    user)     printf '%s' "$USER_VOICE" ;;
    alexa)    printf '%s' "$ALEXA_VOICE" ;;
    *)        printf '%s' "$NARRATOR_VOICE" ;;
  esac
}

if [ "${1:-}" = "--list" ]; then
  printf 'narrator=%s\nuser=%s\nalexa=%s\n' "$NARRATOR_VOICE" "$USER_VOICE" "$ALEXA_VOICE"
  exit 0
fi

if [ "${1:-}" = "--one" ]; then
  role="${2:?usage: voice.sh --one <role> <out.aiff> < text}"
  out="${3:?usage: voice.sh --one <role> <out.aiff> < text}"
  voice="$(voice_for "$role")"
  rate="$(rate_for "$role")"
  mkdir -p "$(dirname "$out")"
  # Text comes on stdin so quotes, dashes and punctuation never need escaping.
  say -v "$voice" -r "$rate" -o "$out"
  duration="$(afinfo "$out" 2>/dev/null | sed -nE 's/.*estimated duration: ([0-9.]+) sec.*/\1/p' | head -1)"
  [ -n "$duration" ] || duration="0"
  printf '%s\t%s\n' "$voice" "$duration"
  exit 0
fi

echo "usage: voice.sh --list | voice.sh --one <role> <out.aiff> < text" >&2
exit 2
