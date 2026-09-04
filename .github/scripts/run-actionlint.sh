#!/usr/bin/env bash
set -euo pipefail

ACTIONLINT_BIN="${ACTIONLINT_BIN:-actionlint}"
OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$OUTPUT_FILE"' EXIT

set +e
"$ACTIONLINT_BIN" "$@" >"$OUTPUT_FILE" 2>&1
STATUS=$?
set -e
[ "$STATUS" -eq 0 ] && [ ! -s "$OUTPUT_FILE" ] || {
  cat "$OUTPUT_FILE" >&2
  [ "$STATUS" -ne 0 ] && exit "$STATUS"
  exit 1
}
ruby .github/scripts/actionlint-queue-contract.rb
