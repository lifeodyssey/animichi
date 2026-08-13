#!/usr/bin/env bash
# Gate-behavior tests for the pre-push orchestrator — sourced by
# pre-push.test.sh (the single entry point); not standalone.
#
# Covers the fail-fast exit propagation, the canonical coverage commands
# (agent floor from pyproject addopts, never overridden; showcase-mode guard),
# the agent integration env-stripping (AC3: an exported TEST_DB can never
# route the local gate to Neon — the Docker arm is deterministic), and the
# PG18 offline image identity consistency across the Dockerfile, conftest,
# and the fresh-schema gate (AC3). The agent command contract mirrors
# pipeline-agent.yml's deterministic surface, so removing any one of those
# commands fails the all-route test (which lives in the routing module).
test_fail_fast_propagation() {
  local rc
  rc="$(GATE_CHANGED_PACKAGES=web GATE_FAIL_ON="--filter web typecheck" run_gate "$GATE_STUB_ROOT/failfast.log")" || true
  [ "$rc" != "0" ] || { echo "FAIL: failing gate must exit nonzero" >&2; exit 1; }
  assert_has "$GATE_STUB_ROOT/failfast.log" "--filter web typecheck"
  assert_lacks "$GATE_STUB_ROOT/failfast.log" "--filter web test"
  assert_lacks "$GATE_STUB_ROOT/failfast.log" "pulumi"
  assert_lacks "$GATE_STUB_ROOT/failfast.log" "atlas"
  echo "ok: first failure stops the run and propagates the exit code"
}

assert_canonical_coverage() {
  # Canonical agent floor comes from apps/agent/pyproject.toml addopts
  # (--cov-fail-under=87): the gate must not override it with a CLI value.
  assert_has "$GATE_STUB_ROOT/run1.log" "--cov"
  assert_lacks "$GATE_STUB_ROOT/run1.log" "--cov-fail-under"
  # TS packages use the coverage-enabled scripts CI enforces (web/users/
  # catalog "test"/"test:worker" carry --coverage in package.json).
  assert_has "$GATE_STUB_ROOT/run1.log" "pnpm --filter web test"
}

assert_showcase_mode_guard() {
  # Web build runs with the showcase-mode guard CI requires.
  grep -q "^env VITE_SHOWCASE_MODE=false" "$GATE_STUB_ROOT/run1.log" || {
    echo "FAIL: web build gate lacks VITE_SHOWCASE_MODE=false" >&2
    exit 1
  }
}

test_canonical_coverage_commands() {
  run_full_set
  assert_canonical_coverage
  assert_showcase_mode_guard
  echo "ok: canonical coverage commands selected"
}

agent_integration_gate() {
  grep -n "pytest src/animichi/tests/integration/" "$PRE_PUSH" || {
    echo "FAIL: pre-push.sh lacks the agent integration gate" >&2
    exit 1
  }
}

# AC3: the local agent integration gate must deterministically use the Docker
# arm. The stub `uv` logs argv as received from the real `env` binary (which
# is not stubbed), so the `env -u` prefix is not observable in the invocation
# log — assert the changed command directly on the orchestrator source.
assert_live_selectors_stripped() {
  local pattern
  pattern='env -u TEST_DB -u TEST_DATABASE_URL -u TEST_DB_ALLOW_MUTATION -u NEON_API_KEY -u NEON_PROJECT_ID -u NEON_ENDPOINT_SUFFIX uv run pytest src/animichi/tests/integration/'
  if ! printf '%s\n' "$1" | grep -qF -- "$pattern"; then
    echo "FAIL: agent integration gate does not strip live/BYO selectors" >&2
    echo "$1" >&2
    exit 1
  fi
}

test_agent_integration_strips_live_arm_selectors() {
  local agent_gate
  agent_gate="$(agent_integration_gate)"
  assert_live_selectors_stripped "$agent_gate"
  local rc
  rc="$(GATE_CHANGED_PACKAGES=agent run_gate "$GATE_STUB_ROOT/run-agent-env.log")" || true
  [ "$rc" = "0" ] || { echo "FAIL: agent-only run exited $rc" >&2; exit 1; }
  assert_has "$GATE_STUB_ROOT/run-agent-env.log" "uv run pytest src/animichi/tests/integration/ -v --no-cov"
  echo "ok: agent integration gate strips live/BYO selector env vars (Docker arm only)"
}

assert_pg18_pin() {
  grep -qF "$1" "$2" || { echo "FAIL: $3" >&2; exit 1; }
}

assert_pg18_dockerfile() {
  assert_pg18_pin "sha256:dd844a57310d76c6f7a9941568a573ecb9fe2d6afcb89ab008e5e096e759d314" "$1" "Dockerfile lost the PG18 base digest"
  assert_pg18_pin "postgresql-18-pgvector" "$1" "Dockerfile lost the postgresql-18-pgvector package"
  assert_pg18_pin "0.8.5-1.pgdg13+1" "$1" "Dockerfile lost the pgdg13 package pin"
}

assert_offline_image_identity() {
  grep -qF "animichi-test-postgres:18-3.6-pgvector-0.8.5" "$1" || {
    echo "FAIL: $2 lost the PG18 offline image identity" >&2
    exit 1
  }
}

assert_no_stale_pg16() {
  if grep -qE "16-3\.4|postgresql-16|pgdg11|postgis:16" "$1"; then
    echo "FAIL: stale PG16 reference in $1" >&2
    exit 1
  fi
}

# AC3 hermetic consistency: the offline postgres image is the same immutable
# PostgreSQL 18.4 / PostGIS 18-3.6 build wherever it is referenced directly —
# the Dockerfile, the conftest offline image identity, and the fresh-schema
# gate. A stale PG16 reference in any one of these files must fail this test,
# and reverting one side to PG16 must fail it too.
assert_pg18_consistency() {
  assert_pg18_dockerfile "$1"
  assert_offline_image_identity "$2" "conftest"
  assert_offline_image_identity "$3" "db-fresh-schema.sh"
  assert_no_stale_pg16 "$1"
  assert_no_stale_pg16 "$2"
  assert_no_stale_pg16 "$3"
}

test_pg18_image_identity_consistency() {
  assert_pg18_consistency \
    "$REPO_ROOT/apps/agent/docker/test-postgres/Dockerfile" \
    "$REPO_ROOT/apps/agent/src/animichi/tests/conftest_db.py" \
    "$SCRIPT_DIR/db-fresh-schema.sh"
  echo "ok: Dockerfile, conftest, and db-fresh-schema.sh share the PG18 image identity"
}

# #1003 regression: the staged agent-model drift check must compare the
# regenerated output to HEAD. `git diff` (worktree vs index) would let a
# STAGED correction mask drift against the committed snapshot.
test_agent_model_drift_compares_to_head() {
  grep -qF 'git diff --exit-code HEAD -- apps/agent/src/animichi/interfaces/boundary/agent_models.py' "$PRE_PUSH" || {
    echo "FAIL: agent-model drift must compare regenerated output to HEAD" >&2
    exit 1
  }
  echo "ok: the agent-model drift check compares regenerated output to HEAD"
}

# #1003 regression: pre-push.sh must never rm -rf an INHERITED GATE_OUTDIR —
# it always creates its own unique temp and cleans only that, so a caller's
# exported directory survives a gate run.
run_driver_with_outdir() {
  local rc=0
  (
    cd "$REPO_ROOT"
    GATE_CHANGED_PACKAGES=web GATE_TEST_LOG="$1" PATH="$GATE_STUB_BIN:$PATH" GATE_OUTDIR="$2" bash "$DRIVER"
  ) >"$GATE_STUB_ROOT/stdout" 2>&1 || rc=$?
  echo "$rc"
}

test_inherited_gate_outdir_is_not_deleted() {
  local sentinel rc
  sentinel="$GATE_STUB_ROOT/sentinel-out"
  mkdir -p "$sentinel"
  printf 'keep\n' > "$sentinel/marker"
  rc="$(run_driver_with_outdir "$GATE_STUB_ROOT/run-outdir.log" "$sentinel")" || true
  [ "$rc" = "0" ] || { echo "FAIL: inherited GATE_OUTDIR run exited $rc" >&2; exit 1; }
  [ -f "$sentinel/marker" ] || { echo "FAIL: pre-push.sh deleted an inherited GATE_OUTDIR" >&2; exit 1; }
  echo "ok: an inherited GATE_OUTDIR is never deleted (unique owned temp instead)"
}
