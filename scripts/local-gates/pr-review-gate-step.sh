#!/usr/bin/env bash
# One-shot required-PR-gate step for pipeline-quality.yml (issue #1008 §7).
#
# The workflow orchestrates the head-bound status so a stale success can never
# survive a PR comment/review change:
#
#   resolve-head  <event> <repo> <pr> <issue> <pull-url>  -> prints the PR head SHA
#   collect-check <repo> <pinned> <event> <pr> <issue> <pull-url>
#   final-status  <repo> <pinned> <outcome>
#
# `resolve-head` resolves the PR head once at the very start of the PR-only
# path and prints the exact 40-hex SHA; the workflow posts the pending status
# on it *before* the expensive quality steps and passes the same pin through
# `collect-check` and `final-status` (issue #1008 finding 2). `collect-check`
# fails closed when the live PR head advanced past the pin — the workflow then
# posts failure with `if: always()` semantics, never a stale success.
# Plain issue comments, push, and merge_group resolve to no PR and never post a
# fake PR review result. Every boundary fails closed: an unresolvable head, an
# advanced head, a failed collect/check, or an unpostable status exits non-zero
# so the required `Quality / invariants` job fails and GitHub blocks the merge.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/scripts/local-gates/pr-review-check.sh"

# Resolve the PR number for the event; returns 1 when there is no PR to gate
# (plain issue comments, push, merge_group) so the caller skips cleanly.
skip() { # skip <reason>
  printf '%s\n' "$1; skipping review gate" >&2
  return 1
}

pr_for_event() { # pr_for_event <event> <pr> <issue> <pull-url>
  case "$1" in
    pull_request | pull_request_review | pull_request_review_comment) printf '%s' "$2" ;;
    issue_comment) [ -n "$4" ] && printf '%s' "$3" || skip "issue comment is not on a pull request" ;;
    *) skip "no PR context ($1)" ;;
  esac
}

head_of() { # head_of <pr> <repo>
  gh pr view "$1" -R "$2" --json headRefOid --jq .headRefOid
}

block() { # block <message>
  printf '%s\n' "BLOCKED: $1" >&2
  exit 2
}

valid_sha() { # valid_sha <sha>
  printf '%s' "$1" | grep -qE '^[0-9a-f]{40}$'
}

# Print the exact PR head for the event, or nothing (exit 0) when the event has
# no PR to gate. The workflow uses this to pin the head before any quality step.
# A successful-but-empty or malformed `gh pr view` output is a hard block, never
# a skipped gate: the workflow decides `has_pr` from this single non-empty
# 40-hex output, so an unvalidated value would fail open (finding 1).
cmd_resolve_head() { # cmd_resolve_head <event> <repo> <pr> <issue> <pull-url>
  [ "$#" -eq 5 ] || usage
  local pr_number head_sha
  pr_number="$(pr_for_event "$1" "$3" "$4" "$5" || true)"
  [ -n "$pr_number" ] || return 0
  head_sha="$(head_of "$pr_number" "$2")" || block "cannot resolve the PR head for PR #$pr_number"
  valid_sha "$head_sha" || block "resolved an invalid PR head for PR #$pr_number: $head_sha"
  printf '%s\n' "$head_sha"
}

# The live PR head must still equal the pinned head resolved at the start;
# a PR that advanced between resolution and collection is a hard block — the
# result must never be posted against the old head (issue #1008 finding 2).
gate_head() { # gate_head <pr> <repo> <pinned>
  valid_sha "$3" || block "invalid pinned head SHA: $3"
  local live
  live="$(head_of "$1" "$2")" || block "cannot resolve the live PR head for PR #$1"
  [ "$live" = "$3" ] || block "PR head advanced since resolution (pinned $3, live $live); re-evaluate before merging"
}

run_collect() { # run_collect <pr> <repo> <pinned>
  GATE_COLLECT_DIR="$(mktemp -d)"
  trap 'rm -rf "$GATE_COLLECT_DIR"' EXIT
  "$GATE" collect "$GATE_COLLECT_DIR" --pr "$1" --repo "$2" --pinned-head "$3"
  "$GATE" check "$GATE_COLLECT_DIR"
}

cmd_collect_check() { # cmd_collect_check <repo> <pinned> <event> <pr> <issue> <pull-url>
  [ "$#" -eq 6 ] || usage
  local pr_number
  pr_number="$(pr_for_event "$3" "$4" "$5" "$6")" || return 0
  gate_head "$pr_number" "$1" "$2"
  run_collect "$pr_number" "$1" "$2"
}

# Map the gate step's outcome to a head-bound status state: any non-success
# (failure, cancelled, or skipped) posts failure so no stale green survives.
cmd_final_status() { # cmd_final_status <repo> <pinned> <outcome>
  [ "$#" -eq 3 ] || usage
  local state="failure"
  [ "$3" = "success" ] && state="success"
  "$GATE" status "$1" "$2" "$state"
}

usage() {
  printf '%s\n' "usage: pr-review-gate-step.sh <resolve-head|collect-check|final-status> ..." >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
sub="$1"
shift || true

case "$sub" in
  resolve-head) cmd_resolve_head "$@" ;;
  collect-check) cmd_collect_check "$@" ;;
  final-status) cmd_final_status "$@" ;;
  *) usage ;;
esac
