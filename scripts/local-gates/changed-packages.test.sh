#!/usr/bin/env bash
# Behavioral tests for the changed-package router
# (scripts/local-gates/changed-packages.sh) in a throwaway repository, so the
# assertions never depend on this worktree's actual branch state.
#
# Covers AC1/AC5: staged tracked add/modify/rename/delete, intentional
# untracked inputs, merge-base-to-head pre-push mode, root-path fallback to
# `all`, the contract union rule, and fail-closed routing when a git read
# fails (the router must never emit an empty package set that could skip
# gates). `--no-renames` in the router is pinned here: a rename must route
# BOTH its old and new path (a cross-package move must not hide the source
# package's deletion).
#
# Fixture + helpers live in changed-packages-fixtures.sh (sourced, not
# standalone); the case order and summary echo stay here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTER="$SCRIPT_DIR/changed-packages.sh"
source "$SCRIPT_DIR/changed-packages-fixtures.sh"

# ── staged mode ──────────────────────────────────────────────────────────────
test_staged_add_modify_rename_delete_and_untracked() {
  seed_base
  stage_add_modify_rename_delete_untracked
  assert_eq \
    $'agent\ncontract\ndocs\ninfra\nusers\nweb' \
    "$(run_staged)" \
    "staged add/modify/rename/delete + untracked"
  echo "ok: --staged reads staged add/modify/rename/delete + untracked"
}

# A cross-package move: the old path (agent delete) and the new path (web
# add) must both route — a rename must not hide the source package. web is a
# contract consumer, so contract is unioned in.
test_rename_routes_both_sides() {
  seed_base
  git mv apps/agent/a.py apps/web/moved.py
  assert_eq \
    $'agent\ncontract\nweb' \
    "$(run_staged)" \
    "cross-package rename routes both old and new paths"
  echo "ok: --staged routes both sides of a rename"
}

test_root_fallback_to_all() {
  seed_base
  touch root-extra.txt
  git add root-extra.txt
  assert_eq "all" "$(run_staged)" "root path falls back to all"
  echo "ok: unknown/root path falls back to all"
}

test_staged_ignores_committed_changes() {
  seed_base
  # Commit a web change, then stage nothing: --staged must report empty (the
  # committed change is pre-push's merge-base concern, not staged).
  printf 'x' >> apps/web/b.ts
  git add apps/web/b.ts
  git commit -qm web-only
  assert_eq "" "$(run_staged)" "staged mode ignores committed changes"
  echo "ok: --staged reports only staged tracked + untracked"
}

test_staged_rename_delete_statuses_all_covered() {
  seed_base
  stage_status_matrix
  assert_eq \
    $'contract\ndb\nweb' \
    "$(run_staged)" \
    "status matrix M/A/D + rename routes every touched package"
  echo "ok: status matrix routes every touched package"
}

# Fail closed: a git read failure in --staged mode must exit non-zero with an
# actionable message, never an empty package set.
test_staged_diff_failure_fails_closed() {
  seed_base
  local fake rc=0
  fake="$(make_fake_git)"
  GATE_GIT_FAIL="diff --cached" PATH="$fake:$PATH" bash "$ROUTER" --staged >"$TMP/fail-staged-diff.out" 2>&1 || rc=$?
  [ "$rc" != "0" ] || { echo "FAIL: staged diff failure must fail closed" >&2; exit 1; }
  assert_msg "failed to read the staged diff" "$TMP/fail-staged-diff.out"
  echo "ok: staged diff read failure fails closed"
}

test_staged_untracked_failure_fails_closed() {
  seed_base
  local fake rc=0
  fake="$(make_fake_git)"
  GATE_GIT_FAIL="ls-files" PATH="$fake:$PATH" bash "$ROUTER" --staged >"$TMP/fail-staged-untracked.out" 2>&1 || rc=$?
  [ "$rc" != "0" ] || { echo "FAIL: untracked read failure must fail closed" >&2; exit 1; }
  assert_msg "failed to read the untracked inputs" "$TMP/fail-staged-untracked.out"
  echo "ok: untracked input read failure fails closed"
}

# ── merge-base mode ──────────────────────────────────────────────────────────
test_merge_base_reads_committed_changes() {
  seed_base
  commit_agent_and_users
  touch docs/unrelated.md
  assert_eq \
    $'agent\ncontract\nusers' \
    "$(run_merge_base)" \
    "merge-base reads committed changes (untracked excluded)"
  echo "ok: default mode reads merge-base-to-head and ignores untracked"
}

test_contract_union_on_consumer_change() {
  seed_base
  printf 'x' >> apps/web/b.ts
  git add apps/web/b.ts
  git commit -qm web-only
  assert_eq $'contract\nweb' "$(run_merge_base)" "consumer change unions contract"
  echo "ok: consumer change unions contract"
}

test_contract_change_does_not_union_consumers() {
  seed_base
  printf 'x' >> packages/contract/c.ts
  git add packages/contract/c.ts
  git commit -qm contract-only
  assert_eq "contract" "$(run_merge_base)" "contract change stays contract only"
  echo "ok: contract-only change does not union consumers"
}

test_empty_change_outputs_nothing() {
  seed_base
  assert_eq "" "$(run_merge_base)" "no commits -> empty output"
  echo "ok: no changes produce empty output"
}

test_origin_main_fallback_to_head() {
  seed_base
  # Drop the origin/main ref: the router must fall back to HEAD^.
  git update-ref -d refs/remotes/origin/main
  printf 'x' >> docs/d.md
  git add docs/d.md
  git commit -qm docs-only
  assert_eq "docs" "$(run_merge_base)" "HEAD^ fallback when origin/main is absent"
  echo "ok: falls back to HEAD^ when origin/main is absent"
}

# Fail closed: a merge-base git read failure (or no readable base at all) must
# exit non-zero with an actionable message, never an empty package set.
test_merge_base_diff_failure_fails_closed() {
  seed_base
  local fake rc=0
  fake="$(make_fake_git)"
  GATE_GIT_FAIL="origin/main...HEAD" PATH="$fake:$PATH" bash "$ROUTER" >"$TMP/fail-mergebase-diff.out" 2>&1 || rc=$?
  [ "$rc" != "0" ] || { echo "FAIL: merge-base diff failure must fail closed" >&2; exit 1; }
  assert_msg "failed to read the merge-base diff" "$TMP/fail-mergebase-diff.out"
  echo "ok: merge-base diff read failure fails closed"
}

test_no_merge_base_fails_closed() {
  seed_base
  local fake rc=0
  fake="$(make_fake_git)"
  GATE_GIT_FAIL="rev-parse" PATH="$fake:$PATH" bash "$ROUTER" >"$TMP/fail-mergebase-nobase.out" 2>&1 || rc=$?
  [ "$rc" != "0" ] || { echo "FAIL: missing merge base must fail closed" >&2; exit 1; }
  assert_msg "no merge base" "$TMP/fail-mergebase-nobase.out"
  echo "ok: missing merge base fails closed"
}

test_staged_add_modify_rename_delete_and_untracked
test_rename_routes_both_sides
test_root_fallback_to_all
test_staged_ignores_committed_changes
test_staged_rename_delete_statuses_all_covered
test_staged_diff_failure_fails_closed
test_staged_untracked_failure_fails_closed
test_merge_base_reads_committed_changes
test_contract_union_on_consumer_change
test_contract_change_does_not_union_consumers
test_empty_change_outputs_nothing
test_origin_main_fallback_to_head
test_merge_base_diff_failure_fails_closed
test_no_merge_base_fails_closed
echo "changed-packages.test.sh: all green"
