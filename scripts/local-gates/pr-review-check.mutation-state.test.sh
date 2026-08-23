#!/usr/bin/env bash
# Mutation proof for issue #1178's pending/failure distinction.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MUT="$TMP/mut"
mkdir -p "$MUT/scripts"
cp -R "$ROOT/scripts/local-gates" "$MUT/scripts/local-gates"

python3 - "$ROOT/scripts/local-gates/pr_review_check.py" "$MUT/scripts/local-gates/pr_review_check.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = '    if ack.status == "missing" or marker.status == "missing":'
assert needle in source, "pending-state branch not found"
open(dst, "w", encoding="utf-8").write(
    source.replace(needle, "    if False:  # mutated: waiting evidence is treated as success", 1)
)
PY

red="$("$MUT"/scripts/local-gates/pr-review-check.sh check "$FIX/pr-clean" 2>/dev/null)" && red_rc=0 || red_rc=$?
if [ "$red_rc" -eq 1 ] && printf '%s\n' "$red" | grep -q '"state": "success"'; then
  printf 'PASS %-52s\n' "red: dropping pending branch makes waiting evidence look green"
else
  printf 'FAIL %-52s rc=%s output=%s\n' "red: dropping pending branch makes waiting evidence look green" "$red_rc" "$red" >&2
  exit 1
fi

green="$($CHECK check "$FIX/pr-clean" 2>/dev/null)" && green_rc=0 || green_rc=$?
if [ "$green_rc" -eq 1 ] && printf '%s\n' "$green" | grep -q '"state": "pending"'; then
  printf 'PASS %-52s\n' "restore+green: waiting evidence remains pending"
else
  printf 'FAIL %-52s rc=%s output=%s\n' "restore+green: waiting evidence remains pending" "$green_rc" "$green" >&2
  exit 1
fi

echo "All pr-review-check mutation-state tests passed."
