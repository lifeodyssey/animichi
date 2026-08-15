#!/usr/bin/env bash
# Deterministic Quality gate (#1003, AC5): every check and self-test from
# .github/workflows/pipeline-quality.yml, in CI's order, fail-fast. CI calls
# the very same scripts — nothing here is a weaker duplicate. The only
# locally-pinned tool is actionlint (CI pins v1.7.7); the binary is a
# prerequisite, never downloaded during a push.
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
  "$GS/test_safe1_production_contract.rb" \
  "$GS/test_retention1_absence.rb" \
  "$GS/test_session3_staging_cutover.rb" \
  "$GS/test_prod_dsn_store_contract.rb"; do
  run ruby -c "$ruby_file"
done
run ruby "$GS/assert-workflow-invariants.test.rb"
run ruby "$GS/assert-workflow-invariants.rb"
run ruby "$GS/test_safe1_production_contract.rb"
run ruby "$GS/test_retention1_absence.rb"
run ruby "$GS/test_session3_staging_cutover.rb"
run ruby "$GS/test_prod_dsn_store_contract.rb"
run ruby "$GS/release-manifest-resolver.test.rb"
run bash "$GS/release-eligibility.test.sh"
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
run ruby "$GS"/test_*cov_patch.rb
run actionlint

printf 'quality: all checks passed\n'
