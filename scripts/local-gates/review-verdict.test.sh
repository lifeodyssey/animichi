#!/usr/bin/env bash
# Public entrypoint for the local review verdict gate tests (issue #1008).
# Runs the focused, directly-runnable modules:
#   - review-verdict.ac1.test.sh  (AC1 schema validation, evidence ratchet, mutation probes, digest)
#   - review-verdict.ac2.test.sh  (AC2 axis rejection / head invalidation, merge-base resolution)
#   - review-verdict.recorder.test.sh (AC6 repair-evidence recorder: local/opencode modes, hermetic digest)
# Each module exits non-zero on any failure; this runner reports per-module
# results.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODULES=(
  "review-verdict.ac1.test.sh"
  "review-verdict.ac2.test.sh"
  "review-verdict.recorder.test.sh"
)

fail=0
for module in "${MODULES[@]}"; do
  echo ">>> $module"
  if "$ROOT/scripts/local-gates/$module"; then
    echo ">>> $module passed"
  else
    echo ">>> $module failed" >&2
    fail=$((fail + 1))
  fi
  echo
done

if [ "$fail" -eq 0 ]; then
  echo "All review-verdict tests passed."
else
  echo "$fail review-verdict module(s) failed." >&2
  exit 1
fi
