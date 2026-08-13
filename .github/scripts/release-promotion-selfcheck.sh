#!/usr/bin/env bash
# #1007 (AC4): build-once promotion gate executed at the production eligibility
# trust boundary. Replays the deterministic AC4 rejection matrix so every
# production eligibility resolution also proves the promotion primitive is
# healthy: a regression in schema validation, digest, staging evidence, or
# dependency checks fails production eligibility closed.
#
# During expand/migrate this is a self-check only — the frozen SAFE-1 path
# still gates the candidate revision. #1013 replaces this with a check
# against the actual staging-tested artifact digest.
#
# Run: bash .github/scripts/release-promotion-selfcheck.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_TEST="$REPO_ROOT/scripts/local-gates/promotion-manifest-e2e.test.sh"

if [[ ! -f "$E2E_TEST" ]]; then
  echo "::error::promotion selfcheck: missing $E2E_TEST" >&2
  exit 1
fi

bash "$E2E_TEST"
