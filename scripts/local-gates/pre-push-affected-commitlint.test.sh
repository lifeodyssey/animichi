#!/usr/bin/env bash
# SUT: scripts/local-gates/pre-push-affected.sh — the commit messages a push carries
# Behavioral tests for the pre-push gate's commit-message check (#1467): the
# commits a push adds go through the repository's own commitlint before any
# package gate, and each rejected message is named. The fixture this file shares
# with pre-push-affected.test.sh is pre-push-fixture.sh; unlike the selection
# cases these drive the real commitlint, so they need an installed workspace.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pre-push-fixture.sh"

[ -x "$REAL_COMMITLINT" ] ||
  { printf 'FAIL: %s is not installed — run pnpm install first\n' "$REAL_COMMITLINT" >&2; exit 1; }

# 1. A first push has no remote sha to narrow against — it arrives as zero — so
#    the merge base with origin/main is the range: every commit the new branch
#    adds is linted, and a branch of valid messages is green.
new_repo
commit_change feature docs/a.md
main_sha="$(cd "$REPO" && git rev-parse main)"
commit_message 'fix(catalog): probe the first push' workers/catalog/src/x.ts
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $ZERO"
expect_status "first push" 0 "$STATUS"
expect "first push" "pnpm exec commitlint --from $main_sha --to HEAD" "$RECORDED"
expect "first push" "packages: catalog" "$OUT"
ok "a new branch's first push lints from the merge base with origin/main and passes"

# 2. The range is the commits this push adds, not the branch's history: with the
#    remote's sha as the tighter base, a rejected message in an already-pushed
#    commit must not fail a push that adds only a valid one.
new_repo
git -C "$REPO" checkout -q -B feature main
commit_message 'fix: wip' workers/catalog/src/x.ts
pushed="$(cd "$REPO" && git rev-parse HEAD)"
commit_message 'fix(catalog): probe the pushed range' workers/catalog/src/y.ts
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $pushed"
expect_status "pushed range" 0 "$STATUS"
expect "pushed range" "pnpm exec commitlint --from $pushed --to HEAD" "$RECORDED"
refute "pushed range" "pre-push: commitlint rejected" "$OUT"
ok "a rejected message the remote already has is neither linted nor attributed"

# 3. A message the repository's own commitlint rejects stops the push before a
#     suite starts and names the commit carrying it — on a first push too.
new_repo
git -C "$REPO" checkout -q -B feature main
commit_message 'fix: wip' workers/catalog/src/x.ts
rejected="$(cd "$REPO" && git rev-parse --short HEAD)"
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $ZERO"
expect_status "rejected message" 1 "$STATUS"
expect "rejected message" "is a generic outcome" "$OUT"
expect "rejected message" "pre-push: commitlint rejected $rejected fix: wip" "$OUT"
refute "rejected message" "--filter" "$RECORDED"
ok "a rejected message fails the push, names the commit and runs no suite"

# 4. commitlint's history mode names no sha, so a rejected range is replayed one
#     commit at a time: every rejected commit is named, and the valid commits
#     around them are not.
new_repo
git -C "$REPO" checkout -q -B feature main
commit_message 'fix: wip' workers/catalog/src/a.ts
first="$(cd "$REPO" && git rev-parse --short HEAD)"
commit_message 'fix(catalog): probe the range' workers/catalog/src/b.ts
valid="$(cd "$REPO" && git rev-parse --short HEAD)"
commit_message 'fix: update files' workers/catalog/src/c.ts
second="$(cd "$REPO" && git rev-parse --short HEAD)"
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $ZERO"
expect_status "two rejected messages" 1 "$STATUS"
expect "two rejected messages" "pre-push: commitlint rejected $first fix: wip" "$OUT"
expect "two rejected messages" "pre-push: commitlint rejected $second fix: update files" "$OUT"
refute "two rejected messages" "pre-push: commitlint rejected $valid" "$OUT"
refute "two rejected messages" "--filter" "$RECORDED"
ok "each rejected commit in the range is named, and the valid one between them is not"

# 5. An empty range is a commitlint usage error (exit 9), not a pass: the
#     re-push of a branch whose tip the remote already has skips the check.
new_repo
commit_change feature workers/catalog/src/x.ts
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $head_sha"
expect_status "already pushed" 0 "$STATUS"
refute "already pushed" "exec commitlint" "$RECORDED"
ok "an empty range skips the message check instead of failing the push"

# 6. A commitlint that cannot run at all fails the push closed with its own
#     error: the check never reads as green by absence, and nothing is blamed
#     for a message nobody read.
new_repo
commit_change feature workers/catalog/src/x.ts
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
gate_env GATE_PROBE=1 "REAL_COMMITLINT=$BIN/commitlint-not-installed"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $ZERO"
expect_status "missing commitlint" 1 "$STATUS"
expect "missing commitlint" "commitlint-not-installed" "$OUT"
refute "missing commitlint" "pre-push: commitlint rejected" "$OUT"
refute "missing commitlint" "--filter" "$RECORDED"
gate_env GATE_PROBE=1
ok "a commitlint that cannot run fails the push closed and attributes nothing"

finish
