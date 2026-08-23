#!/usr/bin/env bash
# The required PR check for the local review gate (issue #1008; contract:
# docs/ops/review-gate.md). Reads unresolved review threads, top-level managed
# findings, the current head SHA, and an authorized acknowledgement bound to the
# findings snapshot, then emits a single typed gate verdict (AC4/AC5).
#
#   pr-review-check.sh collect <outdir> [--pr N] [--repo OWNER/NAME] [--pinned-head SHA]
#   pr-review-check.sh check <dir> [--verdict FILE] [--brief FILE] [--base SHA]
#   pr-review-check.sh status <repo> <head-sha> <state>
#
# `collect` is the only network-facing step: it snapshots the GitHub state into
# <dir>/{head_sha.json,base_sha.json,brief_digest.json,threads.json,comments.json}.
# The recorded base is the *real merge-base* of the PR head and base branch from
# the GitHub compare API — never the base branch tip (issue #1008 finding 3) —
# and the recorded head is the pinned head when `--pinned-head` is given: the
# workflow resolves the PR head once and passes it through every step, and
# collection fails closed if the live PR head advanced past that pin (issue
# #1008 finding 2). `check` is pure: it judges that snapshot (optionally with
# the local head-bound review verdict artifact) and prints one JSON object,
# exiting 0 on approve, 1 on reject, 2 on failure to even read the inputs
# (fail-closed). `status` posts the `Review Gate` commit status on the exact PR
# head SHA, binding
# comment-triggered re-evaluations to the head the ruleset consumes (not the
# default-branch SHA an issue_comment run is associated with). The CLI merge
# hook consults the gate verdict; the required `Review Gate` workflow
# context runs the same collect + check on the current PR and blocks UI /
# auto-merge / API merges when its own check fails (docs/ops/review-gate.md §7).
#
# Thread counting counts only *active* unresolved threads: a thread with
# isOutdated=true was left behind by a newer revision and must not block the
# current head (#1019 regression). Malformed thread data — a missing or
# non-boolean isResolved/isOutdated or an absent thread structure — fails
# closed, never a quiet `{"unresolved": 0}` (no fake green).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODULE="$ROOT/scripts/local-gates/pr_review_check.py"
BRIEF_RECORD="$ROOT/scripts/local-gates/brief_record.py"

# The pipeline-quality job emits `Review Gate` as its check-run and this
# head-bound status uses the same post-cutover context. The compatibility job
# owns the legacy `Quality / invariants` check until the guarded PUT.
STATUS_CONTEXT='Review Gate'

THREADS_QUERY='query($owner:String!,$name:String!,$pr:Int!,$endCursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$pr){
      reviewThreads(first:100,after:$endCursor){
        nodes{isResolved isOutdated}
        pageInfo{hasNextPage endCursor}
      }
    }
  }
}'

# Top-level PR comments over GitHub GraphQL: the `author { __typename login }`
# selection is load-bearing — `gh pr view --json comments` omits the author
# type (real CLI output carries only `author.login`), so the collector must
# request it explicitly or author_type normalizes to "" and every finding /
# approval fails closed.
COMMENTS_QUERY='query($owner:String!,$name:String!,$pr:Int!,$endCursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$pr){
      comments(first:100,after:$endCursor){
        nodes{ id url body authorAssociation author{ __typename login } }
        pageInfo{ hasNextPage endCursor }
      }
    }
  }
}'

usage() {
  printf '%s\n' "usage: pr-review-check.sh <collect|check|status> ..." >&2
  exit 2
}

# Parse collect flags; sets OUT, PR, REPO, PINNED. `usage` on unknown flags.
collect_opts() {
  OUT="$1"; shift || true; PR=""; REPO=""; PINNED=""
  while [ "$#" -gt 0 ]; do case "$1" in
    --pr) PR="${2:?--pr needs a number}"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --pinned-head) PINNED="${2:?--pinned-head needs a SHA}"; shift 2 ;;
    *) usage ;;
  esac; done
}

# Parse check flags; sets VERDICT_ARG, BRIEF_ARG, BASE_ARG.
check_opts() {
  while [ "$#" -gt 0 ]; do case "$1" in
    --verdict) VERDICT_ARG="${2:?--verdict needs a file}"; shift 2 ;;
    --brief) BRIEF_ARG="${2:?--brief needs a file}"; shift 2 ;;
    --base) BASE_ARG="$2"; shift 2 ;;
    *) usage ;;
  esac; done
}

# Resolve the PR number and repo from explicit flags or the ambient gh context.
resolve_target() {
  local pr="$1" repo="$2"
  if [ -z "$repo" ]; then repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"; fi
  if [ -z "$pr" ]; then pr="$(gh pr view --json number --jq .number 2>/dev/null || true)"; fi
  printf '%s\t%s' "$pr" "$repo"
}

# Resolve the collect target or exit 2; sets TARGET_PR, TARGET_REPO.
resolve_collect_target() {
  local target
  target="$(resolve_target "$PR" "$REPO")"
  TARGET_PR="${target%%$'\t'*}"
  TARGET_REPO="${target##*$'\t'}"
  [ -n "$TARGET_PR" ] && [ -n "$TARGET_REPO" ] || {
    printf '%s\n' "BLOCKED: cannot resolve PR or repository for pr-review-check collect." >&2
    exit 2
  }
}

head_ref() { # head_ref <pr> <repo>
  gh pr view "$1" -R "$2" --json headRefOid,baseRefOid --jq .headRefOid
}

base_ref() { # base_ref <pr> <repo>
  gh pr view "$1" -R "$2" --json headRefOid,baseRefOid --jq .baseRefOid
}

# The real merge-base of the PR head and base branch (issue #1008 finding 3):
# the GitHub compare API returns the common ancestor, never the base tip.
merge_base() { # merge_base <repo> <head-sha> <base-tip>
  local mb
  mb="$(gh api "repos/${1}/compare/${3}...${2}" --jq .merge_base_commit.sha)" || return 1
  printf '%s' "$mb" | grep -qE '^[0-9a-f]{40}$' || return 1
  printf '%s' "$mb"
}

# Collect the pinned PR head and the merge-base; a live head that no longer
# equals the pinned SHA fails closed (issue #1008 finding 2).
collect_head() { # collect_head <pr> <repo> <outdir> <pinned>
  local head_tip base_tip
  head_tip="$(head_ref "$1" "$2")" || return 1
  base_tip="$(base_ref "$1" "$2")" || return 1
  [ -z "$4" ] || [ "$head_tip" = "$4" ] || return 1
  printf '{"head_sha": "%s"}\n' "${4:-$head_tip}" > "$3/head_sha.json"
  printf '{"base_sha": "%s"}\n' "$(merge_base "$2" "${4:-$head_tip}" "$base_tip")" > "$3/base_sha.json"
}

# Collect the canonical brief-digest record from the PR body. The review
# handoff records ``review-gate brief: <64hex>`` in the PR body; check binds
# the approval marker's brief to this exact digest, so a wrong-but-well-formed
# marker digest fails (issue #1008 finding 7 rework). An absent record yields
# an empty digest and check fails closed on the GitHub path; a body with
# duplicate records fails closed here (finding 6).
collect_brief() { # collect_brief <pr> <repo> <outdir>
  gh pr view "$1" -R "$2" --json body --jq .body \
    | python3 "$BRIEF_RECORD" > "$3/brief_digest.json"
}

# Normalize each GraphQL comment page into the internal snake_case shape
# consumed by pr_review_check.py, then merge the pages deterministically via
# comment_combine.py (which fails closed on a malformed page, a non-string
# field type, or a finding-shaped comment with no readable author type or
# identity). The canonical path never falls back to `gh pr view --json comments`.
collect_comments() { # collect_comments <pr> <repo> <outdir>
  gh api graphql --paginate -f query="$COMMENTS_QUERY" \
    -F owner="${2%%/*}" -F name="${2##*/}" -F pr="$1" \
    --jq '[.data.repository.pullRequest.comments.nodes[] | {author_association: (.authorAssociation // ""), login: (.author.login // ""), author_type: (.author.__typename // ""), id: (.id // ""), url: (.url // ""), body: (.body // "")}]' \
    | python3 "$ROOT/scripts/local-gates/comment_combine.py" > "$3/comments.json" \
    || block_comments_unreadable
}

# Count active unresolved threads across all pages (isOutdated threads ignored).
count_threads() { # count_threads <pr> <repo>
  gh api graphql --paginate -f query="$THREADS_QUERY" \
    -F owner="${2%%/*}" -F name="${2##*/}" -F pr="$1" \
    --jq '.data.repository.pullRequest.reviewThreads as $t
      | if ($t|type) != "object" or (($t.nodes)|type) != "array" then
        {"count": 0, "malformed": 1}
        else {"count": ([$t.nodes[] | select(.isResolved == false and .isOutdated == false)] | length),
          "malformed": ([$t.nodes[] | select(((.isResolved|type) != "boolean") or ((.isOutdated|type) != "boolean"))] | length)}
        end'
}

sum_counts() { # sum_counts <per-page JSON tallies>
  [ -n "$1" ] || return 2
  printf '%s' "$1" | python3 "$ROOT/scripts/local-gates/thread_tally.py"
}

block() { # block <message>
  printf '%s\n' "BLOCKED: $1" >&2
  exit 2
}

block_threads_unreadable() {
  printf '%s\n' "BLOCKED: GraphQL thread response is unreadable." >&2
  exit 2
}

block_comments_unreadable() {
  printf '%s\n' "BLOCKED: GraphQL comments response is unreadable." >&2
  exit 2
}

collect_threads() { # collect_threads <pr> <repo> <outdir>
  local counts total
  counts="$(count_threads "$1" "$2")" || block_threads_unreadable
  [ -n "$counts" ] || block_threads_unreadable
  total="$(sum_counts "$counts")"
  printf '{"unresolved": %s}\n' "$total" > "$3/threads.json"
}

cmd_collect() {
  collect_opts "$@"
  [ -n "$OUT" ] || usage
  resolve_collect_target
  mkdir -p "$OUT"
  collect_head "$TARGET_PR" "$TARGET_REPO" "$OUT" "$PINNED"
  collect_brief "$TARGET_PR" "$TARGET_REPO" "$OUT"
  collect_comments "$TARGET_PR" "$TARGET_REPO" "$OUT"
  collect_threads "$TARGET_PR" "$TARGET_REPO" "$OUT"
}

valid_sha() { # valid_sha <sha>
  printf '%s' "$1" | grep -qE '^[0-9a-f]{40}$'
}

valid_state() { # valid_state <state>
  case "$1" in pending | success | failure) return 0 ;; esac
  return 1
}

api_status() { # api_status <repo> <head-sha> <state>
  gh api "repos/${1%%/*}/${1##*/}/statuses/$2" \
    -f state="$3" -f context="$STATUS_CONTEXT" --jq .state >/dev/null
}

# Post a commit status on the exact PR head SHA with the required ruleset
# context. A failed post exits 2 (fail closed) so the required job fails
# instead of leaving a stale green.
post_status() { # post_status <repo> <head-sha> <state>
  valid_sha "$2" || block "invalid head SHA for status post: $2"
  valid_state "$3" || block "invalid status state: $3"
  api_status "$1" "$2" "$3" || block "cannot post $3 status on $2"
}

cmd_status() { # cmd_status <repo> <head-sha> <state>
  [ "$#" -eq 3 ] || usage
  post_status "$1" "$2" "$3"
}

add_arg() { # add_arg <flag> <value>; appends to args when value is non-empty
  [ -n "$2" ] || return 0
  args+=( "$1" "$2" )
}

# bash 3.2 (macOS default) aborts on a bare `"${args[@]}"` with an empty array
# under `set -u`; the `+` guard keeps the no-flag path safe.
cmd_check() {
  DIR="${1:-}"; shift || true; VERDICT_ARG=""; BRIEF_ARG=""; BASE_ARG=""
  check_opts "$@"
  [ -n "$DIR" ] || usage
  local args=()
  add_arg --verdict "$VERDICT_ARG"
  add_arg --brief "$BRIEF_ARG"
  add_arg --base "$BASE_ARG"
  python3 "$MODULE" pr-check "$DIR" ${args[@]+"${args[@]}"}
}

[ "$#" -ge 1 ] || usage
sub="$1"
shift || true

case "$sub" in
  collect)
    cmd_collect "$@"
    ;;
  check)
    cmd_check "$@"
    ;;
  status)
    cmd_status "$@"
    ;;
  *)
    usage
    ;;
esac
