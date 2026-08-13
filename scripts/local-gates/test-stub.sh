#!/usr/bin/env bash
# Universal tool stub for local-gate behavioral tests.
#
# Records every invocation to $GATE_TEST_LOG as "PWD :: argv", logs the
# VITE_SHOWCASE_MODE environment for pnpm invocations (the web build gate
# depends on it), fakes the few commands the gates parse (docker run/port,
# pulumi preview classification), and exits 1 for any invocation matching
# $GATE_FAIL_ON so tests can exercise fail-fast propagation. Dedicated env
# switches simulate the fail-closed prerequisite conditions the gates must
# detect: GATE_DOCKER_UNAVAILABLE (daemon down), GATE_DOCKER_IMAGE_MISSING,
# GATE_PULUMI_INIT_FAIL, GATE_PULUMI_COMPILE_FAIL (loader/compiler error),
# GATE_PULUMI_UNKNOWN_FAIL (nonzero preview with an unrecognized error),
# GATE_PULUMI_WARN_FAIL (rendered plan + allowlisted noise + an unknown
# warning), GATE_PULUMI_CAP_ERROR_FAIL (rendered plan + capitalized Error:),
# GATE_PULUMI_TYPEERROR_FAIL (rendered plan + TypeError:), GATE_PULUMI_PLAIN_FAIL
# (rendered plan + unknown plain text), GATE_PULUMI_PLAN_ONLY_FAIL (rendered
# plan with no diagnostic at all), GATE_PULUMI_UNAUTHORIZED_ALLOWED (rendered
# plan + a complete indented `error: Unauthorized` line),
# GATE_PULUMI_UNAUTHORIZED_UNKNOWN (rendered plan + `error: Unauthorized:
# unrelated runtime failure` — a trailing `: ...` after unauthorized is NOT
# allowlisted), and GATE_PULUMI_UNAUTHORIZED_MIXED (rendered plan + allowlisted
# noise + the COMPACT `error:Unauthorized:unrelated-runtime-failure` — a PLAN_RE
# `a:b:c` resource-row form the classifier must keep red via
# is_unknown_diagnostic, the fail-open hole), and GATE_PULUMI_NO_NL (rendered
# plan + allowlisted noise + a final `error:Unauthorized:no-nl` printed with
# no trailing newline — a read-EOF line the classifier must still process).
# The default pulumi preview
# emission is the
# allowed-noise case: a rendered plan line plus credential/provider noise,
# exiting nonzero.
set -u

log() { printf '%s :: %s %s\n' "$PWD" "$(basename "$0")" "$*" >> "${GATE_TEST_LOG:?}"; }

log "$@"
tool="$(basename "$0")"
case "$tool:$*" in
  pnpm:*) printf 'env VITE_SHOWCASE_MODE=%s\n' "${VITE_SHOWCASE_MODE:-}" >> "${GATE_TEST_LOG:?}" ;;
  pulumi:stack\ init*) [ "${GATE_PULUMI_INIT_FAIL:-}" = "1" ] && exit 1 ;;
  pulumi:preview*)
    if [ "${GATE_PULUMI_COMPILE_FAIL:-}" = "1" ]; then
      printf 'error: TSError: failed to compile the infra program\n' >&2
    elif [ "${GATE_PULUMI_UNKNOWN_FAIL:-}" = "1" ]; then
      printf 'error: matrix core has been compromised\n' >&2
    elif [ "${GATE_PULUMI_CAP_ERROR_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'Error: the matrix core has been compromised\n' >&2
    elif [ "${GATE_PULUMI_TYPEERROR_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'TypeError: cannot read properties of undefined\n' >&2
    elif [ "${GATE_PULUMI_PLAIN_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'the matrix core has been compromised\n' >&2
    elif [ "${GATE_PULUMI_PLAN_ONLY_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf '+   pulumi:pulumi:Stack seichijunrei-infra create\n' >&2
    elif [ "${GATE_PULUMI_WARN_FAIL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'error: Missing API token for cloudflare\n' >&2
      printf 'warning: plugin has a newer version available\n' >&2
    elif [ "${GATE_PULUMI_UNAUTHORIZED_ALLOWED:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf '  error: Unauthorized\n' >&2
    elif [ "${GATE_PULUMI_UNAUTHORIZED_UNKNOWN:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'error: Unauthorized: unrelated runtime failure\n' >&2
    elif [ "${GATE_PULUMI_UNAUTHORIZED_MIXED:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'error: Missing API token for cloudflare\n' >&2
      printf 'error:Unauthorized:unrelated-runtime-failure\n' >&2
    elif [ "${GATE_PULUMI_NO_NL:-}" = "1" ]; then
      printf 'Previewing update (preflight):\n'
      printf 'error: Missing API token for cloudflare\n' >&2
      printf 'error:Unauthorized:no-nl' >&2
    else
      printf 'Previewing update (preflight):\n'
      printf 'error: Missing API token for cloudflare\n' >&2
    fi
    exit 1 ;;
  docker:info*) [ "${GATE_DOCKER_UNAVAILABLE:-}" = "1" ] && exit 1 ;;
  docker:run*) printf 'gate-cid\n' ;;
  docker:port*) printf '0.0.0.0:5433\n' ;;
  "docker:image inspect"*) [ "${GATE_DOCKER_IMAGE_MISSING:-}" = "1" ] && exit 1 ;;
esac
if [ -n "${GATE_FAIL_ON:-}" ]; then
  case "$*" in
    *"$GATE_FAIL_ON"*) exit 1 ;;
  esac
fi
exit 0
