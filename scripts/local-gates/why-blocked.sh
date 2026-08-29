#!/usr/bin/env bash
# Explain the GitHub evidence currently preventing a pull request from merging.
# Exit 0 when the inspected evidence is clear, 1 when it identifies blockers,
# and 2 when GitHub or the snapshot is unreadable (fail closed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PARSER="$ROOT/scripts/local-gates/why_blocked.py"
THREAD_TALLY="$ROOT/scripts/local-gates/thread_tally.py"
THREADS_QUERY="query(\$owner:String!,\$name:String!,\$pr:Int!,\$endCursor:String){
  repository(owner:\$owner,name:\$name){pullRequest(number:\$pr){
    reviewThreads(first:100,after:\$endCursor){nodes{isResolved isOutdated}
      pageInfo{hasNextPage endCursor}}}}}"
STATUS_QUERY="query(\$owner:String!,\$name:String!,\$sha:GitObjectID!,\$pr:Int!){
  repository(owner:\$owner,name:\$name){object(oid:\$sha){... on Commit{status{contexts{
    id context state updatedAt isRequired(pullRequestNumber:\$pr)}}}}}}"

usage() {
  printf '%s\n' 'usage: why-blocked.sh <pr>' >&2
  exit 2
}

block() {
  printf 'BLOCKED: %s\n' "$1" >&2
  exit 2
}

resolve_repo() {
  gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null \
    || block 'cannot resolve the GitHub repository'
}

collect_pr() {
  gh pr view "$PR" -R "$REPO" \
    --json number,baseRefName,baseRefOid,headRefOid,mergeStateStatus \
    > "$OUT/pr.json" || block "cannot read PR $PR"
}

read_target() {
  local target
  target="$(python3 "$PARSER" target "$OUT/pr.json")" \
    || block 'pull-request identity is unreadable'
  IFS=$'\t' read -r BASE_REF BASE_SHA HEAD_SHA <<< "$target"
}

collect_rules() {
  gh api "repos/$REPO/rules/branches/$BASE_REF" > "$OUT/rules.json" \
    || block 'cannot read effective branch rules'
}

collect_checks() {
  gh api "repos/$REPO/commits/$HEAD_SHA/check-runs" --paginate \
    --jq .check_runs > "$OUT/checks.jsonl" \
    || block 'cannot read raw check-run conclusions'
}

collect_statuses() {
  gh api graphql -f query="$STATUS_QUERY" -F owner="${REPO%%/*}" \
    -F name="${REPO##*/}" -F sha="$HEAD_SHA" -F pr="$PR" \
    --jq '.data.repository.object.status.contexts // []' > "$OUT/statuses.json" \
    || block 'cannot read source-aware classic commit statuses'
}

collect_compare() {
  gh api "repos/$REPO/compare/$BASE_SHA...$HEAD_SHA" > "$OUT/compare.json" \
    || block 'cannot read branch staleness'
}

thread_counts() {
  gh api graphql --paginate -f query="$THREADS_QUERY" \
    -F owner="${REPO%%/*}" -F name="${REPO##*/}" -F pr="$PR" \
    --jq ".data.repository.pullRequest.reviewThreads as \$t
      | if (\$t|type) != \"object\" or ((\$t.nodes)|type) != \"array\" then
        {\"count\":0,\"malformed\":1}
        else {\"count\":([\$t.nodes[]|select(.isResolved==false and .isOutdated==false)]|length),
          \"malformed\":([\$t.nodes[]|select(((.isResolved|type)!=\"boolean\") or ((.isOutdated|type)!=\"boolean\"))]|length)} end"
}

collect_threads() {
  local counts
  counts="$(thread_counts)" || block 'GraphQL thread response is unreadable'
  [ -n "$counts" ] || block 'GraphQL thread response is empty'
  printf '%s\n' "$counts" | python3 "$THREAD_TALLY" > "$OUT/threads.txt" \
    || block 'review thread tally is unreadable'
}

main() {
  [ "$#" -eq 1 ] || usage
  PR="$1"; REPO="$(resolve_repo)"; OUT="$(mktemp -d)"
  trap 'rm -rf "$OUT"' EXIT
  collect_pr; read_target; collect_rules; collect_checks
  collect_statuses; collect_compare; collect_threads
  python3 "$PARSER" report "$OUT"
}

main "$@"
