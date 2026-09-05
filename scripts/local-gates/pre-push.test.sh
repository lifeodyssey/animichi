#!/usr/bin/env bash
# Behavioral tests for the pre-push gate orchestrator
# (scripts/local-gates/pre-push.sh). Tools are stubbed (stub-env.sh +
# test-stub.sh); Quality bash checks and git run unstubbed (hermetic).
# This file is the single entry — modules: pre-push-tests-routing.sh,
# pre-push-tests-gates.sh, pre-push-tests-hygiene.sh,
# pre-push-tests-prereqs.sh, pre-push-tests-hygiene-url.sh,
# pre-push-tests-quality.sh. Routes inject via GATE_CHANGED_PACKAGES into
# pre-push-test-driver.sh only; the real entry never reads that variable.
# Add new cases to the matching module, not here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRE_PUSH="$SCRIPT_DIR/pre-push.sh"
DRIVER="$SCRIPT_DIR/pre-push-test-driver.sh"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
[ -f "$PRE_PUSH" ] || { echo "missing $PRE_PUSH" >&2; exit 1; }
source "$SCRIPT_DIR/stub-env.sh"

run_gate() {
  local log="$1"; shift
  local rc=0
  (
    cd "$REPO_ROOT"
    GATE_TEST_LOG="$log" PATH="$GATE_STUB_BIN:$PATH" \
      GATE_OUTDIR="$GATE_STUB_ROOT/out" bash "$DRIVER" "$@"
  ) >"$GATE_STUB_ROOT/stdout" 2>&1 || rc=$?
  echo "$rc"
}

assert_has() {
  grep -qF -- "$2" "$1" || { echo "FAIL: log lacks: $2" >&2; exit 1; }
}

assert_lacks() {
  if grep -qF -- "$2" "$1"; then
    echo "FAIL: log must not contain: $2" >&2
    exit 1
  fi
}

run_full_set() {
  local rc
  rc="$(GATE_CHANGED_PACKAGES=all run_gate "$GATE_STUB_ROOT/run1.log")" || true
  [ "$rc" = "0" ] || { echo "FAIL: full gate run exited $rc" >&2; exit 1; }
}

ALL_COMMANDS=(
  # agent: ruff lint/format + mypy + vulture + canonical unit pytest + offline
  # docker-arm integration + container build (pr-verification agent-lane order)
  "uv run ruff check"
  "uv run ruff format --check src/animichi/"
  "uv run mypy src/animichi/agents/ src/animichi/interfaces/ src/animichi/domain/ src/animichi/infrastructure/ src/animichi/clients/"
  "uv run vulture src/animichi/ vulture_whitelist.py"
  "uv run pytest src/animichi/tests/unit/ -v --cov --cov-report=xml:coverage-unit.xml"
  # agent integration: the stub `uv` logs argv as received from the real `env`
  # binary, so the log shows the post-env invocation; the `env -u` selector
  # stripping is asserted separately (test_agent_integration_strips_live_arm_selectors).
  "uv run pytest src/animichi/tests/integration/ -v --cov --cov-report=xml:coverage-integration.xml --cov-fail-under=0"
  "docker build -f apps/agent/Dockerfile -t animichi-agent:ci ."
  # web: CI lint/test/build
  "pnpm --filter web typecheck"
  "pnpm --filter web run lint:oxlint"
  "pnpm --filter web test"
  "pnpm --filter web test:integration"
  # catalog: CI lint/test/smoke/build
  "pnpm run test:smoke"
  "pnpm run test:spike"
  # edge: CI build (production-config dry-run from repo root). The bundler
  # smoke and rate-limit checks moved inside the package's own `test` script
  # (#1358); `.github/scripts/test_package_test_segments.rb` pins them there.
  "pnpm exec wrangler deploy -c workers/edge/wrangler.toml --dry-run -e production --outdir"
  # contract: the agent-model drift check, which no package script covers
  "pnpm emit:agent-python"
  # db: checksum validate + migration boundary guard + fresh-schema apply
  "atlas migrate validate --dir file://migrations/neon"
  "node --test workers/edge/test/migration-boundary.test.ts"
  "sqlfluff lint ../../migrations/neon"
  "atlas migrate apply --dir file://migrations/neon"
  # docs: the doc-consistency subset that asserts docs/CI sync
  "uv run pytest src/animichi/tests/unit/test_secrets_docs_consistency.py src/animichi/tests/unit/test_documentation_guardrails.py -q --no-cov"
)

PACKAGE_DIR_COMMANDS=(
  "$REPO_ROOT/apps/web :: pnpm --filter web typecheck"
  "$REPO_ROOT/workers/catalog :: pnpm exec tsc --noEmit"
  "$REPO_ROOT/workers/users :: pnpm exec tsc --noEmit"
  "$REPO_ROOT/workers/edge :: pnpm run lint:oxlint"
  "$REPO_ROOT/workers/migrator :: pnpm exec tsc --noEmit"
  "$REPO_ROOT/workers/migrator :: pnpm run lint:oxlint"
  "$REPO_ROOT/workers/migrator :: pnpm run test"
  "$REPO_ROOT/workers/migrator :: pnpm exec wrangler deploy --dry-run"
  "$REPO_ROOT/packages/contract :: pnpm exec tsc --noEmit"
  "$REPO_ROOT/packages/contract :: pnpm run test"
  "$REPO_ROOT/infra :: pnpm run typecheck"
  "$REPO_ROOT/infra :: pnpm test"
  "$REPO_ROOT/apps/agent :: uv run ruff check"
  "$REPO_ROOT/apps/agent :: uv run ruff format --check src/animichi/"
  "$REPO_ROOT/apps/agent :: uv run mypy"
  "$REPO_ROOT/apps/agent :: uv run vulture src/animichi/ vulture_whitelist.py"
  "$REPO_ROOT :: docker build -f apps/agent/Dockerfile -t animichi-agent:ci ."
  "$REPO_ROOT :: pnpm run test:worker"
  "$REPO_ROOT :: node --test workers/edge/test/migration-boundary.test.ts"
)

# ── fixture integrity (same-file use; the routing modules consume these
# arrays via source, which shellcheck cannot see). A fixture that silently
# shrinks to empty or gains a malformed entry must fail loudly instead of
# making the all-route probe vacuous.
fail_fixture() {
  echo "FAIL: $1" >&2
  exit 1
}

assert_fixture_nonempty() {
  [ -n "$2" ] || fail_fixture "empty entry in $1"
}

validate_all_commands_fixture() {
  [ "${#ALL_COMMANDS[@]}" -gt 0 ] || fail_fixture "ALL_COMMANDS is empty"
  local cmd
  for cmd in "${ALL_COMMANDS[@]}"; do
    assert_fixture_nonempty "ALL_COMMANDS" "$cmd"
  done
}

validate_dir_command_entry() {
  case "$1" in
    "$REPO_ROOT :: "*) ;;
    "$REPO_ROOT"/*" :: "*) ;;
    *) fail_fixture "malformed PACKAGE_DIR_COMMANDS entry: $1" ;;
  esac
}

validate_dir_commands_fixture() {
  [ "${#PACKAGE_DIR_COMMANDS[@]}" -gt 0 ] || fail_fixture "PACKAGE_DIR_COMMANDS is empty"
  local entry
  for entry in "${PACKAGE_DIR_COMMANDS[@]}"; do
    validate_dir_command_entry "$entry"
  done
}

test_command_fixtures_integrity() {
  validate_all_commands_fixture
  validate_dir_commands_fixture
  echo "ok: command fixtures are non-empty and well-formed"
}

source "$SCRIPT_DIR/pre-push-tests-routing.sh"
source "$SCRIPT_DIR/pre-push-tests-gates.sh"
source "$SCRIPT_DIR/pre-push-tests-hygiene.sh"
source "$SCRIPT_DIR/pre-push-tests-prereqs.sh"
source "$SCRIPT_DIR/pre-push-tests-hygiene-url.sh"
source "$SCRIPT_DIR/pre-push-tests-quality.sh"

test_command_fixtures_integrity
test_all_selects_every_package_gate
test_arguments_do_not_route
test_affected_packages_only
test_migrator_package_gates
test_e2e_static_gates
test_all_route_runs_config_contract_self_test
test_contract_union_routing
test_real_entry_ignores_route_override
test_fail_fast_propagation
test_canonical_coverage_commands
test_agent_integration_strips_live_arm_selectors
test_pg18_image_identity_consistency
test_agent_model_drift_compares_to_head
test_inherited_gate_outdir_is_not_deleted
test_no_forbidden_cloud_mutation_commands
test_comment_tokens_do_not_fail_scan
test_executable_forbidden_command_fails_scan
test_inline_comment_tokens_do_not_fail_scan
test_arbitrary_whitespace_forbidden_command_fails_scan
test_split_continuation_forbidden_command_fails_scan
test_url_fragment_does_not_hide_forbidden_command
test_hash_inside_quotes_does_not_hide_forbidden_command
test_missing_prerequisite_fails
test_old_node_version_fails_prereqs
test_any_atlas_version_passes_prereqs
test_malformed_node_version_fails_prereqs
test_missing_later_ruby_file_fails
echo "pre-push.test.sh: all green"
