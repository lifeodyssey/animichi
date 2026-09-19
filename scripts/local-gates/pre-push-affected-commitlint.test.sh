#!/usr/bin/env bash
# SUT: scripts/local-gates/pre-push-affected.sh — the commit messages a push carries
# Behavioral tests for the pre-push gate's commit-message check (#1467, #1804): the
# commits a push adds — and only those — go through the repository's own commitlint
# before any package gate, and each rejected message is named. The fixture this file
# shares with pre-push-affected.test.sh is pre-push-fixture.sh; unlike the selection
# cases these drive the real commitlint, so they need an installed workspace.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pre-push-fixture.sh"

[ -x "$REAL_COMMITLINT" ] ||
  { printf 'FAIL: %s is not installed — run pnpm install first\n' "$REAL_COMMITLINT" >&2; exit 1; }

# 1. A first push has no remote sha to narrow against — it arrives as zero, and a
#    zero sha is no object to exclude — so the merge base with origin/main is the
#    floor: every commit the new branch adds is read, and a branch of valid
#    messages is green.
new_repo
commit_change feature docs/a.md
first="$(cd "$REPO" && git rev-parse HEAD)"
commit_message 'fix(catalog): probe the first push' workers/catalog/src/x.ts
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $ZERO"
expect_status "first push" 0 "$STATUS"
expect "first push" "pnpm exec commitlint --to $first^!" "$RECORDED"
expect "first push" "pnpm exec commitlint --to $head_sha^!" "$RECORDED"
expect "first push" "packages: catalog" "$OUT"
ok "a new branch's first push reads every commit it adds, from the merge base with origin/main"

# 2. The set is the commits this push adds, not the branch's history: with the
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
expect "pushed range" "pnpm exec commitlint --to $head_sha^!" "$RECORDED"
refute "pushed range" "--to $pushed" "$RECORDED"
refute "pushed range" "pre-push: commitlint rejected" "$OUT"
ok "a rejected message the remote already has is neither read nor attributed"

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

# 4. commitlint's history mode names no sha, so every commit is read on its own:
#     every rejected commit is named, and the valid commits around them are not.
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
ok "each rejected commit is named, and the valid one between them is not"

# 5. An empty set is skipped rather than failed: the re-push of a branch whose tip
#     the remote already has asks commitlint for nothing at all.
new_repo
commit_change feature workers/catalog/src/x.ts
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $head_sha"
expect_status "already pushed" 0 "$STATUS"
refute "already pushed" "exec commitlint" "$RECORDED"
ok "nothing left to read skips the message check instead of failing the push"

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

# 7. A branch that merged main reaches main's own commits through the narrowed
#     range — and the merge button wrote those, not this branch, which is what
#     turned every squash subject on `main` into a rejection (#1804). The walk
#     excludes origin/main, so the push is green and main's commit is never read,
#     whatever its message would have earned it: the one below keeps a reference
#     inside its subject, which the repository's rules reject on their own terms,
#     so no part of #1804's fix can hide the mutant. Mutation: keep the remote sha
#     as the only exclusion and this turns red naming a commit the branch did not
#     write.
new_repo
commit_change feature workers/catalog/src/x.ts
pushed="$(cd "$REPO" && git rev-parse HEAD)"
git -C "$REPO" checkout -q main
commit_message 'fix(catalog): keep the #1650 allowlist reachable (#1815)' workers/catalog/src/merged.ts
merged="$(cd "$REPO" && git rev-parse --short HEAD)"
git -C "$REPO" update-ref refs/remotes/origin/main main
git -C "$REPO" checkout -q feature
git -C "$REPO" merge -q --no-ff main -m "Merge branch 'main' into feature"
commit_message 'fix(catalog): probe the merge' workers/catalog/src/y.ts
own="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $own refs/heads/feature $pushed"
expect_status "merged-in main" 0 "$STATUS"
expect "merged-in main" "pnpm exec commitlint --to $own^!" "$RECORDED"
refute "merged-in main" "$merged" "$RECORDED"
refute "merged-in main" "pre-push: commitlint rejected" "$OUT"
ok "a branch that merged main is judged on its own commits, never main's"

# 8. The narrowing must not become a skip: with main merged in, a rejected
#     message of the branch's own still stops the push — and main's merged commit,
#     clean here so that only a skip can hide it, is still not the one blamed.
#     Mutation: widen the exclusion into reading nothing and this turns red, the
#     push passing with a message the repository rejects.
new_repo
commit_change feature workers/catalog/src/x.ts
pushed="$(cd "$REPO" && git rev-parse HEAD)"
git -C "$REPO" checkout -q main
commit_message 'fix(catalog): enforce the egress ceiling across restarts (#1822)' workers/catalog/src/merged.ts
merged="$(cd "$REPO" && git rev-parse --short HEAD)"
git -C "$REPO" update-ref refs/remotes/origin/main main
git -C "$REPO" checkout -q feature
git -C "$REPO" merge -q --no-ff main -m "Merge branch 'main' into feature"
commit_message 'fix: wip' workers/catalog/src/y.ts
own="$(cd "$REPO" && git rev-parse --short HEAD)"
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/feature $head_sha refs/heads/feature $pushed"
expect_status "own rejected message" 1 "$STATUS"
expect "own rejected message" "pre-push: commitlint rejected $own fix: wip" "$OUT"
refute "own rejected message" "$merged" "$OUT"
refute "own rejected message" "egress ceiling" "$OUT"
refute "own rejected message" "--filter" "$RECORDED"
ok "a branch's own rejected message still stops the push, and main's merged commit is not blamed"

finish
