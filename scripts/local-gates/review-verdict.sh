#!/usr/bin/env bash
# Local review verdict gate — emit, validate, and judge the head-bound verdict
# artifact of the Standards∥Spec review (issue #1008; contract:
# docs/ops/review-gate.md).
#
#   review-verdict.sh digest  <brief-file>              # print brief sha256
#   review-verdict.sh validate <verdict.json>           # schema check, exit 0/1
#   review-verdict.sh gate     <verdict.json> [--brief FILE] [--base SHA] [--head SHA]
#
# `gate` prints one JSON object and exits 0 only on approve. When --base is not
# given it resolves the real merge-base of origin/main and HEAD — never a
# guessed HEAD^ — and fails closed (exit 2) when origin/main or the merge-base
# cannot be resolved (issue #1008 review finding 1). Tests override the git
# root with REVIEW_GATE_GIT_ROOT to exercise resolution deterministically.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODULE="$ROOT/scripts/local-gates/review_verdict_cli.py"
GIT_ROOT="${REVIEW_GATE_GIT_ROOT:-$ROOT}"

usage() {
  printf '%s\n' "usage: review-verdict.sh <digest|validate|gate> ..." >&2
  exit 2
}

block() { # block <message>
  printf '%s\n' "BLOCKED: $1" >&2
  exit 2
}

# Parse gate flags; sets VERDICT_ARG, BRIEF_ARG, BASE_ARG, HEAD_ARG.
gate_opts() {
  while [ "$#" -gt 0 ]; do case "$1" in
    --brief) BRIEF_ARG="${2:?--brief needs a file}"; shift 2 ;;
    --base) BASE_ARG="$2"; shift 2 ;;
    --head) HEAD_ARG="$2"; shift 2 ;;
    *) VERDICT_ARG="$1"; shift ;;
  esac; done
}

# Resolve the merge-base of origin/main and HEAD, or fail closed. An explicit
# --base always wins (issue #1008 review finding 1).
resolve_merge_base() { # resolve_merge_base <base>
  if [ -n "$1" ]; then printf '%s' "$1"; return 0; fi
  local base
  base="$(git -C "$GIT_ROOT" merge-base origin/main HEAD 2>/dev/null)" || true
  [ -n "$base" ] || block "cannot resolve the merge-base of origin/main and HEAD in $GIT_ROOT; pass --base explicitly."
  printf '%s' "$base"
}

# Resolve the gate head; empty when unresolvable (the gate then blocks).
resolve_head() { # resolve_head <head>
  if [ -n "$1" ]; then printf '%s' "$1"; return 0; fi
  local head
  head="$(git -C "$GIT_ROOT" rev-parse --verify --quiet HEAD 2>/dev/null)" || true
  printf '%s' "$head"
}

cmd_gate() {
  VERDICT_ARG=""; BRIEF_ARG=""; BASE_ARG=""; HEAD_ARG=""
  gate_opts "$@"
  [ -n "$VERDICT_ARG" ] || usage
  BASE_ARG="$(resolve_merge_base "$BASE_ARG")"
  HEAD_ARG="$(resolve_head "$HEAD_ARG")"
  [ -n "$BASE_ARG" ] && [ -n "$HEAD_ARG" ] || block "cannot resolve base/head for the verdict gate; pass --base and --head explicitly."
  [ -n "$BRIEF_ARG" ] || block "gate requires --brief <file> to verify the pinned brief digest; a missing brief is a block, not a pass."
  python3 "$MODULE" gate "$VERDICT_ARG" --base "$BASE_ARG" --head "$HEAD_ARG" --brief "$BRIEF_ARG"
}

[ "$#" -ge 1 ] || usage
sub="$1"
shift || true

case "$sub" in
  digest)
    [ "$#" -eq 1 ] || usage
    python3 "$MODULE" digest "$1"
    ;;
  validate)
    [ "$#" -eq 1 ] || usage
    python3 "$MODULE" validate "$1"
    ;;
  gate)
    cmd_gate "$@"
    ;;
  *)
    usage
    ;;
esac
