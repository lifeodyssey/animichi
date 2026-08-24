#!/usr/bin/env bash
set -euo pipefail

ACTIONLINT_BIN="${ACTIONLINT_BIN:-actionlint}"
FORMAT='{{range .}}{{.Filepath}}|{{.Line}}|{{.Column}}|{{.Message}}|{{.Kind}}{{"\\n"}}{{end}}'
EXPECTED='unexpected key "queue" for "concurrency" section. expected one of "cancel-in-progress", "group"'
OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$OUTPUT_FILE"' EXIT

set +e
"$ACTIONLINT_BIN" -format "$FORMAT" "$@" >"$OUTPUT_FILE" 2>&1
STATUS=$?
set -e
if [ "$STATUS" -eq 0 ]; then
  [ ! -s "$OUTPUT_FILE" ] && exit 0
  cat "$OUTPUT_FILE" >&2
  exit 1
fi
OUTPUT="$(<"$OUTPUT_FILE")"
[ -n "$OUTPUT" ] || { echo "actionlint failed without diagnostics" >&2; exit "$STATUS"; }

ALLOWED=0
while IFS='|' read -r path line column message kind extra; do
  target=false
  case "$path" in .github/workflows/cd.yml|.github/workflows/rollback.yml) target=true ;; esac
  source_line=""; [[ "$line" =~ ^[0-9]+$ ]] && source_line="$(sed -n "${line}p" "$path")"
  if $target && [ "$column" = 3 ] && [ "$message" = "$EXPECTED" ] && \
    [ "$kind" = syntax-check ] && [ -z "$extra" ] && [ "$source_line" = "  queue: max" ]; then
    ALLOWED=$((ALLOWED + 1)); continue
  fi
  printf '%s\n' "$OUTPUT" >&2
  exit "$STATUS"
done <<< "$OUTPUT"

[ "$ALLOWED" -gt 0 ] || { printf '%s\n' "$OUTPUT" >&2; exit "$STATUS"; }
ruby .github/scripts/actionlint-queue-contract.rb
