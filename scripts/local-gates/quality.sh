#!/usr/bin/env bash
# Deterministic Quality gate (#1003, AC5): every check and self-test from
# the static-quality action used by pr-verification.yml, in CI's order, fail-fast. CI calls
# the very same scripts — nothing here is a weaker duplicate. The only
# locally-pinned tool is actionlint (CI pins v1.7.7); the binary is a
# prerequisite, never downloaded during a push. #1114 also mirrors the
# hermetic security-lane script tests that can run without CI-only resources.
set -euo pipefail

GS=".github/scripts"
run() {
  printf 'quality: %s\n' "$*"
  "$@"
}

# CI's static-quality action runs `ruby -c` once per file; a single invocation
# with several paths would only ever syntax-check the first one, silently
# skipping every later file — loop one path per `ruby -c`, fail-fast.
for ruby_file in \
  "$GS/assert-workflow-invariants.rb" \
  "$GS/assert-workflow-invariants-expression.rb" \
  "$GS/assert-workflow-invariants.test.rb" \
  "$GS/test_ci_contract.rb" \
  "$GS/test_ci_contract_security.rb" \
  "$GS/security-check-runs-canary.rb" \
  "$GS/test_security_check_runs_canary.rb" \
  "$GS/test_ci_contract_security_mutation.rb" \
  "$GS/test_pr_verification_contract.rb" \
  "$GS/test_pr_verification_contract_mutation.rb" \
  "$GS/test_secret_scan_contract.rb" \
  "$GS/test_secret_scan_contract_mutation.rb" \
  "$GS/test_ci_routing_consistency.rb" \
  "$GS/test_ci_contract_ruleset_migration.rb" \
  "$GS/test_ci_contract_ruleset_migration_mutation.rb" \
  "$GS/test_production_safety_contract.rb" \
  "$GS/test_rollback_edge_pair_mutation.rb" \
  "$GS/test_retired_retention_absence.rb" \
  "$GS/test_neon_test_infra_absence.rb" \
  "$GS/test_promotion_ac5_contract.rb" \
  "$GS/test_promotion_ac5_mutation.rb" \
  "$GS/test_database_credential_boundary.rb" \
  "$GS/test_migration_promotion_contract.rb" \
  "$GS/test_cd_workflow_contract.rb" \
  "$GS/test_cd_skip_propagation_contract.rb" \
  "$GS/ci_prepush_parity.rb" \
  "$GS/ci_prepush_parity_yaml.rb" \
  "$GS/ci_prepush_parity_extract.rb" \
  "$GS/test_ci_prepush_parity.rb" \
  "$GS/test_ci_prepush_parity.test.rb" \
  "$GS/test_cd_worker_promotion_contract.rb" \
  "$GS/test_cd_infrastructure_safety_contract.rb" \
  "$GS/test_cd_esc_token_source_contract.rb" \
  "$GS/test_cd_affected_routing_contract.rb" \
  "$GS/actionlint-queue-contract.rb" \
  "$GS/test_actionlint_queue_contract.rb" \
  "$GS/test_secret_provisioning_contract.rb" \
  "$GS/test_secret_provisioning_mutation.rb"; do
  run ruby -c "$ruby_file"
done
run ruby "$GS/assert-workflow-invariants.test.rb"
run ruby "$GS/assert-workflow-invariants.rb"
run python3 "$GS/test_workflow_inventory.py"
run python3 "$GS/test_component_manifest.py"
run python3 "$GS/test_change_plan.py"
run python3 "$GS/test_cd_cohort_plan.py"
run bash "$GS/test_resolve_cd_base.sh"
run python3 "$GS/test_verify_release_artifact.py"
run bash "$GS/test_promote_release_unit.sh"
run python3 "$GS/test_edge_runtime_secrets.py"
run node "$GS/release-web-runtime-config.test.mjs"
run node "$GS/release-web-runtime-config.mutation.test.mjs"
run ruby "$GS/test_secret_provisioning_contract.rb"
run ruby "$GS/test_secret_provisioning_mutation.rb"
run ruby "$GS/test_cd_workflow_contract.rb"
run ruby "$GS/test_cd_skip_propagation_contract.rb"
run ruby "$GS/test_production_safety_contract.rb"
run python3 "$GS/test_validate_rollback_release.py"
run ruby "$GS/test_rollback_edge_pair_mutation.rb"
run ruby "$GS/test_retired_retention_absence.rb"
run ruby "$GS/test_database_credential_boundary.rb"
run ruby "$GS/test_migration_promotion_contract.rb"
run ruby "$GS/test_promotion_ac5_contract.rb"
run ruby "$GS/test_promotion_ac5_mutation.rb"
run bash "$GS/check-agents-refs.test.sh"
run bash "$GS/check-agents-refs.sh"
run bash "$GS/check-docs-paths.test.sh"
# check-docs-paths.sh corrupts macOS bash 3.2's heap under the harness's
# GATE_* environment (nested while-read + process substitution; see the
# check's own header). The check needs none of those vars — run it scrubbed.
run env -u GATE_TEST_LOG -u GATE_OUTDIR bash "$GS/check-docs-paths.sh"
run bash "$GS/check-root-allowlist.test.sh"
run bash "$GS/check-root-allowlist.sh"
run bash "$GS/check-e2e-promotion.test.sh"
run bash "$GS/check-e2e-promotion.sh"
run bash "$GS/check-actions-pinned.test.sh"
run bash "$GS/check-actions-pinned.sh"
run bash "$GS/check-web-runtime-config-payloads.test.sh"
run bash "$GS/check-web-runtime-config-payloads.sh"
# The script itself needs the artifact API and is exempted from parity; its
# layout contract is pure and runs here with a `gh` stub.
run bash "$GS/download-release-cohort.test.sh"
run bash "$GS/staging-smoke-check.test.sh"
run ruby "$GS/test_ci_contract.rb"
run ruby "$GS/test_cd_worker_promotion_contract.rb"
run ruby "$GS/test_cd_infrastructure_safety_contract.rb"
run ruby "$GS/test_cd_esc_token_source_contract.rb"
run ruby "$GS/test_cd_affected_routing_contract.rb"
run ruby "$GS/test_security_check_runs_canary.rb"
run ruby "$GS/test_ci_contract_security_mutation.rb"
run bash "$GS/security-aggregate.test.sh"
run env EXPECTED_SHA=0123456789abcdef0123456789abcdef01234567 ACTUAL_SHA=0123456789abcdef0123456789abcdef01234567 ROUTE_RESULT=success SECRET_SCANS_RESULT=success SECURITY_TOOLS='[]' SECURITY_MATRIX_RESULT=skipped GITHUB_STEP_SUMMARY=/dev/null bash "$GS/security-aggregate.sh"
run ruby "$GS/test_pr_verification_contract.rb"
run ruby "$GS/test_pr_verification_contract_mutation.rb"
run bash scripts/local-gates/commit-message.test.sh
run bash scripts/local-gates/shebang-exec-bit.test.sh
run bash scripts/local-gates/shebang-exec-bit.sh
run ruby "$GS/test_secret_scan_contract.rb"
run ruby "$GS/test_secret_scan_contract_mutation.rb"
run bash "$GS/resolve-secret-scan-range.test.sh"
run bash "$GS/test_pr_verification_aggregate.sh"
run bash "$GS/test_pr_verification_route.sh"
run bash "$GS/test_pr_verification_gate_baseline.sh"
run bash "$GS/pr-verification-route.sh" "$(git rev-parse HEAD^)" "$(git rev-parse HEAD)"
run bash -c 'if bash .github/scripts/pr-verification-aggregate.sh >/dev/null 2>&1; then exit 1; fi'
run bash -c 'if bash .github/scripts/pr-verification-gate.sh invalid >/dev/null 2>&1; then exit 1; fi'
run ruby "$GS/test_neon_test_infra_absence.rb"
run ruby "$GS/test_ci_contract_ruleset_migration_mutation.rb"
run ruby "$GS"/test_*cov_patch.rb
run ruby "$GS/test_ci_routing_consistency.rb"
run ruby "$GS/test_ci_prepush_parity.rb"
run ruby "$GS/test_ci_prepush_parity.test.rb"
run python3 "$GS/test_dependabot_config.py"
run uv run --script --locked --no-build "$GS/test_config_read_sets.py"
run shellcheck "$GS/security-aggregate.sh" "$GS/security-aggregate.test.sh"
run shellcheck "$GS/sync-edge-runtime-secrets.sh" "$GS/promote-release-unit.sh"
run shellcheck "$GS/staging-smoke-check.sh" "$GS/staging-smoke-check.test.sh"
run shellcheck "infra/database-access/reset-staging-baseline.sh"
run shellcheck "$GS/download-release-cohort.sh" "$GS/download-release-cohort.test.sh"
run bash -c 'cd .github/scripts && shellcheck -x pr-verification-aggregate.sh pr-verification-gate.sh pr-verification-route.sh resolve-secret-scan-range.sh resolve-secret-scan-range.test.sh test_pr_verification_aggregate.sh test_pr_verification_route.sh test_pr_verification_gate_baseline.sh'
run bash scripts/semgrep-raw-sql-test.sh
run bash "$GS/test_run_actionlint.sh"
run ruby "$GS/test_actionlint_queue_contract.rb"
run bash "$GS/run-actionlint.sh"

printf 'quality: all checks passed\n'
