#!/usr/bin/env bash
# Trusted producer for the classic `Review Gate` commit status.
# The workflow checks out this script only from an immutable default-branch SHA.
# Candidate commits are data: PR heads are inspected by GitHub APIs, never run.
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
    pull_request_target | pull_request_review | pull_request_review_comment) printf '%s' "$2" ;;
    issue_comment)
      if [ -n "$4" ]; then printf '%s' "$3"; else skip "issue comment is not on a pull request"; fi
      ;;
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

write_target() { # write_target <kind> <sha> <pr>
  [ -n "${GITHUB_OUTPUT:-}" ] || block "GITHUB_OUTPUT is required"
  printf 'has_target=true\ntarget_kind=%s\nhead_sha=%s\npr_number=%s\n' "$1" "$2" "$3" >> "$GITHUB_OUTPUT"
}

resolve_pr_target() { # resolve_pr_target <event> <repo> <pr> <issue> <url>
  local pr_number head_sha
  pr_number="$(pr_for_event "$1" "$3" "$4" "$5" || true)"
  [ -n "$pr_number" ] || return 0
  printf '%s' "$pr_number" | grep -qE '^[0-9]+$' || block "invalid PR number"
  head_sha="$(head_of "$pr_number" "$2")" || block "cannot resolve PR #$pr_number"
  valid_sha "$head_sha" || block "invalid PR head for #$pr_number"
  write_target pr "$head_sha" "$pr_number"
}

resolve_queue_target() { # resolve_queue_target <run-event> <sha> <run-id>
  [ "$1" = "merge_group" ] || return 0
  valid_sha "$2" || block "invalid merge-group SHA: $2"
  printf '%s' "$3" | grep -qE '^[0-9]+$' || block "invalid CI run id: $3"
  write_target queue "$2" ""
}

cmd_resolve_target() { # event repo pr issue url run-event conclusion run-sha run-id
  [ "$#" -eq 9 ] || usage
  if [ "$1" = "workflow_run" ]; then
    resolve_queue_target "$6" "$8" "$9"
    return 0
  fi
  resolve_pr_target "$1" "$2" "$3" "$4" "$5"
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

set_gate_state() { # set_gate_state <state>
  [ -n "${GITHUB_OUTPUT:-}" ] || return 0
  printf 'gate_state=%s\n' "$1" >> "$GITHUB_OUTPUT"
}

gate_state() { # gate_state <check-output>
  printf '%s\n' "$1" | python3 -c 'import json, sys; print(json.load(sys.stdin)["state"])'
}

check_state_result() { # check_state_result <state> <exit>
  case "$1:$2" in
    success:0 | pending:1) return 0 ;;
    failure:1) return 1 ;;
  esac
  return 2
}

run_check() { # run_check <dir>
  local output rc state
  output="$("$GATE" check "$1" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$output"
  state="$(gate_state "$output")" || { set_gate_state failure; return 2; }
  set_gate_state "$state"
  check_state_result "$state" "$rc"
}

run_collect_state() { # run_collect_state <pr> <repo> <pinned>
  local dir output rc state
  dir="$(mktemp -d)"
  "$GATE" collect "$dir" --pr "$1" --repo "$2" --pinned-head "$3" || { rm -rf "$dir"; return 2; }
  output="$("$GATE" check "$dir" 2>&1)" && rc=0 || rc=$?
  rm -rf "$dir"
  state="$(gate_state "$output")" || return 2
  check_state_result "$state" "$rc" || return $?
  printf '%s\n' "$state"
}

cmd_collect_check() { # cmd_collect_check <repo> <pinned> <event> <pr> <issue> <pull-url>
  [ "$#" -eq 6 ] || usage
  local pr_number
  pr_number="$(pr_for_event "$3" "$4" "$5" "$6")" || return 0
  gate_head "$pr_number" "$1" "$2"
  local state
  state="$(run_collect_state "$pr_number" "$1" "$2")" || return $?
  set_gate_state "$state"
}

status_url() { # status_url <repo> <run-id> <attempt>
  printf 'https://github.com/%s/actions/runs/%s/attempts/%s' "$1" "$2" "$3"
}

post_owned_status() { # repo sha state run-id attempt
  local url description
  valid_sha "$2" || block "invalid status SHA: $2"
  url="$(status_url "$1" "$4" "$5")"
  description="trusted review generation $4/$5"
  gh api "repos/${1%%/*}/${1##*/}/statuses/$2" -f state="$3" -f context='Review Gate' -f target_url="$url" -f description="$description" --jq .state >/dev/null || block "cannot post $3 status on $2"
}

latest_owner() { # latest_owner <repo> <sha>
  gh api "repos/${1%%/*}/${1##*/}/commits/$2/statuses?per_page=100" --jq 'map(select(.context == "Review Gate"))[0].target_url // ""'
}

cmd_claim_status() { # cmd_claim_status <repo> <sha> <run-id> <attempt>
  [ "$#" -eq 4 ] || usage
  post_owned_status "$1" "$2" pending "$3" "$4"
}

final_state() { # final_state <job-status> <gate-state>
  if [ "$1" = "success" ]; then
    case "$2" in success | pending) printf '%s' "$2"; return 0 ;; esac
  fi
  printf failure
}

cmd_finish_status() { # repo sha run-id attempt job-status gate-state
  [ "$#" -eq 6 ] || usage
  local expected owner state
  expected="$(status_url "$1" "$3" "$4")"
  owner="$(latest_owner "$1" "$2")" || block "cannot read current status owner"
  [ "$owner" = "$expected" ] || { printf '%s\n' "superseded generation; not publishing"; return 0; }
  state="$(final_state "$5" "$6")"
  post_owned_status "$1" "$2" "$state" "$3" "$4"
}

validate_workflow_run() { # validate_workflow_run <repo> <sha> <run-id>
  printf '%s' "$3" | grep -qE '^[0-9]+$' || block "invalid CI run id: $3"
  local actual expected run_id="$3"
  actual="$(gh api "repos/$1/actions/runs/$run_id" --jq '[.id,.repository.full_name,.event,.head_sha,.path,.conclusion] | @tsv')" || block "cannot read CI run $3"
  expected="$3"$'\t'"$1"$'\tmerge_group\t'"$2"$'\t.github/workflows/pr-verification.yml\tsuccess'
  [ "$actual" = "$expected" ] || block "CI run $3 is not the successful same-repository merge-group CI for $2"
}

validate_ci_check() { # validate_ci_check <repo> <sha> <run-id> <name>
  local matches url="https://github.com/$1/actions/runs/$3/"
  matches="$(gh api "repos/$1/commits/$2/check-runs?per_page=100" \
    --jq ".check_runs | map(select(.name == \"$4\" and .head_sha == \"$2\" and .conclusion == \"success\" and (.details_url | startswith(\"$url\")))) | length")"
  [ "$matches" = 1 ] && return 0
  block "$4 is not bound to successful queue run $3 on $2"
}

validate_ci_run() { # validate_ci_run <repo> <sha> <run-id>
  validate_ci_check "$1" "$2" "$3" "PR Verification"
  validate_ci_check "$1" "$2" "$3" "Security"
}

queue_pr_rows() { # queue_pr_rows <repo> <run-id>
  local payload run_id="$2"
  payload="$(gh api "repos/$1/actions/runs/$run_id/pull_requests?per_page=100")" || block "cannot read workflow-run PR associations"
  printf '%s' "$payload" | python3 -c 'import json,re,sys
rows=json.load(sys.stdin); assert isinstance(rows,list) and rows
seen=set()
for row in rows:
 assert isinstance(row,dict); n=row.get("number"); head=row.get("head"); base=row.get("base")
 assert type(n) is int and n>0 and n not in seen
 assert isinstance(head,dict) and re.fullmatch(r"[0-9a-f]{40}",head.get("sha", ""))
 assert isinstance(base,dict) and base.get("ref")=="main"
 sha=head["sha"]; seen.add(n); print(f"{n}\t{sha}\tmain")'
}

validate_queue_row() { # validate_queue_row <pr> <head> <base>
  printf '%s' "$1" | grep -qE '^[0-9]+$' || block "invalid queued PR number"
  valid_sha "$2" || block "invalid queued PR head for #$1"
  [ "$3" = "main" ] || block "queued PR #$1 does not target main"
}

combine_state() { # combine_state <aggregate> <next>
  if [ "$1" = failure ] || [ "$2" = failure ]; then printf failure; return; fi
  if [ "$1" = pending ] || [ "$2" = pending ]; then printf pending; return; fi
  printf success
}

collect_queue() { # collect_queue <repo> <run-id>
  local rows
  rows="$(queue_pr_rows "$1" "$2")" || block "cannot resolve merge-group PRs"
  [ -n "$rows" ] || block "merge group has no associated PR evidence"
  collect_queue_rows "$1" "$rows"
}

collect_queue_rows() { # collect_queue_rows <repo> <rows>
  local aggregate=success pr head base next
  while IFS=$'\t' read -r pr head base; do
    validate_queue_row "$pr" "$head" "$base"
    next="$(run_collect_state "$pr" "$1" "$head")" || next=failure
    aggregate="$(combine_state "$aggregate" "$next")"
  done <<< "$2"
  printf '%s\n' "$aggregate"
}

collect_pr() { # collect_pr <repo> <head> <pr>
  gate_head "$3" "$1" "$2"
  run_collect_state "$3" "$1" "$2"
}

collect_target_state() { # kind repo sha pr ci-run-id
  if [ "$1" = queue ]; then
    validate_workflow_run "$2" "$3" "$5"
    validate_ci_run "$2" "$3" "$5"
    collect_queue "$2" "$5"
  elif [ "$1" = pr ]; then
    collect_pr "$2" "$3" "$4"
  else
    block "unknown target kind: $1"
  fi
}

cmd_collect_target() { # kind repo sha pr ci-run-id
  [ "$#" -eq 5 ] || usage
  local state
  state="$(collect_target_state "$@")"
  set_gate_state "$state"
  [ "$state" != failure ] || return 1
}

usage() {
  printf '%s\n' "usage: pr-review-gate-step.sh <resolve-head|resolve-target|collect-check|collect-target|claim-status|finish-status> ..." >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
sub="$1"
shift || true

case "$sub" in
  resolve-head) cmd_resolve_head "$@" ;;
  resolve-target) cmd_resolve_target "$@" ;;
  collect-check) cmd_collect_check "$@" ;;
  collect-target) cmd_collect_target "$@" ;;
  claim-status) cmd_claim_status "$@" ;;
  finish-status) cmd_finish_status "$@" ;;
  *) usage ;;
esac
