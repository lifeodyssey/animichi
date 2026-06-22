#!/usr/bin/env bash
set -euo pipefail

# E2E Test Environment Setup
# One command to start everything needed for local E2E testing.
#
# Usage: make e2e-setup    (or: bash scripts/e2e-setup.sh)
# Run tests: make e2e      (or: cd e2e && npm test)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 1/6 Starting Supabase ==="
supabase stop 2>/dev/null || true
sleep 2
docker rm -f $(docker ps -aq --filter "name=supabase") 2>/dev/null || true
mkdir -p supabase/snippets && chmod 755 supabase/snippets
sleep 2
supabase start --exclude vector,analytics --ignore-health-check
echo ""

echo "=== 2/6 Seeding test data ==="
docker exec -i supabase_db_seichijunrei-agent psql -U postgres < agent/tests/fixtures/seed.sql
echo ""

echo "=== 3/5 Serving Edge Function ==="
pkill -f "functions serve" 2>/dev/null || true
sleep 1
SITE_URL=http://localhost:3001 \
SMTP_HOST=host.docker.internal \
SMTP_PORT=54325 \
supabase functions serve send-auth-email --no-verify-jwt &
sleep 5
echo ""

echo "=== 4/5 Installing E2E dependencies ==="
cd e2e && npm ci 2>/dev/null || npm install
cd "$ROOT"
echo ""

echo "=== 5/5 Checking frontend ==="
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/ | grep -q 200; then
  echo "Frontend already running on :3001"
else
  echo ""
  echo "⚠ Frontend not running. Start it with:"
  echo "  cd frontend && npm run dev -- -p 3001"
  echo ""
  echo "Make sure frontend/.env.local has:"
  echo "  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
  echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
fi
echo ""

echo "========================================="
echo "E2E environment ready!"
echo ""
echo "Run tests:     make e2e"
echo "Run headed:    cd e2e && npm run test:headed"
echo "Run fast:      make e2e-public  (no email needed)"
echo "Mailpit UI:    http://localhost:54324"
echo "========================================="
