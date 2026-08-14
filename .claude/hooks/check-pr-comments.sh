#!/bin/bash
# PreToolUse guard: block `gh pr merge` while a PR still carries unhandled
# review feedback.
#
# Global guard (applies to every repo). Origin: on 2026-08-03 the agent checked only
# `reviewThreads` (line-level) and merged 24 PRs believing everything was
# handled — qodo's "Code Review by Qodo" summary and SonarCloud's Quality Gate
# are top-level issue comments that produce no thread, so the check reported
# zero every time. Remembering to look at both is exactly the kind of thing
# that fails silently; this makes it fail loudly instead.
#
# One source of gate logic (issue #1008 review finding 6): when the repo carries
# the canonical gate (scripts/local-gates/pr-review-check.sh), the hook delegates
# entirely to it — collect + check, including the review-approval marker, the
# exact findings snapshot, bot rejection, outdated-thread handling, and
# fail-closed behavior. The local head-bound verdict artifact pair is passed
# through --verdict only when supplied explicitly via REVIEW_VERDICT_FILE /
# REVIEW_BRIEF_FILE (never defaulted to the repo root, issue #1008 finding 7).
# For repositories without the canonical gate the hook falls back to the inline
# two-path check (threads + top-level qodo/Sonar findings with an authorized
# human ACK marker) so the global guard keeps protecting every repo. The
# fallback reads comments over GitHub GraphQL and requires the ack author to be
# a real User with an OWNER/MEMBER/COLLABORATOR association — a MEMBER bot can
# never clear its own findings (issue #1008 finding 3 rework).
#
# Fail-closed by design. Every failure mode handled below was a real bypass
# found in review of the first version, and each one made the guard *silently*
# pass: a guard that fails open is worse than no guard, because it manufactures
# confidence that the check ran.

set -uo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 2   # blocks the tool call; stderr goes back to the model
}

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)"

# Only care about merges.
case "$CMD" in
  *"gh pr merge"*) ;;
  *) exit 0 ;;
esac

# Parse the real argv rather than pattern-matching the raw string: `gh pr merge`
# accepts the PR as a number, a URL, or nothing at all (current branch), with
# flags in any position. The first version only matched `gh pr merge <digits>`
# and exited 0 otherwise, so `gh pr merge "$PR_URL"` — the form this repo's own
# automation uses — skipped every check.
TARGET="$(printf '%s' "$CMD" | python3 -c '
import re, shlex, sys

try:
    argv = shlex.split(sys.stdin.read())
except ValueError:
    sys.exit(1)

try:
    i = next(n for n in range(len(argv) - 2)
             if argv[n:n + 3] == ["gh", "pr", "merge"])
except StopIteration:
    # The three words appear in the command text but not as an actual
    # invocation — a commit message or doc edit that quotes them lands here.
    # Distinct exit code so the caller passes instead of blocking.
    sys.exit(3)

TAKES_VALUE = {"-R", "--repo", "-b", "--body", "-t", "--subject",
               "-m", "--match-head-commit", "--author-email"}
pr = repo = ""
rest = argv[i + 3:]
n = 0
while n < len(rest):
    arg = rest[n]
    if arg in TAKES_VALUE:
        if arg in ("-R", "--repo") and n + 1 < len(rest):
            repo = rest[n + 1]
        n += 2
        continue
    if arg.startswith("--repo="):
        repo = arg.split("=", 1)[1]
    elif arg.startswith("-"):
        pass
    elif not pr:
        pr = arg
    n += 1

if pr.isdigit():
    number = pr
else:
    m = re.search(r"/pull/(\d+)", pr)
    number = m.group(1) if m else ""

print(f"{number}\t{repo}")
' 2>/dev/null)"
PARSE_STATUS=$?

# 3 = the words appear but there is no real invocation. Anything else non-zero
# means a merge is being attempted and we could not read it — block those.
[ "$PARSE_STATUS" = "3" ] && exit 0

if [ "$PARSE_STATUS" != "0" ] || [ -z "$TARGET" ]; then
  fail "BLOCKED: could not parse the merge command well enough to check its review feedback.
Re-run with an explicit PR number."
fi

PR="${TARGET%%$'\t'*}"
REPO="${TARGET##*$'\t'}"

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || \
    fail "BLOCKED: cannot determine the repository (\`gh repo view\` failed).
Check GitHub auth and network, or pass -R owner/name."
fi

# No PR on the command line means "merge the current branch's PR" — resolve it
# rather than waving the merge through, which is what the first version did.
if [ -z "$PR" ]; then
  PR="$(gh pr view --json number --jq .number 2>/dev/null)" || PR=""
  [ -z "$PR" ] && fail "BLOCKED: no PR number given and none could be resolved for the current branch.
Pass the PR explicitly, e.g. \`gh pr merge 123\`."
fi

# Canonical gate path: any repo carrying scripts/local-gates/pr-review-check.sh
# delegates to the single source of gate logic (issue #1008 finding 6). Claude
# Code runs hooks with the project root as cwd.
ROOT="$(pwd)"
CANONICAL_GATE="$ROOT/scripts/local-gates/pr-review-check.sh"

# Resolve the explicit REVIEW_VERDICT_FILE / REVIEW_BRIEF_FILE pair into
# CHECK_ARGS. Early-returns when neither is set (marker path); fails closed
# when only one of the pair is set or either file is missing, then builds the
# --verdict/--brief arguments the canonical gate consumes.
resolve_verdict_pair() {
  [ -n "${REVIEW_VERDICT_FILE:-}" ] || [ -n "${REVIEW_BRIEF_FILE:-}" ] || return 0
  [ -n "${REVIEW_VERDICT_FILE:-}" ] && [ -n "${REVIEW_BRIEF_FILE:-}" ] || fail "BLOCKED: REVIEW_VERDICT_FILE and REVIEW_BRIEF_FILE must be provided together. The gate cannot verify the pinned brief digest without the reviewed brief."
  [ -f "$REVIEW_VERDICT_FILE" ] || fail "BLOCKED: verdict artifact not found at $REVIEW_VERDICT_FILE. Provide the reviewed head-bound verdict artifact and its brief via REVIEW_VERDICT_FILE / REVIEW_BRIEF_FILE."
  [ -f "$REVIEW_BRIEF_FILE" ] || fail "BLOCKED: verdict brief not found at $REVIEW_BRIEF_FILE. The gate cannot verify the pinned brief digest without the reviewed brief."
  CHECK_ARGS=(--verdict "$REVIEW_VERDICT_FILE" --brief "$REVIEW_BRIEF_FILE")
}

if [ -f "$CANONICAL_GATE" ]; then
  collect_dir="$(mktemp -d)"
  trap 'rm -rf "$collect_dir"' EXIT
  "$CANONICAL_GATE" collect "$collect_dir" --pr "$PR" --repo "$REPO" || \
    fail "BLOCKED: could not collect the PR review state for PR #$PR (GitHub API call failed).
Check \`gh auth status\` and network. Refusing to merge without having looked."

  # The local head-bound verdict artifact pair is supplied EXPLICITLY via
  # REVIEW_VERDICT_FILE / REVIEW_BRIEF_FILE only — never defaulted to the repo
  # root (root-artifact prohibition, issue #1008 finding 7). The pair must
  # come together: a verdict artifact without its brief cannot verify the
  # pinned brief digest, so that is a block, not a silent marker-path fallback.
  CHECK_ARGS=()
  resolve_verdict_pair

  OUT="$("$CANONICAL_GATE" check "$collect_dir" ${CHECK_ARGS[@]+"${CHECK_ARGS[@]}"} 2>&1)" && rc=0 || rc=$?
  if [ "$rc" = "0" ]; then
    exit 0
  fi
  REASON="$(printf '%s' "$OUT" | python3 -c 'import json,sys;
try: print(json.load(sys.stdin).get("reason",""))
except Exception: print("")' 2>/dev/null)"
  fail "BLOCKED: PR #$PR does not pass the local review gate (docs/ops/review-gate.md).
${REASON}
Resolve the unresolved threads, acknowledge the managed findings with an authorized
human comment bound to the exact findings snapshot, and record the review-approval
marker (or supply the local verdict artifact + brief explicitly via
REVIEW_VERDICT_FILE / REVIEW_BRIEF_FILE)."
fi

# 1. Line-level review threads (fallback for repositories without the canonical
# gate). --paginate walks past the first page: a large PR can carry more than
# 100 threads, and the ones beyond page 1 were invisible.
THREAD_QUERY="$(cat <<'GRAPHQL'
query($owner:String!,$name:String!,$pr:Int!,$endCursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$pr){
      reviewThreads(first:100,after:$endCursor){
        nodes{isResolved}
        pageInfo{hasNextPage endCursor}
      }
    }
  }
}
GRAPHQL
)"

THREADS="$(gh api graphql --paginate \
  -f query="$THREAD_QUERY" -F owner="${REPO%%/*}" -F name="${REPO##*/}" -F pr="$PR" \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length')" || \
  fail "BLOCKED: cannot query review threads for PR #$PR (GitHub API call failed).
Check \`gh auth status\` and network. Refusing to merge without having looked."

# --paginate concatenates one count per page; sum them, and refuse anything
# non-numeric rather than treating a garbled response as "nothing to see".
THREADS="$(printf '%s' "$THREADS" | python3 -c '
import sys
parts = sys.stdin.read().split()
if not parts or not all(p.isdigit() for p in parts):
    sys.exit(1)
print(sum(int(p) for p in parts))
' 2>/dev/null)" || \
  fail "BLOCKED: unreadable review-thread count for PR #$PR. Refusing to merge without having looked."

if [ "$THREADS" != "0" ]; then
  fail "BLOCKED: PR #$PR has $THREADS unresolved review thread(s).
Read each one, fix it or record why not, then resolve it. Do not batch-resolve unread."
fi

# 2. Top-level bot findings — the half that has no thread to resolve. The
# fallback reads comments over GitHub GraphQL requesting `author { __typename
# login }`: the legacy `--json comments` shape omits the author type, so an
# association-only ACK would let a MEMBER bot clear its own findings. An ACK
# counts only when the author is a real GitHub User (author type `User`) with
# an authorized association; an unreadable author type never authorizes (fail
# closed, issue #1008 finding 3 rework).
FALLBACK_COMMENTS_QUERY="$(cat <<'GRAPHQL'
query($owner:String!,$name:String!,$pr:Int!,$endCursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$pr){
      comments(first:100,after:$endCursor){
        nodes{ id url body authorAssociation author{ __typename login } }
        pageInfo{ hasNextPage endCursor }
      }
    }
  }
}
GRAPHQL
)"

ALL_COMMENTS="$(gh api graphql --paginate \
  -f query="$FALLBACK_COMMENTS_QUERY" -F owner="${REPO%%/*}" -F name="${REPO##*/}" -F pr="$PR" \
  --jq '[.data.repository.pullRequest.comments.nodes[] | {author_association: (.authorAssociation // ""), login: (.author.login // ""), author_type: (.author.__typename // ""), body: (.body // "")}]' \
  | jq -s 'add')" || \
  fail "BLOCKED: cannot read top-level comments on PR #$PR (GitHub API call failed).
Check \`gh auth status\` and network. Refusing to merge without having looked."

# A maintainer comment containing this marker records that the findings were
# judged. The author-type check matters: without it anyone who can comment —
# including the bots being triaged — could clear their own findings.
ACK_PATTERN='线程判定|findings triaged|评论判定|toplevel triaged'
if printf '%s' "$ALL_COMMENTS" | jq -r \
  '.[] | select(.author_type == "User" and (.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR")) | .body' \
  | grep -qE "$ACK_PATTERN"; then
  exit 0
fi

FINDING_BODIES="$(printf '%s' "$ALL_COMMENTS" | jq -r '.[] | .body')"
PENDING=""
# qodo prints counts like: <code>🐞 Bugs (1)</code> / Rule violations (2)
if printf '%s' "$FINDING_BODIES" | grep -qE 'Bugs \([1-9]|Rule violations \([1-9]'; then
  PENDING="$PENDING
  - qodo reports non-zero Bugs / Rule violations in its Code Review summary"
fi
if printf '%s' "$FINDING_BODIES" | grep -q 'Quality Gate Failed'; then
  PENDING="$PENDING
  - SonarCloud Quality Gate failed"
fi

if [ -n "$PENDING" ]; then
  fail "BLOCKED: PR #$PR has top-level bot findings that were never addressed:$PENDING

These live in issue comments, not review threads — a clean reviewThreads count
says nothing about them. Read the full comment bodies:
  gh pr view $PR -R $REPO --json comments --jq '.comments[].body'

Then either fix them, or post a comment recording the verdict for each
(include the phrase 线程判定 / findings triaged so this check can see it):
  gh issue comment $PR -R $REPO --body '线程判定: ...'"
fi

exit 0
