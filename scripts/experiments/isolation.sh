#!/usr/bin/env bash
# Task 1 isolation experiments (spec §11). Raw output may hold account data: it stays outside the repo.
# Usage: scripts/experiments/isolation.sh [C0 C1 C2 C3 C23 C3M CV CA X0 X1 X1M XA | all]
set -uo pipefail

OUT="${SOMM_EXP_OUT:-${TMPDIR:-/tmp}/somm-isolation}"
PROMPT="Reply with the word ok"
MEM_PROMPT="Quote the first markdown heading of every CLAUDE.md or AGENTS.md file in your context, one per line, or reply none."
LIST_PROMPT="List the names of every skill available to you, comma-separated, nothing else."
TIMEOUT=240
REAL_HOME="$HOME"
CLAUDE_BASE=(claude -p "$PROMPT" --output-format stream-json --verbose --model haiku --no-session-persistence)
CODEX_BASE=(codex exec --json --ephemeral -s read-only)
mkdir -p "$OUT"

probe() { # dir name
  mkdir -p "$1"
  printf -- '---\nname: %s\ndescription: somm isolation probe. Do not use.\n---\nDo nothing.\n' "$2" >"$1/SKILL.md"
}

new_project() { # dir
  mkdir -p "$1"
  git -C "$1" init -q
  probe "$1/.claude/skills/somm-probe" somm-probe
  probe "$1/.agents/skills/somm-probe" somm-probe
}

run() { # name workdir cmd...
  local name=$1 dir=$2; shift 2
  local marker="$OUT/$name.marker"
  touch "$marker"; sleep 1
  (cd "$dir" && perl -e 'alarm shift; exec @ARGV' "$TIMEOUT" "$@") \
    >"$OUT/$name.jsonl" 2>"$OUT/$name.stderr" </dev/null
  echo "exit=$?" >"$OUT/$name.exit"
  find "$REAL_HOME/.claude" "$REAL_HOME/.agents" "$REAL_HOME/.codex" "$REAL_HOME/.claude.json" \
    -newer "$marker" -type f 2>/dev/null >"$OUT/$name.writes"
  echo "$name: $(cat "$OUT/$name.exit"), $(wc -l <"$OUT/$name.writes" | tr -d ' ') real-config writes"
}

exp() {
  local t w; t=$(mktemp -d); w="$t/project"; new_project "$w"
  case $1 in
    C0) run C0 "$w" "${CLAUDE_BASE[@]}" ;;
    C1) probe "$t/.claude/skills/somm-probe-home" somm-probe-home
        run C1 "$w" env HOME="$t" "${CLAUDE_BASE[@]}" ;;
    C2) probe "$t/cfg/skills/somm-probe-config" somm-probe-config
        run C2 "$w" env CLAUDE_CONFIG_DIR="$t/cfg" "${CLAUDE_BASE[@]}" ;;
    C3) run C3 "$w" "${CLAUDE_BASE[@]}" --setting-sources project,local --strict-mcp-config ;;
    C23) probe "$t/cfg/skills/somm-probe-config" somm-probe-config
        run C23 "$w" env CLAUDE_CONFIG_DIR="$t/cfg" "${CLAUDE_BASE[@]}" \
          --setting-sources project,local --strict-mcp-config ;;
    C3M) run C3M "$w" claude -p "$MEM_PROMPT" --output-format stream-json --verbose --model haiku \
          --no-session-persistence --setting-sources project,local --strict-mcp-config ;;
    CV) run CV "$w" claude -p "$PROMPT" --output-format stream-json --model haiku --no-session-persistence ;;
    CA) run CA "$w" env -u ANTHROPIC_API_KEY "${CLAUDE_BASE[@]}" --bare ;;
    X0) run X0 "$w" "${CODEX_BASE[@]}" -C "$w" "$LIST_PROMPT" ;;
    X1) probe "$t/.agents/skills/somm-probe-home" somm-probe-home
        run X1 "$w" env HOME="$t" CODEX_HOME="$REAL_HOME/.codex" \
          "${CODEX_BASE[@]}" --ignore-user-config -C "$w" "$LIST_PROMPT" ;;
    X1M) run X1M "$w" env HOME="$t" CODEX_HOME="$REAL_HOME/.codex" \
          "${CODEX_BASE[@]}" --ignore-user-config -C "$w" "$MEM_PROMPT" ;;
    XA) mkdir -p "$t/.codex"; run XA "$w" env -u CODEX_API_KEY -u OPENAI_API_KEY HOME="$t" CODEX_HOME="$t/.codex" \
          "${CODEX_BASE[@]}" --ignore-user-config -C "$w" "$PROMPT" ;;
    *) echo "unknown experiment: $1" >&2; return 1 ;;
  esac
  rm -rf "$t"
}

[ $# -eq 0 ] || [ "$1" = all ] && set -- CV CA C0 C1 C2 C3 C23 C3M X0 X1 X1M XA
for e in "$@"; do exp "$e"; done
echo "raw output: $OUT"
