#!/usr/bin/env bash
# Behavioral tests for the unauthorized-diagnostic boundary of the
# credential-free Pulumi program-load gate (scripts/local-gates/infra-check.sh),
# AC4/AC7 #1003.
#
# A COMPLETE `error: Unauthorized` line is allowlisted (non-blocking); a
# trailing `: ...` detail means a DIFFERENT runtime failure and must fail
# closed, even when allowlisted credential noise appears in the same preview
# (the fail-open hole has_allowlisted_noise could otherwise turn green).
# pulumi is stubbed (stub-env.sh + test-stub.sh); the pulumi binary never
# talks to a real backend.
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

# #1003 regression: the allowlist matches COMPLETE documented diagnostic
# shapes (optional leading whitespace). A complete `error: Unauthorized` line
# is non-blocking; a trailing `: ...` after `unauthorized` means a DIFFERENT
# runtime failure and must fail closed.
test_complete_unauthorized_shape_is_allowed() {
  local rc
  rc="$(GATE_PULUMI_UNAUTHORIZED_ALLOWED=1 run_gate)" || true
  [ "$rc" = "0" ] || { echo "FAIL: a complete Unauthorized diagnostic must be non-blocking (exit $rc)" >&2; exit 1; }
  assert_msg "Pulumi program load: OK"
  echo "ok: a complete (indented) Unauthorized diagnostic is non-blocking"
}

test_unauthorized_with_trailing_detail_fails_closed() {
  local rc
  rc="$(GATE_PULUMI_UNAUTHORIZED_UNKNOWN=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: Unauthorized with a trailing : detail must fail closed" >&2; exit 1; }
  assert_msg "diagnostics beyond the allowlisted"
  assert_msg "error: Unauthorized: unrelated runtime failure"
  echo "ok: Unauthorized with a trailing : ... detail is unknown output, fails closed"
}

# #1003 fail-open hole: allowlisted noise + COMPACT `error:Unauthorized:
# <detail>` (a PLAN_RE `a:b:c` resource-row form) in ONE preview must stay red —
# only is_unknown_diagnostic catches it, so deleting it makes the test go green.
test_mixed_noise_and_unauthorized_detail_red() {
  local rc
  rc="$(GATE_PULUMI_UNAUTHORIZED_MIXED=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: allowlisted noise + Unauthorized: detail must fail closed" >&2; exit 1; }
  assert_msg "diagnostics beyond the allowlisted"
  assert_msg "error:Unauthorized:unrelated-runtime-failure"
  echo "ok: allowlisted noise with an Unauthorized: ... detail stays red"
}

# #1003 fail-open hole: a final diagnostic WITHOUT a trailing newline must
# still be classified — `read` returns 1 at EOF but fills $line, and dropping
# it would let the allowlisted noise alone turn the preview green.
test_final_line_without_newline_fails_closed() {
  local rc
  rc="$(GATE_PULUMI_NO_NL=1 run_gate)" || true
  [ "$rc" != "0" ] || { echo "FAIL: a final diagnostic without a trailing newline must fail closed" >&2; exit 1; }
  assert_msg "diagnostics beyond the allowlisted"
  assert_msg "error:Unauthorized:no-nl"
  echo "ok: a final unterminated diagnostic is still classified, fails closed"
}

# #1003 regression: the gate must never delete a PRE-EXISTING
# infra/Pulumi.preflight.yaml — the stack config file the real `pulumi stack
# init` creates in the project dir is removed only when the gate itself
# created it. The test backs up a real developer file to mktemp before
# overwriting it and restores it on EXIT, so the repo file survives the test
# run byte-for-byte; when the file did not exist before, only the file this
# test created is removed.
restore_preflight_test_file() {
  if [ -n "${PREFLIGHT_TEST_BACKUP:-}" ]; then
    cp "$PREFLIGHT_TEST_BACKUP" "$REPO_ROOT/infra/Pulumi.preflight.yaml"
    rm -f "$PREFLIGHT_TEST_BACKUP"
  else
    rm -f "$REPO_ROOT/infra/Pulumi.preflight.yaml"
  fi
}

backup_preflight_test_file() {
  local preflight="$REPO_ROOT/infra/Pulumi.preflight.yaml"
  PREFLIGHT_TEST_BACKUP=""
  if [ -e "$preflight" ]; then
    PREFLIGHT_TEST_BACKUP="$(mktemp)"
    cp "$preflight" "$PREFLIGHT_TEST_BACKUP"
  fi
}

assert_preflight_kept() {
  [ "$2" = "0" ] || { echo "FAIL: gate exited $2 with a pre-existing stack file" >&2; exit 1; }
  grep -qF "keep" "$1" || { echo "FAIL: a pre-existing infra/Pulumi.preflight.yaml was deleted" >&2; exit 1; }
}

test_preexisting_preflight_yaml_survives() {
  local preflight rc
  preflight="$REPO_ROOT/infra/Pulumi.preflight.yaml"
  backup_preflight_test_file
  trap restore_preflight_test_file EXIT
  printf 'keep\n' > "$preflight"
  rc="$(run_gate)" || true
  assert_preflight_kept "$preflight" "$rc"
  echo "ok: a pre-existing infra/Pulumi.preflight.yaml is never deleted"
}

test_complete_unauthorized_shape_is_allowed
test_unauthorized_with_trailing_detail_fails_closed
test_mixed_noise_and_unauthorized_detail_red
test_final_line_without_newline_fails_closed
test_preexisting_preflight_yaml_survives
echo "infra-check-unauthorized.test.sh: all green"
