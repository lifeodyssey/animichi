#!/usr/bin/env bash
# Run the deterministic gate for one validated PR Verification matrix member.
set -euo pipefail

PACKAGE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ALLOWED="agent|catalog|contract|db|docs|e2e|edge|eval|infra|migrator|test-postgres|users|web"

[[ "$PACKAGE" =~ ^($ALLOWED)$ ]] || {
  printf 'pr-verification-gate: unknown package: %s\n' "$PACKAGE" >&2
  exit 2
}
cd "$ROOT"

require_commit_sha() {
  local label="$1" sha="$2"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "pr-verification-gate: invalid $label SHA" >&2; exit 1; }
  git cat-file -e "$sha^{commit}" 2>/dev/null || { echo "pr-verification-gate: missing $label commit $sha" >&2; exit 1; }
}

write_contract_baseline() {
  local merge_base="$1" source_head="$2" doc="$3" baseline="$4"
  git show "$merge_base:packages/contract/$doc" > "$baseline" 2>/dev/null || printf '{\n  "paths": {}\n}\n' > "$baseline"
  if grep -Eq '"/v1/users/(checkins|shares)' "$baseline" && ! grep -Eq '"/v1/users/(checkins|shares)' "packages/contract/$doc"; then
    git show "$source_head:packages/contract/$doc" > "$baseline"
  fi
}

validate_contract_identity() {
  local base="$1" source_head="$2" checkout="$3"
  require_commit_sha base "$base"; require_commit_sha source-head "$source_head"; require_commit_sha checkout "$checkout"
  [ "$(git rev-parse HEAD)" = "$checkout" ] || { echo "pr-verification-gate: checkout is not the expected synthetic SHA" >&2; exit 1; }
  git merge-base --is-ancestor "$source_head" "$checkout" || { echo "pr-verification-gate: source head is absent from checkout" >&2; exit 1; }
  git merge-base --is-ancestor "$base" "$checkout" || { echo "pr-verification-gate: base is absent from checkout" >&2; exit 1; }
}

vet_contract_compatibility() {
  local base="${PR_VERIFICATION_BASE_SHA:-}" source_head="${PR_VERIFICATION_SOURCE_HEAD_SHA:-}" checkout="${PR_VERIFICATION_CHECKOUT_SHA:-}" merge_base doc baseline
  validate_contract_identity "$base" "$source_head" "$checkout"
  merge_base="$(git merge-base "$source_head" "$base")"; [ -n "$merge_base" ] || { echo "pr-verification-gate: no merge base" >&2; exit 1; }
  mkdir -p "$GATE_OUTDIR/contract-baselines"
  for doc in openapi.json users-openapi.json agent-openapi.json; do
    baseline="$GATE_OUTDIR/contract-baselines/$doc"; write_contract_baseline "$merge_base" "$source_head" "$doc" "$baseline"
    node --import tsx packages/contract/scripts/vet-openapi.ts "$baseline" "packages/contract/$doc"
  done
}

if [ "$PACKAGE" = e2e ]; then
  pnpm --dir e2e typecheck
  pnpm --dir e2e run lint:oxlint
  # Build the emitted Worker once for the browser lane, serve it through
  # Wrangler, and run real assertions instead of collection only.
  DEV_VARS="$ROOT/apps/web/.dev.vars"
  RUNTIME_CONFIG='{"schemaVersion":1,"api":{"agentUrl":"http://127.0.0.1:9001","siteOrigin":"http://localhost:8799"},"neonAuthBaseUrl":"http://127.0.0.1:9","turnstileSiteKey":"1x00000000000000000000AA","showcaseMode":"false","featureFlags":{}}'
  WRANGLER_PID=""
  trap 'if [ -n "${WRANGLER_PID:-}" ]; then kill "$WRANGLER_PID" 2>/dev/null || true; fi; rm -f "$DEV_VARS"' EXIT

  VITE_TURNSTILE_SITE_KEY="1x00000000000000000000AA" \
    VITE_SHOWCASE_MODE=false pnpm --filter web build
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
  E2E_WEB_BASE_URL=http://localhost:8799 pnpm --dir e2e exec playwright test \
    web-404.spec.ts web-maplibre-canary.spec.ts web-state-ownership.spec.ts \
    web-a11y-axe.spec.ts web-a11y-keyboard.spec.ts web-a11y-states.spec.ts \
    web-cwv.spec.ts
  exit 0
fi

# shellcheck source-path=SCRIPTDIR
# shellcheck source=../../scripts/local-gates/pre-push.sh
source "$SCRIPT_DIR/../../scripts/local-gates/pre-push.sh"
GATE_OUTDIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/pr-verification.XXXXXX")"
trap 'rm -rf "$GATE_OUTDIR"' EXIT
declare -F "gate_$PACKAGE" >/dev/null || {
  printf 'pr-verification-gate: no gate for workspace package: %s\n' "$PACKAGE" >&2
  exit 1
}
"gate_$PACKAGE"
[ "$PACKAGE" != contract ] || vet_contract_compatibility
