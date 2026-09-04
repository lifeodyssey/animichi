#!/usr/bin/env bash
# Behavioral tests for the staged-snapshot OpenAPI drift check
# (scripts/local-gates/contract-drift.sh), AC2.
#
# The check mirrors pr-verification.yml's contract lane: emit → stage into a
# throwaway index → fail on `git diff --cached`. These tests prove a generated
# change that is ONLY visible in the staged snapshot is caught (an unstaged
# `git diff` after emission misses it), that the real index is never modified
# (unrelated entries and staged user work survive), and that a clean tree is
# green. Runs in a throwaway repository.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/contract-drift.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

git init -q
git config user.email gate@test.invalid
git config user.name "gate test"
git config commit.gpgsign false
mkdir -p packages/contract apps/web
printf '{"swagger":"2.0"}\n' > packages/contract/openapi.json
printf '{"swagger":"2.0"}\n' > packages/contract/users-openapi.json
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
  grep -qF "contract OpenAPI drift: clean" "$TMP/stdout" || {
    echo "FAIL: $2 lacks the clean marker" >&2; cat "$TMP/stdout" >&2; exit 1
  }
}

assert_red() {
  [ "$1" != "0" ] || { echo "FAIL: $2 must be red" >&2; exit 1; }
  grep -qF "regenerated documents differ from the committed snapshot" "$TMP/stdout" || {
    echo "FAIL: $2 lacks the drift message" >&2; cat "$TMP/stdout" >&2; exit 1
  }
}

test_clean_tree_green() {
  assert_green "$(run_gate)" "clean committed tree"
  echo "ok: a clean committed tree is green"
}

# stage_drift: write a generated change and stage it; prints the staged index
# entry so the caller can prove the real index is untouched by the gate.
stage_drift() {
  printf '{"swagger":"2.0","drifted":true}\n' > packages/contract/openapi.json
  git add packages/contract/openapi.json
  git ls-files -s packages/contract/openapi.json
}

restore_drift() {
  git reset -q packages/contract/openapi.json
  git checkout -q -- packages/contract/openapi.json
}

stage_unrelated() {
  printf 'y\n' >> apps/web/a.ts
  git add apps/web/a.ts
}

assert_staged_entries() {
  [ "$(git diff --cached --name-only)" = "$1" ] || {
    echo "FAIL: $2" >&2
    exit 1
  }
}

assert_index_unchanged() {
  local expected="$1" actual
  actual="$(git ls-files -s packages/contract/openapi.json)"
  [ "$expected" = "$actual" ] || { echo "FAIL: the real index was modified" >&2; exit 1; }
  assert_staged_entries "packages/contract/openapi.json" "the staged user change was not preserved"
}

test_staged_only_change_caught_and_index_preserved() {
  local rc before
  before="$(stage_drift)"
  rc="$(run_gate)" || true
  assert_red "$rc" "a generated change visible only in the staged snapshot"
  assert_index_unchanged "$before"
  restore_drift
  assert_green "$(run_gate)" "restored tree"
  echo "ok: staged-only generated change is caught and the real index is preserved"
}

test_unstaged_change_caught() {
  local rc
  printf '{"swagger":"2.0","drifted":true}\n' > packages/contract/users-openapi.json
  rc="$(run_gate)" || true
  assert_red "$rc" "an unstaged generated change to users-openapi.json"
  git checkout -q -- packages/contract/users-openapi.json
  assert_green "$(run_gate)" "restored tree"
  echo "ok: an unstaged generated change is caught too"
}

test_unrelated_staged_entries_preserved() {
  local rc
  stage_unrelated
  rc="$(run_gate)" || true
  assert_green "$rc" "clean tree with an unrelated staged entry"
  assert_staged_entries "apps/web/a.ts" "unrelated staged entry was lost"
  echo "ok: unrelated staged entries survive the drift check"
}

test_clean_tree_green
test_staged_only_change_caught_and_index_preserved
test_unstaged_change_caught
test_unrelated_staged_entries_preserved
echo "contract-drift.test.sh: all green"
