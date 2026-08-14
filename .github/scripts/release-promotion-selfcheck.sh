#!/usr/bin/env bash
# #1007 (AC4): build-once promotion gate executed at the production eligibility
# trust boundary. Replays the deterministic AC4 rejection matrix so every
# production eligibility resolution also proves the promotion primitive is
# healthy: a regression in schema validation, digest, staging evidence, or
# dependency checks fails production eligibility closed.
#
# #1013 (AC4): the deployed-version-metadata comparison is also replayed here -
# with a MOCKED platform read (no live platform touched) so every production
# eligibility resolution proves the AC4 gate fails on a deployed digest/config
# schema that differs from the approved manifest and passes on a match. The
# SAFE-1 frozen path still gates the candidate revision.
#
# Run: bash .github/scripts/release-promotion-selfcheck.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_TEST="$REPO_ROOT/scripts/local-gates/promotion-manifest-e2e.test.sh"
AC4_TEST="$REPO_ROOT/.github/scripts/test_promote_deployed.py"

if [[ ! -f "$E2E_TEST" ]]; then
  echo "::error::promotion selfcheck: missing $E2E_TEST" >&2
  exit 1
fi
if [[ ! -f "$AC4_TEST" ]]; then
  echo "::error::promotion selfcheck: missing $AC4_TEST" >&2
  exit 1
fi

bash "$E2E_TEST"
python3 "$AC4_TEST"
