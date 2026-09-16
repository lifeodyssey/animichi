#!/usr/bin/env bash
# Behavioral tests for pre-push-affected.sh's selection (#1371, #1687): which
# packages a diff selects, which buckets fire, and which paths fail closed. The
# fixture this file shares with pre-push-commitlint.test.sh — one throwaway
# repository per case, a fake pnpm / make / atlas and the assertion helpers — is
# pre-push-fixture.sh.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pre-push-fixture.sh"

# 1. A selected package must not carry an unowned path through with it.
new_repo
commit_change feature workers/catalog/src/x.ts .gitignore-extra
run_gate < /dev/null
expect_status "mixed diff" 1 "$STATUS"
expect "mixed diff" "no gate covers" "$OUT"
expect "mixed diff" ".gitignore-extra" "$OUT"
refute "mixed diff" "workers/catalog/src/x.ts" "$OUT"
ok "a package change does not carry an unowned root file through"

# 2. Same for a bucket, which must also not have run.
new_repo
commit_change feature apps/agent/x.py test/repo-config-extra/y.rb
run_gate < /dev/null
expect_status "agent + stray" 1 "$STATUS"
expect "agent + stray" "test/repo-config-extra/y.rb" "$OUT"
refute "agent + stray" "apps/agent/x.py" "$OUT"
refute "agent + stray" "check" "$RECORDED"
ok "an agent-bucket change does not carry an unowned path through"

# 3. A root manifest selects every package, and drops the dependent closure.
new_repo
commit_change feature pnpm-lock.yaml
run_gate < /dev/null
expect_status "lockfile" 0 "$STATUS"
expect "lockfile" "deps=1" "$OUT"
for name in web catalog users @animichi/agent; do for script in lint typecheck test test:integration; do
  expect "lockfile" "--workspace-concurrency=1 --filter $name run --if-present $script" "$RECORDED"
done; done
refute "lockfile" "--filter ...web" "$RECORDED"
refute "lockfile" "@animichi/agent-python" "$RECORDED"
refute "lockfile" "animichi-cloudflare-worker" "$RECORDED"
ok "a root manifest selects every package once, without the closure prefix"

# 4. Whitelisted paths need no package; the docs bucket still runs its checks.
new_repo
commit_change feature docs/a.md .github/workflows/x.yml test/repo-config/gitleaks.test.rb .gitignore
run_gate < /dev/null
expect_status "docs" 0 "$STATUS"
expect "docs" "packages: (none)" "$OUT"
for check in agents-refs docs-paths root-allowlist spec-references; do
  expect "docs" "check-$check" "$RECORDED"
done
refute "docs" "--filter" "$RECORDED"
ok "CI-owned workflow and repository tests need no package; docs checks still run"

# 5. A ref that is not HEAD is refused: its paths would be gated against the
#    checked-out tree, so a broken change could pass on another branch's green.
new_repo
commit_change other workers/users/src/u.ts
other_sha="$(cd "$REPO" && git rev-parse other)"
commit_change feature workers/catalog/src/c.ts
head_sha="$(cd "$REPO" && git rev-parse HEAD)"
run_gate <<< "refs/heads/other $other_sha refs/heads/other $ZERO"
expect_status "non-HEAD ref" 1 "$STATUS"
expect "non-HEAD ref" "refs must be pushed from their own worktree" "$OUT"
expect "non-HEAD ref" "HEAD is $head_sha" "$OUT"
expect "non-HEAD ref" "refs/heads/other@$other_sha" "$OUT"
refute "non-HEAD ref" "packages:" "$OUT"
ok "a record for a ref other than HEAD is refused, naming both shas"

# 6. The common wrapper case: pre-commit re-exports HEAD's own sha.
gate_env "PRE_COMMIT_TO_REF=$head_sha" "PRE_COMMIT_FROM_REF=$ZERO"
run_gate < /dev/null
expect_status "PRE_COMMIT_TO_REF" 0 "$STATUS"
expect "PRE_COMMIT_TO_REF" "packages: catalog" "$OUT"
refute "PRE_COMMIT_TO_REF" "refs must be pushed" "$OUT"
gate_env GATE_PROBE=1
ok "PRE_COMMIT_TO_REF equal to HEAD is gated normally"

# 7. An empty project list must fail closed, not select everything or nothing.
new_repo
export PNPM_PROJECTS=""
commit_change feature workers/catalog/src/x.ts
run_gate < /dev/null
expect_status "no projects" 1 "$STATUS"
expect "no projects" "no gate covers" "$OUT"
expect "no projects" "workers/catalog/src/x.ts" "$OUT"
ok "an empty project list fails closed instead of matching every path"

# 8. No base to diff against is a broken gate, and a broken gate blocks.
new_repo
commit_change feature workers/catalog/src/x.ts
(cd "$REPO" && git update-ref -d refs/remotes/origin/main)
run_gate < /dev/null
[ "$STATUS" != 0 ] || fail "no origin/main" "expected a non-zero exit, got 0"
ok "a missing origin/main fails the push rather than gating nothing"

# 9. The package prefix is a directory, not a string.
new_repo
commit_change feature workers/catalog-extra/x.ts
run_gate < /dev/null
expect_status "sibling dir" 1 "$STATUS"
expect "sibling dir" "no gate covers" "$OUT"
expect "sibling dir" "workers/catalog-extra/x.ts" "$OUT"
expect "sibling dir" "packages: (none)" "$OUT"
new_repo
commit_change feature workers/catalog/x.ts
run_gate < /dev/null
expect_status "sibling dir" 0 "$STATUS"
expect "sibling dir" "packages: catalog" "$OUT"
ok "a sibling directory sharing a package's name prefix selects no package"

# 10. The owner table decides the spec-reference gate's verdict, so a change to
#     it alone must run that gate — `scripts/**` needs no package, which would
#     otherwise let the table move without the gate ever re-reading it.
new_repo
commit_change feature scripts/local-gates/spec-reference-exceptions.txt
run_gate < /dev/null
expect_status "owner table" 0 "$STATUS"
expect "owner table" "docs=1" "$OUT"
expect "owner table" "check-spec-references" "$RECORDED"
refute "owner table" "--filter" "$RECORDED"
ok "an owner-table-only change selects the docs bucket"

# 11. A nested agent-context document outside a workspace package
#     (`migrations/AGENTS.md`) must fire the docs bucket, not fail closed.
new_repo
commit_change feature migrations/AGENTS.md
run_gate < /dev/null
expect_status "nested agent doc" 0 "$STATUS"
expect "nested agent doc" "docs=1" "$OUT"
refute "nested agent doc" "no gate covers" "$OUT"
ok "a nested agent-context document fires the docs bucket instead of failing closed"

# 12. The contract's routing row carries two buckets, and the agent one is why
#     the Python lane runs: a contract change must reach `make check` as well as
#     the package's own scripts, or the agent's half of the contract is ungated
#     while the rest of the suite stays green (#1687).
new_repo
commit_change feature packages/contract/src/x.ts
run_gate < /dev/null
expect_status "contract is routed to both buckets" 0 "$STATUS"
expect "contract is routed to both buckets" "agent=1" "$OUT"
expect "contract is routed to both buckets" "make check" "$RECORDED"
expect "contract is routed to both buckets" "--filter ...@animichi/contract run --if-present test" "$RECORDED"
ok "a contract change fires the agent bucket as well as the package's own scripts"

# 13. A package pnpm reports that the routing table does not name has no bucket
#     to fire, so it stops the push naming itself — including when the diff is
#     somewhere else, which is what keeps an added package from being ungated
#     behind an unrelated change (#1687).
new_repo
export PNPM_PROJECTS="$PROJECTS packages/orphan:@animichi/orphan"
commit_change feature packages/orphan/src/y.ts
run_gate < /dev/null
expect_status "unrouted package" 1 "$STATUS"
expect "unrouted package" "packages/orphan is a workspace package with no routing row" "$OUT"
refute "unrouted package" "--filter" "$RECORDED"
commit_change feature workers/catalog/src/x.ts
run_gate < /dev/null
expect_status "unrouted package, other diff" 1 "$STATUS"
expect "unrouted package, other diff" "packages/orphan is a workspace package with no routing row" "$OUT"
ok "a workspace package with no routing row stops the push, naming it, whatever changed"

finish
