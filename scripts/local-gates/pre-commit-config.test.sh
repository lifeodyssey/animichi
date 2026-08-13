#!/usr/bin/env bash
# Contract assertions for the hook/config wiring (AC1/AC2/AC7): the pre-commit
# router call must pass --staged, the config must not reintroduce the old 82%
# agent floor, and the pre-push stage must be exactly one orchestrator entry
# (scripts/local-gates/pre-push.sh) — the single pre-push surface.
#
# Pure file checks on the repo's own .pre-commit-config.yaml, so they are
# hermetic, need no tools beyond bash/grep, and run under any bash (no Quality
# lane, no Docker). Behavioral tests: run from scripts/local-gates/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
CONFIG="$REPO_ROOT/.pre-commit-config.yaml"
ORCH="$SCRIPT_DIR/pre-push.sh"

[ -f "$CONFIG" ] || { echo "FAIL: missing $CONFIG" >&2; exit 1; }
[ -x "$ORCH" ] || { echo "FAIL: missing executable $ORCH" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }

# AC1: pre-commit routing reads the staged diff (the router call in the
# oxlint hook must carry --staged; the default merge-base mode is pre-push's).
grep -qF "changed-packages.sh --staged" "$CONFIG" \
  || fail "pre-commit router call lost --staged"

# Old 82% floor must not come back: the orchestrator uses the canonical 87
# from apps/agent/pyproject.toml addopts and never overrides it with a CLI
# value, so a cov-fail-under=82 in the config means a weaker gate was
# reintroduced.
if grep -q "cov-fail-under=82" "$CONFIG"; then
  fail "config reintroduces the old 82% agent floor"
fi

# AC2: exactly one pre-push hook — the orchestrator — as the single surface.
# A second `stages: [pre-push]` entry means the duplicate old typecheck/unit/
# atlas/CI/docs hooks were re-added.
prepush_count="$(grep -c "stages: \[pre-push\]" "$CONFIG")"
[ "$prepush_count" = "1" ] \
  || fail "expected exactly one pre-push hook, found $prepush_count"
grep -qF "entry: bash scripts/local-gates/pre-push.sh" "$CONFIG" \
  || fail "pre-push stage no longer invokes the single orchestrator"

# #1003 regression: the real hook must never honor a route override
# (GATE_CHANGED_PACKAGES would let `GATE_CHANGED_PACKAGES=web git push` shrink
# the route and skip agent/db/infra gates). The variable must be absent from
# the real entry's executable code — which routes exclusively via the canonical
# router — and present only in the dedicated test driver (the sole
# route-injection seam). Comment prose may document the guarantee.
if grep -qE "^[[:space:]]*[^#]*GATE_CHANGED_PACKAGES" "$ORCH"; then
  fail "pre-push.sh must not honor a route override (GATE_CHANGED_PACKAGES)"
fi
grep -qF "GATE_CHANGED_PACKAGES" "$SCRIPT_DIR/pre-push-test-driver.sh" \
  || fail "pre-push-test-driver.sh lost the route-injection seam"
grep -qF 'changed="$(bash scripts/local-gates/changed-packages.sh)"' "$ORCH" \
  || fail "pre-push.sh no longer routes via the canonical changed-packages.sh"

echo "pre-commit-config.test.sh: all green"
