#!/usr/bin/env bash
# SUT: scripts/local-gates/pre-push-affected.sh — the toolchain program that runs these
# rules, in the root commitlint.config.js this file drives through the workspace's own CLI
# Behavioral tests for the issue-reference rule's single exemption (#1804): GitHub's
# squash merge appends ` (#N)` to the pull request title it uses as the subject, so
# every commit the merge button lands on `main` carries that suffix and no author can
# remove it — a rule that refuses it refuses the repository's own history. The exemption
# is exactly that suffix, and nothing else: a subject reference anywhere but there is
# still rejected, and so is every other rule's verdict on such a subject. The rules
# themselves are the root config CI's `commits` job reads too; the gate is the committed
# program under the toolchain roots they reach this suite through, which is the name the
# filename has to carry (#1776).
set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
COMMITLINT="$REPO_ROOT/node_modules/.bin/commitlint"
[ -x "$COMMITLINT" ] ||
  { printf 'FAIL: %s is not installed — run pnpm install first\n' "$COMMITLINT" >&2; exit 1; }

failures=0

expect_lint() { # <expected exit> <case> <message> — the message reads last in a report
  local expected="$1" case_name="$2" message="$3" status=0
  printf '%s\n' "$message" | "$COMMITLINT" >/dev/null 2>&1 || status=$?
  [ "$status" = "$expected" ] || {
    printf 'FAIL %s: expected exit %s, got %s for: %s\n' "$case_name" "$expected" "$status" "$message" >&2
    failures=$((failures + 1))
  }
}

# 1. The merge button's suffix, on subjects `main` actually carries — the form
#    that made every squash commit a rejection, not a hypothetical one.
expect_lint 0 "merge-button suffix" 'fix(catalog): enforce the egress ceiling across restarts (#1822)'
expect_lint 0 "merge-button suffix, docs scope" 'docs(repo): repair stale AGENTS.md claims (#1803)'
expect_lint 0 "no suffix at all" 'fix(catalog): enforce the egress ceiling across restarts'
# 2. Exactly that suffix: an issue reference anywhere else in the subject is
#    still rejected, and so is a second one.
expect_lint 1 "two suffixes" 'fix(catalog): name refusals and alarm (#1790) (#1791)'
expect_lint 1 "reference inside the subject" 'fix(catalog): repair #1790 and name refusals'
expect_lint 1 "suffix mid-subject" 'fix(catalog): name refusals (#1790) and alarm'
expect_lint 1 "reference with no parentheses" 'fix(catalog): name refusals #1790'
# 3. The body is where a reference belongs, and where the rule never looked.
expect_lint 0 "reference in the body" 'fix(catalog): name refusals and alarm

Refs: #1804'

[ "$failures" = 0 ] || { printf '%s case(s) failed\n' "$failures" >&2; exit 1; }
printf '%s: all green\n' "$(basename "$0")"
