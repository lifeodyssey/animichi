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
#   - psql on PATH
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

echo "Sending magic link to: $EMAIL"
echo "  via: $BASE_URL"
echo "  callback: $WEB_ORIGIN/auth/callback"

# The web app sends this exact request shape (src/lib/auth/neon-auth.ts
# `sendMagicLink`). `Origin` is required by Better Auth on POSTs.
curl -sS -X POST "$BASE_URL/sign-in/magic-link" \
  -H "Content-Type: application/json" \
  -H "Origin: $WEB_ORIGIN" \
  -d "{\"email\":\"$EMAIL\",\"callbackURL\":\"$WEB_ORIGIN/auth/callback\"}" >/dev/null

# --- Poll the branch's verification table for the token -----------------------
# Better Auth stores each magic link as a neon_auth.verification row whose
# `identifier` is the raw token and whose `value` JSON names the email. Read
# the newest matching row; the row is consumed (deleted) once verified, so grab
# it before the browser opens the link.
TOKEN=""
for _ in $(seq 1 20); do
  TOKEN="$(psql "$DATABASE_URL" -tAc \
    "SELECT identifier FROM neon_auth.verification \
     WHERE identifier IS NOT NULL AND value::text ILIKE '%$EMAIL%' \
     ORDER BY \"createdAt\" DESC LIMIT 1" 2>/dev/null || true)"
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
