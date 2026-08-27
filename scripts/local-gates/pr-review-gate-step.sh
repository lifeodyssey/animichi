#!/usr/bin/env bash
# Trusted producer for the classic `Review Gate` commit status.
# The workflow checks out this script only from an immutable default-branch SHA.
# Candidate commits are data: PR heads are inspected by GitHub APIs, never run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/scripts/local-gates/pr-review-check.sh"
TITLE_GATE="$ROOT/scripts/local-gates/commit-message.py"

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

# `check` prints one JSON object, but its fail-closed path prints a plain-text
# reason instead, and the caller merges stderr into the same capture. Reading
# that as JSON raised a traceback, so the step died before recording any state
# and the run published an unexplained red. Fail quietly here; the caller is
# what surfaces the reason.
gate_state() { # gate_state <check-output>
  printf '%s\n' "$1" | python3 -c 'import json, sys
try:
    print(json.loads(sys.stdin.read())["state"])
except (ValueError, KeyError, TypeError):
    raise SystemExit(1)
'
}

check_state_result() { # check_state_result <state> <exit>
  case "$1:$2" in
    success:0 | pending:1) return 0 ;;
    failure:1) return 1 ;;
  esac
  return 2
}

run_collect_state() { # run_collect_state <pr> <repo> <pinned>
  local dir output rc state
  dir="$(mktemp -d)"
  "$GATE" collect "$dir" --pr "$1" --repo "$2" --pinned-head "$3" || { rm -rf "$dir"; return 2; }
  output="$("$GATE" check "$dir" 2>&1)" && rc=0 || rc=$?
  rm -rf "$dir"
  state="$(gate_state "$output")" || { printf '%s\n' "$output" >&2; return 2; }
  check_state_result "$state" "$rc" || return $?
  printf '%s\n' "$state"
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

validate_squash_title() { # validate_squash_title <repo> <pr>
  local title
  title="$(gh api "repos/$1/pulls/$2" --jq .title)" || block "cannot read the squash title for PR #$2"
  python3 "$TITLE_GATE" --subject "$title" || block "invalid squash title for PR #$2"
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
    validate_squash_title "$1" "$pr"
    next="$(run_collect_state "$pr" "$1" "$head")" || next=failure
    aggregate="$(combine_state "$aggregate" "$next")"
  done <<< "$2"
  printf '%s\n' "$aggregate"
}

collect_pr() { # collect_pr <repo> <head> <pr>
  validate_squash_title "$1" "$3"
  gate_head "$3" "$1" "$2"
  # A blocking verdict is an answer, not a failure to answer. The queue path has
  # always read it that way (`|| next=failure` in collect_queue_rows) and either
  # way the verdict reaches the reviewer as the `Review Gate` status; only the
  # single-PR path turned it into a non-zero exit, which is why the workflow ran
  # red on every PR that was merely still waiting. Inability to evaluate (2)
  # still propagates, so the job stays red when the gate breaks.
  local state rc
  state="$(run_collect_state "$3" "$1" "$2")" && rc=0 || rc=$?
  [ "$rc" -ne 2 ] || return 2
  printf '%s\n' "${state:-failure}"
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
  # Record a state even when evaluation itself fails closed. Leaving the output
  # unset let the workflow's `final_state` fall back to failure with nothing to
  # show for it, which is how a readable "no canonical brief-digest record"
  # reached the reviewer as a bare red check.
  local state rc
  state="$(collect_target_state "$@")" && rc=0 || rc=$?
  # Only an inability to evaluate reaches the job's own conclusion. The verdict
  # itself — including `failure` — is published as the required status, so the
  # workflow is green whenever it managed to decide something.
  [ "$rc" -eq 0 ] || { set_gate_state failure; return "$rc"; }
  set_gate_state "$state"
}

usage() {
  printf '%s\n' "usage: pr-review-gate-step.sh <collect-target|finish-status> ..." >&2
  exit 2
}

[ "$#" -ge 1 ] || usage
sub="$1"
shift || true

case "$sub" in
  collect-target) cmd_collect_target "$@" ;;
  finish-status) cmd_finish_status "$@" ;;
  *) usage ;;
esac
