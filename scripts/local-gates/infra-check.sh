#!/usr/bin/env bash
# Credential-free Pulumi program-load check (#1003, AC7).
#
# Loads the infra program through the REAL Pulumi language host against a
# throwaway file:// backend — the same loader whose compiler-incompatibility
# failure (TS5096) reached CI while ordinary `tsc --noEmit` stayed green. The
# throwaway stack sets a single documented non-secret placeholder for the
# required cloudflareAccountId and never touches cloud credentials or applies
# anything. A zero preview exit is green. A nonzero preview exit is green only
# when the output proves the program loaded AND every diagnostic is explicitly
# allowlisted credential/provider/config noise; TypeScript, runtime/compiler/
# load errors, missing entry points, unknown failures, unknown plain-text
# output, and malformed output fail closed with the captured output.
#
# Diagnostic classification is strict, anchored, and case-insensitive:
# prefixes (Error:, error:, TypeError:, warning:, ...) are recognized
# case-insensitively, and a nonzero preview must carry at least one
# allowlisted diagnostic to be explainable. A rendered plan alone is not
# proof of health — unknown plain-text lines and plan-with-no-diagnostic
# failures stay red.
#
# Behavioral tests: infra-check.test.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
# pulumi stack init writes the stack's config file into the project dir; the
# gate owns that file only when it created it — a pre-existing
# infra/Pulumi.preflight.yaml is the user's, never deleted.
PREFLIGHT_STACK="$ROOT/infra/Pulumi.preflight.yaml"
preflight_existed=false
if [ -e "$PREFLIGHT_STACK" ]; then
  preflight_existed=true
fi
cleanup_preflight() {
  rm -rf "$WORK"
  if [ "$preflight_existed" = false ]; then
    rm -f "$PREFLIGHT_STACK"
  fi
}
trap cleanup_preflight EXIT
mkdir -p "$WORK/backend"

# Documented non-secret placeholder for the required cloudflareAccountId
# (see docs/ops/local-gates.md). Preview derives resource names locally and
# never contacts Cloudflare, so a clearly-fake id is sufficient.
PLACEHOLDER_ACCOUNT_ID="00000000000000000000000000000000"

# Fail-closed signatures: the program did not load, or died before a plan.
# Matched case-insensitively so `TypeError:` / `TSError:`-style output is
# caught regardless of capitalization.
FATAL_RE='TSError|TypeError|Unable to compile|SyntaxError|Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Could not find entry point|failed with an unhandled exception'

# Allowlisted diagnostics for a loaded, credential-free program (cloudflare
# credential/provider/config noise only). Matched case-insensitively with
# optional leading whitespace, and each entry is a COMPLETE documented
# diagnostic shape: the phrase must be followed by a non-`:` character or the
# end of the line, so `error: Unauthorized: unrelated runtime failure` (a
# trailing `: ...` after an allowlisted phrase) is NOT treated as allowlisted
# and fails closed through classify_line. Anything with a recognized prefix
# that is not allowlisted fails closed too.
NOISE_RE='^[[:space:]]*(error|warning|info): (missing api token for cloudflare|missing required configuration variable|could not get the current authenticated user|invalid access token|authentication failed|unauthorized)([^:]|$)'

# Proof the program loaded: Pulumi rendered a plan for the stack.
LOADED_RE='Previewing update|pulumi:pulumi:Stack'

# Non-diagnostic lines that legitimately appear in a rendered plan: headers,
# resource/type rows and provider diag headers (three colon-separated parts),
# change counts, and the table column header.
PLAN_RE='^(Previewing update|View in Browser|Diagnostics:|Resources:|Outputs:|Duration:|Changes:|No changes|Nothing to do|Update Summary)|^[[:space:]]*[+~-]?[[:space:]]*[├└│╰╭]?[[:space:]]*[A-Za-z0-9_./-]+:[A-Za-z0-9_./-]+:[A-Za-z0-9_./-]+|^[[:space:]]*[+~-]?[[:space:]]*[0-9]+ (created|updated|deleted|unchanged|to create|to update|to delete|to replace)|^[[:space:]]*Type[[:space:]]+.*Plan[[:space:]]*$'

OUT="$WORK/preview.log"

# Run a pulumi command in the infra program against the throwaway file://
# backend. Exit status is the command's — callers decide green vs fail-closed.
pulumi_backend() {
  (
    cd "$ROOT/infra"
    PULUMI_BACKEND_URL="file://$WORK/backend" PULUMI_CONFIG_PASSPHRASE=preflight "$@"
  )
}

init_stack() {
  if ! pulumi_backend pulumi stack init preflight >/dev/null 2>&1; then
    echo "pulumi stack init failed against the throwaway backend — is the Pulumi CLI working?" >&2
    exit 1
  fi
}

set_placeholder_config() {
  if ! pulumi_backend pulumi config set --stack preflight \
    seichijunrei-infra:cloudflareAccountId "$PLACEHOLDER_ACCOUNT_ID" >/dev/null 2>&1; then
    echo "pulumi config set failed against the throwaway backend — is the Pulumi CLI working?" >&2
    exit 1
  fi
}

run_preview() {
  pulumi_backend pulumi preview --non-interactive --stack preflight >"$OUT" 2>&1
}

fail_closed() {
  echo "$1" >&2
  echo "--- captured pulumi output:" >&2
  cat "$OUT" >&2
  exit 1
}

loaded_or_fail() {
  grep -qE "$LOADED_RE" "$OUT" || fail_closed "Pulumi preview failed without a rendered plan — unknown failure or malformed output:"
}

fatal_or_fail() {
  if grep -qiE "$FATAL_RE" "$OUT"; then
    fail_closed "Pulumi program-load/compile failure (ordinary tsc --noEmit does not exercise this path):"
  fi
}

has_allowlisted_noise() {
  grep -qiE "$NOISE_RE" "$OUT"
}

# classify_line: 0 = acceptable plan/noise line, 1 = unknown output. Whitespace-
# only lines are plan separators. Anything that is neither an allowlisted
# diagnostic nor a rendered-plan line is unknown plain text and fails closed.
classify_line() {
  local line="$1"
  case "$line" in
    *[![:space:]]*) ;;
    *) return 0 ;;
  esac
  grep -qiE "$NOISE_RE" <<<"$line" && return 0
  grep -qE "$PLAN_RE" <<<"$line" && return 0
  return 1
}

diagnostics_only_or_fail() {
  local line
  while IFS= read -r line; do
    classify_line "$line" || fail_closed "Pulumi preview failed with diagnostics beyond the allowlisted credential/provider/config noise:"
  done <"$OUT"
}

# classify_preview: green only for a clean exit or a rendered plan whose every
# line is allowlisted noise; anything else fails closed.
preview_clean() {
  echo "Pulumi program load: OK (preview exited clean)"
}

noise_only_or_fail() {
  if has_allowlisted_noise; then
    echo "Pulumi program load: OK (credential/provider noise without secrets is expected and non-blocking)"
    return 0
  fi
  fail_closed "Pulumi preview failed with a rendered plan but no allowlisted credential/provider/config diagnostic:"
}

classify_preview() {
  local rc="$1"
  if [ "$rc" -eq 0 ]; then preview_clean; return 0; fi
  fatal_or_fail
  loaded_or_fail
  diagnostics_only_or_fail
  noise_only_or_fail
}

init_stack
set_placeholder_config
rc=0
run_preview || rc=$?
classify_preview "$rc"
