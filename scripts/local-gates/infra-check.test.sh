#!/usr/bin/env bash
# Behavioral tests for the credential-free Pulumi program-load gate
# (scripts/local-gates/infra-check.sh), AC4/AC7.
#
# The gate must fail on a Pulumi loader/compiler error (the class ordinary
# tsc --noEmit misses), fail closed on an unknown preview failure, and pass
# (non-blocking) when only credential/provider noise appears. Red → restore →
# green probes exercise the allowlist boundary: a failure mode is red, then
# the restored run is green. pulumi is stubbed (scripts/local-gates/
# stub-env.sh + test-stub.sh); the pulumi binary never talks to a real backend.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/infra-check.sh"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
source "$SCRIPT_DIR/stub-env.sh"

run_gate() {
  local rc=0
  (
    cd "$REPO_ROOT"
    PATH="$GATE_STUB_BIN:$PATH" GATE_TEST_LOG="$GATE_STUB_ROOT/log" "$GATE"
  ) >"$GATE_STUB_ROOT/stdout" 2>&1 || rc=$?
  echo "$rc"
}

assert_msg() {
  grep -qF -- "$1" "$GATE_STUB_ROOT/stdout" || {
    echo "FAIL: output lacks: $1" >&2
    cat "$GATE_STUB_ROOT/stdout" >&2
    exit 1
  }
}

test_compile_failure_fails() {
  local rc
  rc="$(GATE_PULUMI_COMPILE_FAIL=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: loader/compiler error must fail the gate" >&2; exit 1; }
  assert_msg "Pulumi program-load/compile failure"
  echo "ok: loader/compiler error fails the gate"
}

test_credential_noise_is_non_blocking() {
  local rc
  rc="$(run_gate)" || true
  [ "$rc" = "0" ] || { echo "FAIL: provider noise must be non-blocking (exit $rc)" >&2; exit 1; }
  assert_msg "Pulumi program load: OK"
  echo "ok: credential/provider noise is non-blocking"
}

test_stack_init_failure_fails() {
  local rc
  rc="$(GATE_PULUMI_INIT_FAIL=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: stack init failure must fail the gate" >&2; exit 1; }
  assert_msg "pulumi stack init failed"
  echo "ok: pulumi stack init failure fails the gate"
}

assert_red_failure() {
  # A failure mode is red: nonzero exit plus the expected red marker in the
  # captured (shared) stdout.
  [ "$1" != "0" ] || { echo "FAIL: $2 must fail closed" >&2; exit 1; }
  assert_msg "$2"
}

assert_green_restore() {
  # The restored run is green again (red → restore → green probe).
  [ "$1" = "0" ] || { echo "FAIL: restored $2 must be green (exit $1)" >&2; exit 1; }
  assert_msg "$2"
}

test_unknown_preview_failure_red_restore_green() {
  local red green
  red="$(GATE_PULUMI_UNKNOWN_FAIL=1 run_gate)" || true
  assert_red_failure "$red" "Pulumi preview failed without a rendered plan"
  assert_msg "matrix core has been compromised"
  green="$(run_gate)" || true
  assert_green_restore "$green" "Pulumi program load: OK"
  echo "ok: unknown preview failure is red, restores to green"
}

test_allowed_no_token_noise_red_restore_green() {
  local rc
  rc="$(GATE_PULUMI_COMPILE_FAIL=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: loader/compiler error must be red" >&2; exit 1; }
  rc="$(run_gate)" || true
  [ "$rc" = "0" ] || { echo "FAIL: allowed noise must restore to green (exit $rc)" >&2; exit 1; }
  assert_msg "Pulumi program load: OK"
  echo "ok: allowed no-token/provider-noise case is green (restored)"
}

test_unknown_warning_red_restore_green() {
  local red green
  red="$(GATE_PULUMI_WARN_FAIL=1 run_gate)" || true
  assert_red_failure "$red" "diagnostics beyond the allowlisted"
  assert_msg "plugin has a newer version available"
  green="$(run_gate)" || true
  assert_green_restore "$green" "Pulumi program load: OK"
  echo "ok: unknown warning/diagnostic is red, restores to green"
}

assert_red_failure_msg() {
  # $1 = probe exit code, $2 = red marker, $3 = extra captured message.
  assert_red_failure "$1" "$2"
  assert_msg "$3"
}

# `Error:` must be recognized as a diagnostic case-insensitively: it is not
# on the allowlist, so a nonzero preview carrying it fails closed even with a
# rendered plan.
test_capitalized_error_red_restore_green() {
  local red green
  red="$(GATE_PULUMI_CAP_ERROR_FAIL=1 run_gate)" || true
  assert_red_failure_msg "$red" "diagnostics beyond the allowlisted" "Error: the matrix core has been compromised"
  green="$(run_gate)" || true
  assert_green_restore "$green" "Pulumi program load: OK"
  echo "ok: capitalized Error: is red, restores to green"
}

test_typeerror_red_restore_green() {
  # TypeError: is a runtime/compiler signature — fatal, fail-closed.
  local red green
  red="$(GATE_PULUMI_TYPEERROR_FAIL=1 run_gate)" || true
  assert_red_failure "$red" "Pulumi program-load/compile failure"
  assert_msg "TypeError: cannot read properties of undefined"
  green="$(run_gate)" || true
  assert_green_restore "$green" "Pulumi program load: OK"
  echo "ok: TypeError: is red, restores to green"
}

test_unknown_plain_text_red_restore_green() {
  # Unknown plain-text output with no diagnostic prefix fails closed even when
  # a rendered plan exists.
  local red green
  red="$(GATE_PULUMI_PLAIN_FAIL=1 run_gate)" || true
  assert_red_failure_msg "$red" "diagnostics beyond the allowlisted" "the matrix core has been compromised"
  green="$(run_gate)" || true
  assert_green_restore "$green" "Pulumi program load: OK"
  echo "ok: unknown plain-text output is red, restores to green"
}

test_plan_without_diagnostic_red_restore_green() {
  # A nonzero preview with a rendered plan but NO allowlisted diagnostic at
  # all is an unexplained failure — fail closed.
  local red green
  red="$(GATE_PULUMI_PLAN_ONLY_FAIL=1 run_gate)" || true
  assert_red_failure "$red" "no allowlisted credential/provider/config diagnostic"
  green="$(run_gate)" || true
  assert_green_restore "$green" "Pulumi program load: OK"
  echo "ok: rendered plan with no allowlisted diagnostic is red, restores to green"
}

test_compile_failure_fails
test_credential_noise_is_non_blocking
test_stack_init_failure_fails
test_unknown_preview_failure_red_restore_green
test_allowed_no_token_noise_red_restore_green
test_unknown_warning_red_restore_green
test_capitalized_error_red_restore_green
test_typeerror_red_restore_green
test_unknown_plain_text_red_restore_green
test_plan_without_diagnostic_red_restore_green
echo "infra-check.test.sh: all green"
