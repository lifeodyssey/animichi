#!/usr/bin/env bash
# Run the deterministic gate for one validated PR Verification matrix member.
set -euo pipefail

PACKAGE="${1:-}"
ROOT="$(git rev-parse --show-toplevel)"
ALLOWED="agent|catalog|contract|db|docs|doorbell|e2e|edge|infra|migrator|users|web"

[[ "$PACKAGE" =~ ^($ALLOWED)$ ]] || {
  printf 'pr-verification-gate: unknown package: %s\n' "$PACKAGE" >&2
  exit 2
}

if [ "$PACKAGE" = e2e ]; then
  # Keep this browser check in lockstep with pipeline-web's deterministic
  # emitted-worker assertions. Build the same output that pipeline-web tests,
  # serve it through Wrangler, and run real assertions instead of collection
  # only (test enumeration).
  DEV_VARS="$ROOT/apps/web/.dev.vars"
  RUNTIME_CONFIG='{"schemaVersion":1,"api":{"agentUrl":"http://127.0.0.1:9001","siteOrigin":"http://localhost:8799"},"neonAuthBaseUrl":"http://127.0.0.1:9","turnstileSiteKey":"1x00000000000000000000AA","showcaseMode":"false","featureFlags":{}}'
  WRANGLER_PID=""
  trap 'if [ -n "${WRANGLER_PID:-}" ]; then kill "$WRANGLER_PID" 2>/dev/null || true; fi; rm -f "$DEV_VARS"' EXIT

  VITE_TURNSTILE_SITE_KEY="1x00000000000000000000AA" \
    VITE_SHOWCASE_MODE=false pnpm --filter web test:integration
  printf 'RUNTIME_CONFIG=%s\n' "$RUNTIME_CONFIG" > "$DEV_VARS"
  pnpm --filter web exec wrangler dev --port 8799 &
  WRANGLER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null http://localhost:8799/; then
      break
    fi
    sleep 1
  done
  curl -sf -o /dev/null http://localhost:8799/
  E2E_WEB_BASE_URL=http://localhost:8799 \
    pnpm --dir e2e exec playwright test web-404.spec.ts web-maplibre-canary.spec.ts web-state-ownership.spec.ts
  exit 0
fi

# shellcheck source=../../scripts/local-gates/pre-push.sh
source "$ROOT/scripts/local-gates/pre-push.sh"
GATE_OUTDIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/pr-verification.XXXXXX")"
trap 'rm -rf "$GATE_OUTDIR"' EXIT
declare -F "gate_$PACKAGE" >/dev/null || {
  printf 'pr-verification-gate: no gate for workspace package: %s\n' "$PACKAGE" >&2
  exit 1
}
"gate_$PACKAGE"
