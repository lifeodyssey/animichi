#!/usr/bin/env bash
# AC routing contract tests for the pre-push orchestrator — sourced by
# pre-push.test.sh (the single entry point); not standalone.
#
# Covers AC1/AC2/AC4: the `all` route selects every package's full gate set,
# positional arguments never route, an affected package runs only its own
# CI-equivalent gates, the `all` fallback (root config change) still runs the
# config contract self-test, and a contract consumer change unions the
# contract gates. Shared helpers, the command fixtures (ALL_COMMANDS /
# PACKAGE_DIR_COMMANDS), and the canonical test invocation order live in
# pre-push.test.sh; the modules only define test functions.
test_all_selects_every_package_gate() {
  run_full_set
  local needle
  for needle in "${ALL_COMMANDS[@]}" "${PACKAGE_DIR_COMMANDS[@]}"; do
    assert_has "$GATE_STUB_ROOT/run1.log" "$needle"
  done
  assert_lacks "$GATE_STUB_ROOT/run1.log" "changed-packages"
  assert_lacks "$GATE_STUB_ROOT/run1.log" "git push"
  echo "ok: all selects every package gate (lint/typecheck/unit/coverage/build/contract/quality)"
}

# normalize_gate_log: the gate's owned scratch dir is unique per run
# (GATE_OUTDIR is never inherited), so the --outdir path differs between
# otherwise identical runs — normalize it before comparing gate sets.
normalize_gate_log() {
  sed 's/--outdir [^ ]*/--outdir OUT/' "$1" | sort
}

test_arguments_do_not_route() {
  local rc
  rc="$(GATE_CHANGED_PACKAGES=all run_gate "$GATE_STUB_ROOT/run2.log" web catalog)" || true
  [ "$rc" = "0" ] || { echo "FAIL: argumented run exited $rc" >&2; exit 1; }
  diff -u <(normalize_gate_log "$GATE_STUB_ROOT/run1.log") <(normalize_gate_log "$GATE_STUB_ROOT/run2.log") || {
    echo "FAIL: positional arguments changed the gate set" >&2
    exit 1
  }
  echo "ok: positional arguments do not route the gate set"
}

assert_web_only_gates() {
  assert_has "$GATE_STUB_ROOT/run3.log" "$REPO_ROOT/apps/web :: pnpm --filter web typecheck"
  assert_has "$GATE_STUB_ROOT/run3.log" "pnpm --filter web test"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "uv run mypy"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "uv run ruff check"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "uv run vulture"
}

assert_no_other_package_gates() {
  assert_lacks "$GATE_STUB_ROOT/run3.log" "docker build -f apps/agent/Dockerfile"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "workers/catalog :: pnpm exec tsc"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "workers/users :: pnpm exec tsc"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "workers/edge :: pnpm run lint:oxlint"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "pnpm emit:openapi"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "pnpm --filter infra"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "atlas"
  assert_lacks "$GATE_STUB_ROOT/run3.log" "pulumi"
}

test_affected_packages_only() {
  local rc
  rc="$(GATE_CHANGED_PACKAGES=web run_gate "$GATE_STUB_ROOT/run3.log")" || true
  [ "$rc" = "0" ] || { echo "FAIL: web-only run exited $rc" >&2; exit 1; }
  assert_web_only_gates
  assert_no_other_package_gates
  echo "ok: an affected package runs only its own CI-equivalent gates"
}

test_all_route_runs_config_contract_self_test() {
  # Clear shared stdout so the assertion only sees this run's output.
  : >"$GATE_STUB_ROOT/stdout"
  local rc
  rc="$(GATE_CHANGED_PACKAGES=all run_gate "$GATE_STUB_ROOT/run-all.log")" || true
  [ "$rc" = "0" ] || { echo "FAIL: all route exited $rc" >&2; exit 1; }
  # A root-only `.pre-commit-config.yaml` change must not skip the self-test.
  assert_has "$GATE_STUB_ROOT/stdout" "pre-commit-config.test.sh"
  echo "ok: the all route (root config fallback) runs the config contract self-test"
}

assert_contract_union_gates() {
  assert_has "$GATE_STUB_ROOT/run4.log" "pnpm emit:openapi"
  assert_has "$GATE_STUB_ROOT/run4.log" "pnpm --filter web typecheck"
  assert_has "$GATE_STUB_ROOT/stdout" "==> bash scripts/local-gates/contract-drift.sh"
}

assert_no_union_unrelated_gates() {
  assert_lacks "$GATE_STUB_ROOT/run4.log" "pulumi"
  assert_lacks "$GATE_STUB_ROOT/run4.log" "atlas"
}

test_contract_union_routing() {
  local rc
  rc="$(GATE_CHANGED_PACKAGES=$'web\ncontract' run_gate "$GATE_STUB_ROOT/run4.log")" || true
  [ "$rc" = "0" ] || { echo "FAIL: web+contract run exited $rc" >&2; exit 1; }
  assert_contract_union_gates
  assert_no_union_unrelated_gates
  echo "ok: contract gates run when contract (or a consumer) is affected"
}

# Regression (#1003): the REAL hook must never honor GATE_CHANGED_PACKAGES.
# The old override would let `GATE_CHANGED_PACKAGES=web git push` shrink the
# route and skip agent/db/infra gates; here the override is set to `web` and
# the real entry must still route exactly as the canonical router does. The
# probe drives the REAL entry from a deterministic TEMP repo (a local clone
# with exactly one committed web change), so it always runs — it can never
# skip on the live worktree's route (e.g. when the working tree edits these
# very gate scripts) and the route can never include `scripts` (no recursion).
clone_deterministic_repo() {
  local dst="$1"
  git clone -q "$REPO_ROOT" "$dst"
  mkdir -p "$dst/scripts"
  cp -R "$SCRIPT_DIR/." "$dst/scripts/local-gates/"
  cp -R "$REPO_ROOT/.github/scripts" "$dst/.github"
  (
    cd "$dst" || exit
    git config user.email gate@test.invalid
    git config user.name "gate test"
    git config commit.gpgsign false
    # Pin the merge-base to the pre-change HEAD: the source repo's own main
    # may be stale (feature-branch work), which would make the clone's route
    # depend on the source state. With origin/main pinned, the router's
    # merge-base diff is exactly the committed web change.
    git update-ref refs/remotes/origin/main HEAD
    printf 'x\n' >> apps/web/a.ts
    git add apps/web/a.ts
    git commit -qm web-change
  )
}

run_real_entry_in() {
  local repo="$1" rc=0
  (
    cd "$repo"
    GATE_CHANGED_PACKAGES=web GATE_TEST_LOG="$GATE_STUB_ROOT/real-entry.log" \
      PATH="$GATE_STUB_BIN:$PATH" "$repo/scripts/local-gates/pre-push.sh"
  ) >"$GATE_STUB_ROOT/stdout" 2>&1 || rc=$?
  echo "$rc"
}

assert_route_override_ignored() {
  assert_has "$GATE_STUB_ROOT/stdout" "pre-push gate: deterministic set for [contract,web] passed."
  assert_has "$GATE_STUB_ROOT/stdout" "==> [apps/web] pnpm --filter web typecheck"
  assert_has "$GATE_STUB_ROOT/stdout" "==> bash scripts/local-gates/contract-drift.sh"
  assert_lacks "$GATE_STUB_ROOT/stdout" "pre-push gate: deterministic set for [web] passed."
  assert_lacks "$GATE_STUB_ROOT/stdout" "==> [apps/agent] uv run ruff check"
}

test_real_entry_ignores_route_override() {
  local repo rc
  repo="$GATE_STUB_ROOT/real-entry-repo"
  clone_deterministic_repo "$repo"
  rc="$(run_real_entry_in "$repo")" || true
  [ "$rc" = "0" ] || { echo "FAIL: real entry exited $rc" >&2; exit 1; }
  assert_route_override_ignored
  echo "ok: the real hook ignores GATE_CHANGED_PACKAGES and routes via the router"
}
