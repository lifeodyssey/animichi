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

ACTIONLINT_BIN="$FAKE" FAKE_STATUS=0 FAKE_OUTPUT="" bash .github/scripts/run-actionlint.sh
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=0 FAKE_OUTPUT="unexpected success output
" bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "actionlint success output was suppressed"; exit 1
fi
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=0 FAKE_OUTPUT=$'\n' \
  bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "actionlint newline-only output was suppressed"; exit 1
fi
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=1 FAKE_OUTPUT=".github/workflows/cd.yml:1:1: invalid workflow
" bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "actionlint failure was suppressed"; exit 1
fi
if ACTIONLINT_BIN="$FAKE" FAKE_STATUS=2 bash .github/scripts/run-actionlint.sh >/dev/null 2>&1; then
  echo "actionlint failure without diagnostics was suppressed"; exit 1
fi
echo "run-actionlint: zero diagnostics required"
