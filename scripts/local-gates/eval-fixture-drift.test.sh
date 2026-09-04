#!/usr/bin/env bash
# Behavioral tests for the staged-snapshot eval-fixture drift check
# (scripts/local-gates/eval-fixture-drift.sh), #1299.
#
# The check is the OpenAPI drift check's shape applied to the exported eval
# fixtures: the caller regenerates, this stages into a throwaway index and
# fails on `git diff --cached`. These tests prove a regenerated change that is
# ONLY visible in the staged snapshot is caught (an unstaged `git diff` after
# export would miss it), that an untracked new fixture is caught (`git add -A`,
# not `git add <known paths>`), that the real index is never modified, and that
# a clean tree is green. Runs in a throwaway repository.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/eval-fixture-drift.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

git init -q
git config user.email gate@test.invalid
git config user.name "gate test"
git config commit.gpgsign false
mkdir -p packages/eval/fixtures apps/web
printf '{"name":"probe_v1","cases":[]}\n' > packages/eval/fixtures/probe_v1.json
printf '{"name":"probe_v1","cases":[]}\n' > packages/eval/fixtures/probe_v1.cases.json
printf 'x\n' > apps/web/a.ts
git add -A
git commit -qm base

run_gate() {
  local rc=0
  bash "$GATE" >"$TMP/stdout" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

assert_green() {
  [ "$1" = "0" ] || { echo "FAIL: $2 (exit $1)" >&2; cat "$TMP/stdout" >&2; exit 1; }
  grep -qF "eval fixture drift: clean" "$TMP/stdout" || {
    echo "FAIL: $2 lacks the clean marker" >&2; cat "$TMP/stdout" >&2; exit 1
  }
}

assert_red() {
  [ "$1" != "0" ] || { echo "FAIL: $2 must be red" >&2; exit 1; }
  grep -qF "differ from the committed fixtures" "$TMP/stdout" || {
    echo "FAIL: $2 lacks the drift message" >&2; cat "$TMP/stdout" >&2; exit 1
  }
}

# stage_drift: write a regenerated change and stage it; prints the staged index
# entry so the caller can prove the real index is untouched by the gate.
stage_drift() {
  printf '{"name":"probe_v1","cases":[{"name":"added"}]}\n' > packages/eval/fixtures/probe_v1.json
  git add packages/eval/fixtures/probe_v1.json
  git ls-files -s packages/eval/fixtures/probe_v1.json
}

restore_drift() {
  git reset -q packages/eval/fixtures/probe_v1.json
  git checkout -q -- packages/eval/fixtures/probe_v1.json
}

assert_staged_entries() {
  [ "$(git diff --cached --name-only)" = "$1" ] || { echo "FAIL: $2" >&2; exit 1; }
}

assert_index_unchanged() {
  local expected="$1" actual
  actual="$(git ls-files -s packages/eval/fixtures/probe_v1.json)"
  [ "$expected" = "$actual" ] || { echo "FAIL: the real index was modified" >&2; exit 1; }
  assert_staged_entries "packages/eval/fixtures/probe_v1.json" "the staged user change was not preserved"
}

test_clean_tree_green() {
  assert_green "$(run_gate)" "clean committed tree"
  echo "ok: a clean committed tree is green"
}

test_staged_only_change_caught_and_index_preserved() {
  local rc before
  before="$(stage_drift)"
  rc="$(run_gate)" || true
  assert_red "$rc" "a regenerated change visible only in the staged snapshot"
  assert_index_unchanged "$before"
  restore_drift
  assert_green "$(run_gate)" "restored tree"
  echo "ok: staged-only regenerated change is caught and the real index is preserved"
}

test_unstaged_change_caught() {
  local rc
  printf '{"name":"probe_v1","cases":[{"name":"added"}]}\n' > packages/eval/fixtures/probe_v1.cases.json
  rc="$(run_gate)" || true
  assert_red "$rc" "an unstaged regenerated change to the case view"
  git checkout -q -- packages/eval/fixtures/probe_v1.cases.json
  assert_green "$(run_gate)" "restored tree"
  echo "ok: an unstaged regenerated change is caught too"
}

test_new_untracked_fixture_caught() {
  local rc
  printf '{"name":"probe_v2","cases":[]}\n' > packages/eval/fixtures/probe_v2.json
  rc="$(run_gate)" || true
  assert_red "$rc" "a newly exported set that was never committed"
  rm packages/eval/fixtures/probe_v2.json
  assert_green "$(run_gate)" "restored tree"
  echo "ok: a new untracked fixture is caught"
}

test_unrelated_staged_entries_preserved() {
  local rc
  printf 'y\n' >> apps/web/a.ts
  git add apps/web/a.ts
  rc="$(run_gate)" || true
  assert_green "$rc" "clean tree with an unrelated staged entry"
  assert_staged_entries "apps/web/a.ts" "unrelated staged entry was lost"
  echo "ok: unrelated staged entries survive the drift check"
}

test_clean_tree_green
test_staged_only_change_caught_and_index_preserved
test_unstaged_change_caught
test_new_untracked_fixture_caught
test_unrelated_staged_entries_preserved
echo "eval-fixture-drift.test.sh: all green"
