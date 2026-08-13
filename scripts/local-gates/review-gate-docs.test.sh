#!/usr/bin/env bash
# Single-source guidance test (issue #1008 AC3): invariants, review method,
# reviewer permissions/output, workflow order, and ticket-specific scope each
# have exactly one authoritative source — docs/ops/review-gate.md — and no live
# guidance file carries a contradictory copied checklist.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CANON="docs/ops/review-gate.md"
GUIDANCE=(AGENTS.md docs/workflow.md docs/DOCS_POLICY.md .claude/agents/reviewer.md)

fail=0
expect_true() { # expect_true <label> <cmd...>
  local label="$1"
  shift
  if "$@"; then
    printf 'PASS %-52s\n' "$label"
  else
    fail=$((fail + 1))
    printf 'FAIL %-52s\n' "$label"
  fi
}
expect_false() { # expect_false <label> <cmd...>
  local label="$1"
  shift
  if "$@"; then
    fail=$((fail + 1))
    printf 'FAIL %-52s carries a copied checklist\n' "$label"
  else
    printf 'PASS %-52s no copied checklist\n' "$label"
  fi
}

expect_absent() { # expect_absent <label> <cmd...>
  local label="$1"
  shift
  if "$@"; then
    fail=$((fail + 1))
    printf 'FAIL %-52s present but must be absent\n' "$label"
  else
    printf 'PASS %-52s absent as required\n' "$label"
  fi
}

echo "=== canonical doc is the single source ==="
expect_true "canonical doc exists and is non-empty" test -s "$ROOT/$CANON"
for section in "1. Invariants" "2. Review method" "3. Reviewer permissions" "4. Workflow order" "5. Ticket-specific scope"; do
  expect_true "canonical section: $section" grep -qF "$section" "$ROOT/$CANON"
done

echo
echo "=== live guidance files reference the canonical doc ==="
for file in "${GUIDANCE[@]}"; do
  expect_true "$file references $CANON" grep -qF "$CANON" "$ROOT/$file"
done

echo
echo "=== no contradictory copied checklist in guidance ==="
for file in "${GUIDANCE[@]}"; do
  expect_false "$file has no ack-pattern checklist" grep -qE '线程判定|findings triaged|reviewThreads\(isResolved|\| 载体 \| 查法' "$ROOT/$file"
done

echo
echo "=== managed comment-finding formats match the parsers (no codecov) ==="
# Invariant 5 lists exactly the top-level formats the local parser and the
# merge hook inspect — qodo Bugs / Rule violations and SonarCloud Quality Gate.
# Codecov patch coverage is a CI-lane check (pipeline-quality.yml), not a
# comment finding; a future claim that the parser reads codecov fails here.
expect_true "invariant 5 lists exactly the parsed qodo / SonarCloud formats" \
  grep -qF "(qodo Bugs / Rule violations, SonarCloud Quality Gate)" "$ROOT/$CANON"
expect_absent "codecov is not inside the managed-findings parenthetical" \
  grep -qiE 'managed findings \([^)]*codecov' "$ROOT/$CANON"
expect_true "codecov is explicitly not a comment finding" \
  grep -qF "not a comment finding" "$ROOT/$CANON"
expect_true "codecov patch policy is routed to the CI Quality lane" \
  grep -qF "pipeline-quality.yml" "$ROOT/$CANON"

echo
echo "=== workflow-order truth (finding 4): review binds a candidate commit, PR opens after approval ==="
expect_true "a local candidate commit is created (do not push) before the review" \
  grep -qF "local candidate commit" "$ROOT/$CANON"
expect_true "the review reads origin/main...HEAD (the candidate diff)" \
  grep -qF "origin/main...HEAD" "$ROOT/$CANON"
expect_true "the verdict binds to the candidate commit" \
  grep -qF "bind the verdict to that commit" "$ROOT/$CANON"
expect_true "PR opens only after both axes approve" \
  grep -qF "Only after both axes approve" "$ROOT/$CANON"
expect_true "rejection requires a new candidate commit + complete review" \
  grep -qF "repair and create a new candidate commit" "$ROOT/$CANON"
expect_absent "review no longer claims to happen before any commit" \
  grep -qF "This happens before any commit/push" "$ROOT/$CANON"

echo
echo "=== head-bound status is whole-job and cancels PR-bearing events (findings 1-2) ==="
expect_true "final status derives from the whole-job outcome" \
  grep -qF "whole-job outcome" "$ROOT/$CANON"
expect_true "the final status is the last step" \
  grep -qF "posted as the **last step**" "$ROOT/$CANON"
expect_true "concurrency cancels PR-bearing events" \
  grep -qF "in-progress run for every PR-bearing event" "$ROOT/$CANON"

echo
if [ "$fail" -eq 0 ]; then
  echo "All review-gate-docs tests passed."
else
  echo "$fail test(s) failed." >&2
  exit 1
fi
