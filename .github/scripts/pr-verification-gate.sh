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
  cd "$ROOT/e2e"
  pnpm exec playwright test --list
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
