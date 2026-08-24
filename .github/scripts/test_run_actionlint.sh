#!/usr/bin/env bash
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAKE="$TMP/actionlint"

cat > "$FAKE" <<'SH'
#!/usr/bin/env bash
printf '%s' "${FAKE_OUTPUT:-}"
exit "${FAKE_STATUS:-0}"
SH
chmod +x "$FAKE"

line_for() { grep -nE '^  queue: max$' "$1" | cut -d: -f1; }
message='unexpected key "queue" for "concurrency" section. expected one of "cancel-in-progress", "group"'
allowed=".github/workflows/cd.yml|$(line_for .github/workflows/cd.yml)|3|$message|syntax-check
.github/workflows/rollback.yml|$(line_for .github/workflows/rollback.yml)|3|$message|syntax-check
"

ACTIONLINT_BIN="$FAKE" FAKE_STATUS=1 FAKE_OUTPUT="$allowed" bash .github/scripts/run-actionlint.sh
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=0 FAKE_OUTPUT="unexpected success output
" bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "actionlint success output was suppressed"; exit 1
fi
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=0 FAKE_OUTPUT=$'\n' \
  bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "actionlint newline-only output was suppressed"; exit 1
fi
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=1 FAKE_OUTPUT="${allowed}.github/workflows/cd.yml|1|1|other warning|syntax-check
" bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "unexpected actionlint warning was suppressed"; exit 1
fi
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=1 FAKE_OUTPUT="docs/example.yml|1|3|$message|syntax-check
" bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "queue warning outside exact target was suppressed"; exit 1
fi
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=2 bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "actionlint failure without diagnostics was suppressed"; exit 1
fi
echo "run-actionlint: exact queue diagnostics accepted; all other output rejected"
