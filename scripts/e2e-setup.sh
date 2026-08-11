#!/usr/bin/env bash
set -euo pipefail

# E2E Test Environment Setup
#
# Auth E2E needs no Supabase (AUTH-2 #950): apps/web login is Neon Auth
# (Better Auth), and every transport in the suite is stubbed via page.route,
# so local E2E runs with just the web app up. `make dev-local` is no longer a
# prerequisite for the Playwright suite either — this script installs deps,
# and the web app supplies the surface.
#
# The one live-auth spec (e2e/web-neon-login.spec.ts) talks to the real Neon
# Auth origin and self-skips unless QA creds + a base URL are provided — no
# Supabase, no Mailpit, no email edge function anywhere in the picture.
#
# Usage: make e2e-setup    (or: bash scripts/e2e-setup.sh)
# Run tests: make e2e      (or: cd e2e && pnpm test)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 1/3 Installing E2E dependencies ==="
pnpm install --ignore-scripts --filter animichi-e2e 2>/dev/null || pnpm install --ignore-scripts
# --ignore-scripts skips ALL lifecycle scripts, including the one that would
# otherwise fetch Playwright's browser binaries — download it explicitly
# instead (same command pipeline-web.yml uses in CI) so we still never run an
# arbitrary postinstall script. --no-install forces npx to use the
# lockfile-pinned node_modules/.bin/playwright rather than fetching and
# running a package on demand.
pnpm --dir e2e exec playwright install --with-deps chromium
echo ""

echo "=== 2/3 Checking the web app ==="
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ | grep -q 200; then
  echo "Web app already running on :3000"
else
  echo ""
  echo "⚠ Web app not running. Start it with:"
  echo "  pnpm --filter web dev"
fi
echo ""

echo "=== 3/3 Auth E2E readiness ==="
echo "The live Neon login spec (web-neon-login.spec.ts) needs all three, or it skips:"
echo "  NEON_AUTH_BASE_URL (or VITE_NEON_AUTH_BASE_URL in apps/web/.env)"
echo "  QA_NEON_USER_EMAIL"
echo "  QA_NEON_USER_PASSWORD"
echo "  (See docs/ops/auth-migration-neon.md §4 Path A for what these are.)"
echo ""

echo "========================================="
echo "E2E environment ready!"
echo ""
echo "Run tests:     make e2e"
echo "Run headed:    cd e2e && pnpm run test:headed"
echo "========================================="
