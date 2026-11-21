#!/usr/bin/env bash
set -euo pipefail

# Local Login — Neon Auth (Better Auth) magic-link login for local dev.
#
# Walks Path C of docs/ops/auth-migration-neon.md §4: request a magic link from
# the per-branch Neon Auth origin, read the verification token back from the
# branch's Postgres (no inbox needed), and open the verify URL in the browser.
# The browser establishes the HttpOnly session cookie on the Neon Auth origin
# and follows the callbackURL into apps/web /auth/callback — the same path a
# real magic-link email walks, minus the inbox.
#
# Prerequisites:
#   - VITE_NEON_AUTH_BASE_URL in apps/web/.env (the Neon Auth origin; per-branch
#     value from `neonctl neon-auth status` — see docs/ops/auth-migration-neon.md)
#   - NEON_DATABASE_URL (or DATABASE_URL) pointing at the SAME branch that runs
#     Neon Auth — the magic-link token is read from its neon_auth.verification
#   - psql and jq on PATH
#   - web app running on localhost:3000
#
# Usage: make local-login
#        bash scripts/local-login.sh [email]

EMAIL="${1:-dev@animichi.test}"
WEB_ORIGIN="${LOCAL_WEB_ORIGIN:-http://localhost:3000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ENV_FILE="$ROOT/apps/web/.env"

# --- Resolve the Neon Auth base URL ------------------------------------------
BASE_URL="${NEON_AUTH_BASE_URL:-}"
if [[ -z "$BASE_URL" ]] && [[ -f "$WEB_ENV_FILE" ]]; then
  BASE_URL="$(grep -E '^VITE_NEON_AUTH_BASE_URL=' "$WEB_ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [[ -z "$BASE_URL" ]]; then
  echo "❌ No Neon Auth base URL. Set VITE_NEON_AUTH_BASE_URL in apps/web/.env" >&2
  echo "   (or export NEON_AUTH_BASE_URL)." >&2
  exit 1
fi
BASE_URL="${BASE_URL%/}"

DATABASE_URL="${NEON_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "❌ NEON_DATABASE_URL not set — need a connection string to the branch" >&2
  echo "   running Neon Auth (the magic-link token lives in its neon_auth.verification)." >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql not found on PATH. Install the PostgreSQL client, or follow" >&2
  echo "   Path B (real inbox) of docs/ops/auth-migration-neon.md §4 instead." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq not found on PATH. Install jq; it writes the magic-link request body." >&2
  exit 1
fi

echo "Sending magic link to: $EMAIL"
echo "  via: $BASE_URL"
echo "  callback: $WEB_ORIGIN/auth/callback"

# The web app sends this exact request shape (src/lib/auth/neon-auth.ts
# `sendMagicLink`). jq writes it, so a quote or a backslash in the email stays
# inside one JSON string.
magic_link_request_body() {
  jq -cn --arg email "$EMAIL" --arg callbackURL "$WEB_ORIGIN/auth/callback" \
    '{email: $email, callbackURL: $callbackURL}'
}

# `Origin` is required by Better Auth on POSTs.
curl -sS -X POST "$BASE_URL/sign-in/magic-link" \
  -H "Content-Type: application/json" \
  -H "Origin: $WEB_ORIGIN" \
  -d "$(magic_link_request_body)" >/dev/null

# --- Poll the branch's verification table for the token -----------------------
# Better Auth stores each magic link as a neon_auth.verification row whose
# `identifier` is the raw token and whose `value` is the JSON {"email": …}.
# Other flows share the table with values that are not JSON (an email OTP is
# "<code>:<attempts>"), so only a value that opens with `{` is parsed. The email
# reaches psql as the variable `email`, which `:'email'` quotes as a literal and
# the query compares whole, ignoring case as the ILIKE it replaces did: a quote,
# `%` or `_` in it cannot change the query or match another row, and an address
# the auth service stored in another case is still found. psql interpolates
# variables only in the input it reads itself, never in a `-c` string, so the
# query comes in on stdin. Read the newest matching row; the row is consumed
# (deleted) once verified, so grab it before the browser opens the link.
newest_magic_link_token() {
  psql "$DATABASE_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v email="$EMAIL" <<'SQL'
SELECT identifier FROM neon_auth.verification
WHERE lower(CASE WHEN starts_with(value::text, '{')
                 THEN value::text::jsonb ->> 'email' END) = lower(:'email')
ORDER BY "createdAt" DESC
LIMIT 1;
SQL
}

# A query error ends the login with psql's own message; only an empty answer
# (the row is not there yet) is polled again.
TOKEN=""
for _ in $(seq 1 20); do
  TOKEN="$(newest_magic_link_token)"
  [[ -n "$TOKEN" ]] && break
  sleep 1
done

if [[ -z "$TOKEN" ]]; then
  echo "❌ No magic-link token appeared in neon_auth.verification within 20s." >&2
  echo "   Check that NEON_DATABASE_URL points at the branch running Neon Auth." >&2
  exit 1
fi

ENCODED_TOKEN="$(printf '%s' "$TOKEN" | python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))')"
VERIFY_URL="$BASE_URL/magic-link/verify?token=$ENCODED_TOKEN&callbackURL=$WEB_ORIGIN/auth/callback"

echo ""
echo "✅ Magic-link token found — opening in browser..."
open "$VERIFY_URL" 2>/dev/null || echo "Open this URL: $VERIFY_URL"
