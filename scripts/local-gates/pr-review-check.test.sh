#!/usr/bin/env bash
# Public entrypoint for the required-PR-check behavioral tests (issue #1008).
# Runs the focused, directly-runnable modules:
#   - pr-review-check.core.test.sh        (AC4/AC5/AC7 core gate + brief binding)
#   - pr-review-check.boundary-collect.test.sh (collect boundary: GraphQL, threads, brief)
#   - pr-review-check.boundary-shape.test.sh   (merge-base, duplicate brief, malformed types)
#   - pr-review-check.secure-status.test.sh (trusted status producer + queue bridge)
#   - pr-review-check.boundary-jobstatus.test.sh (whole-job outcome -> final status, finding 1)
#   - pr-review-check.boundary-routing.test.sh (resolve-head fail-closed validation + inline-thread event routing, findings 1-2)
#   - pr-review-check.mutation-boundary.test.sh (collect-boundary mutation probes)
#   - pr-review-check.mutation-gate.test.sh    (gate mutation probes)
#   - pr-review-check.mutation-identity.test.sh (stable-identity + malformed-type probes)
#   - pr-review-check.repair.test.sh      (AC6 reject -> repair -> fresh approve)
# Each module exits non-zero on any failure; this runner fails fast so the
# coordinator sees the first broken module, then reports per-module results.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODULES=(
  "pr-review-check.core.test.sh"
  "pr-review-check.pending.test.sh"
  "pr-review-check.boundary-collect.test.sh"
  "pr-review-check.boundary-shape.test.sh"
  "pr-review-check.secure-status.test.sh"
  "pr-review-check.boundary-jobstatus.test.sh"
  "pr-review-check.boundary-routing.test.sh"
  "pr-review-check.mutation-boundary.test.sh"
  "pr-review-check.mutation-gate.test.sh"
  "pr-review-check.mutation-state.test.sh"
  "pr-review-check.mutation-identity.test.sh"
  "pr-review-check.repair.test.sh"
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
  echo "All pr-review-check tests passed."
else
  echo "$fail pr-review-check module(s) failed." >&2
  exit 1
fi
