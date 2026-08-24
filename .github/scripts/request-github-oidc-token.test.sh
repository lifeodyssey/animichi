#!/usr/bin/env bash
# Behavioral tests for request-github-oidc-token.sh: mint writes the JWT,
# a second call overwrites it (poll refresh), missing env fails closed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/request-github-oidc-token.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

mkdir -p "$TMP/bin"
export CURL_LOG="$TMP/curl.log"
cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${CURL_LOG:?}"
echo '{"value":"fresh-token"}'
EOF
chmod +x "$TMP/bin/curl"
export PATH="$TMP/bin:$PATH"
export ACTIONS_ID_TOKEN_REQUEST_TOKEN="req-token"
export ACTIONS_ID_TOKEN_REQUEST_URL="https://example.test/oidc?foo=1"

out="$TMP/token"
bash "$SCRIPT" "animichi:github-actions:migrator" "$out"
[ "$(cat "$out")" = "fresh-token" ] || fail "minted token file"
grep -q "audience=animichi:github-actions:migrator" "$CURL_LOG" || fail "audience query"
grep -q "bearer req-token" "$CURL_LOG" || fail "bearer header"

cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo '{"value":"refreshed-token"}'
EOF
bash "$SCRIPT" "animichi:github-actions:migrator" "$out"
[ "$(cat "$out")" = "refreshed-token" ] || fail "refresh must overwrite the token file"

unset ACTIONS_ID_TOKEN_REQUEST_TOKEN
if bash "$SCRIPT" "aud" "$out" >/dev/null 2>&1; then
  fail "missing ACTIONS_ID_TOKEN_REQUEST_TOKEN must fail"
fi

echo "PASS: request-github-oidc-token.sh"
