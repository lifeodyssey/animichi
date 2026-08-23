#!/usr/bin/env bash
# Deterministic Quality gate (#1003, AC5): every check and self-test from
# .github/workflows/pipeline-quality.yml, in CI's order, fail-fast. CI calls
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

# CI (pipeline-quality.yml) runs `ruby -c` once per file; a single invocation
# with several paths would only ever syntax-check the first one, silently
# skipping every later file — loop one path per `ruby -c`, fail-fast.
for ruby_file in \
  "$GS/assert-workflow-invariants.rb" \
  "$GS/assert-workflow-invariants-expression.rb" \
  "$GS/assert-workflow-invariants.test.rb" \
  "$GS/release-manifest-resolver.rb" \
  "$GS/release-manifest-resolver.test.rb" \
  "$GS/test_ci_contract.rb" \
  "$GS/test_ci_contract_security.rb" \
  "$GS/test_ci_contract_security_mutation.rb" \
  "$GS/test_ci_routing_consistency.rb" \
  "$GS/test_ci_contract_ruleset_migration.rb" \
  "$GS/test_ci_contract_ruleset_migration_mutation.rb" \
  "$GS/test_ci_contract_review_gate.rb" \
  "$GS/test_ci_contract_review_gate_mutation.rb" \
  "$GS/test_safe1_production_contract.rb" \
  "$GS/test_retention1_absence.rb" \
  "$GS/test_session3_staging_cutover.rb" \
  "$GS/test_session3_staging_cutover.test.rb" \
  "$GS/test_neon_test_infra_absence.rb" \
  "$GS/test_promotion_ac5_contract.rb" \
  "$GS/test_promotion_ac5_mutation.rb" \
  "$GS/test_prod_dsn_store_contract.rb" \
  "$GS/test_migrator_trigger_contract.rb" \
  "$GS/ci_prepush_parity.rb" \
  "$GS/ci_prepush_parity_yaml.rb" \
  "$GS/ci_prepush_parity_extract.rb" \
  "$GS/test_ci_prepush_parity.rb" \
  "$GS/test_ci_prepush_parity.test.rb" \
  "$GS/test_ci_contract_doorbell_web.rb" \
  "$GS/test_ci_contract_infra_split.rb" \
  "$GS/test_ci_contract_doorbell_workers.rb"; do
  run ruby -c "$ruby_file"
done
run ruby "$GS/assert-workflow-invariants.test.rb"
run ruby "$GS/assert-workflow-invariants.rb"
run ruby "$GS/test_safe1_production_contract.rb"
run ruby "$GS/test_retention1_absence.rb"
run ruby "$GS/test_session3_staging_cutover.rb"
run ruby "$GS/test_session3_staging_cutover.test.rb"
run ruby "$GS/test_prod_dsn_store_contract.rb"
run ruby "$GS/test_migrator_trigger_contract.rb"
run ruby "$GS/release-manifest-resolver.test.rb"
run bash "$GS/release-eligibility.test.sh"
run python3 "$GS/test_promotion_manifest.py"
run bash scripts/local-gates/promotion-manifest-e2e.test.sh
run python3 "$GS/test_promote_deployed.py"
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
run bash "$GS/check-edge-ratelimit-namespace.test.sh"
run ruby "$GS/test_ci_contract.rb"
run ruby "$GS/test_ci_contract_doorbell_web.rb"
run ruby "$GS/test_ci_contract_infra_split.rb"
run ruby "$GS/test_ci_contract_doorbell_workers.rb"
run ruby "$GS/test_ci_contract_security_mutation.rb"
run bash "$GS/security-aggregate.test.sh"
run env EXPECTED_SHA=0123456789abcdef0123456789abcdef01234567 ACTUAL_SHA=0123456789abcdef0123456789abcdef01234567 SECURITY_RESULT=success REQUIRE_CHILD_RESULTS=true SECURITY_RESULTS=$'gitleaks=success\ncodeql=success\nsemgrep=success' GITHUB_STEP_SUMMARY=/dev/null bash "$GS/security-aggregate.sh"
run ruby "$GS/test_neon_test_infra_absence.rb"
run ruby "$GS/test_ci_contract_ruleset_migration_mutation.rb"
run ruby "$GS"/test_*cov_patch.rb
run ruby "$GS/test_ci_routing_consistency.rb"
run ruby "$GS/test_ci_prepush_parity.rb"
run ruby "$GS/test_ci_prepush_parity.test.rb"
run python3 "$GS/test_dependabot_config.py"
run uv run --script --locked --no-build "$GS/test_config_read_sets.py"
run bash "$GS/post-deploy-assert.test.sh"
run bash "$GS/post-deploy-assert-probes.test.sh"
run bash "$GS/resolve-worker-url.test.sh"
run bash "$GS/vite-env-preflight.test.sh"
run bash "$GS/wrangler-secret-put.test.sh"
run shellcheck "$GS/post-deploy-assert.sh" "$GS/post-deploy-assert.test.sh" "$GS/post-deploy-assert-probes.test.sh" "$GS/edge-showcase-mode.sh" "$GS/mock-origin.sh" "$GS/resolve-worker-url.sh" "$GS/resolve-worker-url.test.sh" "$GS/vite-env-preflight.sh" "$GS/vite-env-preflight.test.sh" "$GS/wrangler-secret-put.sh" "$GS/wrangler-secret-put.test.sh" "$GS/security-aggregate.sh" "$GS/security-aggregate.test.sh"
run bash scripts/semgrep-raw-sql-test.sh
run actionlint

printf 'quality: all checks passed\n'
