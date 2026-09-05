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
OXLINT="$SCRIPT_DIR/oxlint-changed.sh"

[ -f "$CONFIG" ] || { echo "FAIL: missing $CONFIG" >&2; exit 1; }
[ -x "$ORCH" ] || { echo "FAIL: missing executable $ORCH" >&2; exit 1; }
[ -f "$OXLINT" ] || { echo "FAIL: missing $OXLINT" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  [ "$actual" = "$expected" ] && return 0
  printf 'FAIL [%s]:\nexpected:\n%s\nactual:\n%s\n' "$label" "$expected" "$actual" >&2
  exit 1
}

# AC1: pre-commit routing reads the staged diff (the oxlint dispatcher
# calls the router with --staged; the default merge-base mode is pre-push's).
grep -qF 'changed-packages.sh' "$OXLINT" \
  || fail "oxlint dispatcher no longer calls changed-packages.sh"
grep -qF -- '--staged' "$OXLINT" \
  || fail "oxlint dispatcher lost --staged"
grep -qF "entry: bash scripts/local-gates/oxlint-changed.sh" "$CONFIG" \
  || fail "oxlint hook no longer invokes oxlint-changed.sh"
if grep -qE 'if pkg (web|catalog|users|edge|migrator)' "$CONFIG"; then
  fail "oxlint hook must not hand-write per-package pkg branches"
fi

# Old 82% floor must not come back: the orchestrator uses the canonical 87
# from apps/agent/pyproject.toml addopts and never overrides it with a CLI
# value, so a cov-fail-under=82 in the config means a weaker gate was
# reintroduced.
if grep -q "cov-fail-under=82" "$CONFIG"; then
  fail "config reintroduces the old 82% agent floor"
fi

# AC2: exactly one pre-push hook — the orchestrator — as the single surface.
# A second `stages: [pre-push]` entry means the duplicate old typecheck/unit/
# atlas/CI/docs hooks were re-added. `|| true` keeps a zero count from
# aborting under `set -e` before the fail message can print.
assert_single_prepush_hook() {
  local config="$1"
  local prepush_count
  prepush_count="$(grep -c "stages: \[pre-push\]" "$config" || true)"
  [ "$prepush_count" = "1" ] \
    || fail "expected exactly one pre-push hook, found $prepush_count"
  grep -qF "entry: bash scripts/local-gates/pre-push.sh" "$config" \
    || fail "pre-push stage no longer invokes the single orchestrator"
}
assert_single_prepush_hook "$CONFIG"

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

# A temp config with zero pre-push stages must exit nonzero AND print the
# message (the `|| true` regression): without it, `grep -c` under set -e
# aborts the file silently before fail() ever runs.
assert_zero_prepush_fails_loudly() {
  local config="$1" out="$2"
  if ( assert_single_prepush_hook "$config" ) >"$out" 2>&1; then
    fail "zero pre-push stages must exit nonzero"
  fi
}

test_zero_prepush_stages_fail_loudly() {
  local tmp
  tmp="$(mktemp)"
  printf 'repos:\n  - repo: local\n    hooks:\n      - id: oxlint\n' > "$tmp"
  assert_zero_prepush_fails_loudly "$tmp" "$tmp.out"
  grep -q "expected exactly one pre-push hook" "$tmp.out" || fail "zero pre-push stages must print the message"
  rm -f "$tmp" "$tmp.out"
  echo "ok: zero pre-push stages fail loudly with the message"
}

test_zero_prepush_stages_fail_loudly

independent_star_dirs() {
  local prefix="$1" d
  for d in "$REPO_ROOT/$prefix"/*; do
    [ -f "$d/package.json" ] || continue
    printf '%s\n' "$prefix/${d##*/}"
  done
}

independent_ws_dirs() {
  independent_star_dirs workers
  independent_star_dirs apps
  independent_star_dirs packages
  if [ -f "$REPO_ROOT/e2e/package.json" ]; then printf 'e2e\n'; fi
  if [ -f "$REPO_ROOT/infra/package.json" ]; then printf 'infra\n'; fi
}

independent_oxlint_dirs() {
  local dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    grep -q '"lint:oxlint"' "$REPO_ROOT/$dir/package.json" || continue
    printf '%s\n' "$dir"
  done <<< "$(independent_ws_dirs | sort -u)" | sort
}

test_oxlint_list_matches_independent_sot() {
  assert_eq \
    "$(independent_oxlint_dirs)" \
    "$(bash "$OXLINT" --list | sort)" \
    "oxlint --list matches the independent lint:oxlint set"
  echo "ok: oxlint --list covers every derived lint:oxlint package"
}

mutate_oxlint_skip_migrator() {
  sed 's/dir_has_oxlint_script "\$dir" || continue/[ "$dir" != workers\/migrator ] \&\& dir_has_oxlint_script "$dir" || continue/' \
    "$OXLINT"
}

assert_list_lacks_migrator() {
  if printf '%s\n' "$1" | grep -qx workers/migrator; then
    fail "mutated --list still includes workers/migrator"
  fi
}

test_oxlint_list_dropping_migrator_fails_on_copy() {
  local copy listed
  copy="$(mktemp)"
  mutate_oxlint_skip_migrator > "$copy"
  listed="$(GATE_REPO_ROOT="$REPO_ROOT" bash "$copy" --list | sort)"
  rm -f "$copy"
  [ "$listed" != "$(independent_oxlint_dirs)" ] \
    || fail "copy that skips migrator must not match the independent oxlint set"
  assert_list_lacks_migrator "$listed"
  echo "ok: dropping migrator from the oxlint list is red on a copy"
}

test_oxlint_list_matches_independent_sot
test_oxlint_list_dropping_migrator_fails_on_copy
echo "pre-commit-config.test.sh: all green"
