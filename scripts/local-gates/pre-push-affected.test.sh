#!/usr/bin/env bash
# SUT: scripts/local-gates/pre-push-affected.sh — the selection a push's diff selects
# Behavioral tests for pre-push-affected.sh's selection (#1371, #1687): which
# packages a diff selects, which buckets fire, and which paths fail closed. The
# fixture this file shares with pre-push-affected-commitlint.test.sh — one throwaway
# repository per case, a fake pnpm / make and the assertion helpers — is
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
commit_change feature packages/pi-session-neon/migrations/app/x/ops.json test/repo-config-extra/y.rb
run_gate < /dev/null
expect_status "schema + stray" 1 "$STATUS"
expect "schema + stray" "test/repo-config-extra/y.rb" "$OUT"
refute "schema + stray" "packages/pi-session-neon/migrations/app/x/ops.json" "$OUT"
refute "schema + stray" "migrate validate" "$RECORDED"
ok "a schema-bucket change does not carry an unowned path through"

# 3. A root manifest selects every package, and drops the dependent closure.
new_repo
commit_change feature pnpm-lock.yaml
run_gate < /dev/null
expect_status "lockfile" 0 "$STATUS"
expect "lockfile" "deps=1" "$OUT"
for script in lint typecheck test test:integration; do
  expect "lockfile" "--workspace-concurrency=1 --filter @animichi/agent --filter @animichi/contract --filter web --filter catalog --filter users run --if-present $script" "$RECORDED"
done
refute "lockfile" "--filter ...web" "$RECORDED"
refute "lockfile" "animichi-cloudflare-worker" "$RECORDED"
ok "a root manifest selects every package once, without the closure prefix"

# 4. Whitelisted paths need no package; the docs bucket still runs its checks.
new_repo
commit_change feature docs/a.md .github/workflows/x.yml test/repo-config/gitleaks.test.rb .gitignore \
  Gemfile Gemfile.lock .ruby-version
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

# 12. A contract change runs the contract's own scripts over its dependents, and
#     nothing else: the Python lane that also consumed it is gone (#1607).
new_repo
commit_change feature packages/contract/src/x.ts
run_gate < /dev/null
expect_status "contract routes to its package" 0 "$STATUS"
expect "contract routes to its package" "--filter ...@animichi/contract run --if-present test" "$RECORDED"
refute "contract routes to its package" "make check" "$RECORDED"
ok "a contract change runs the contract's own scripts over its dependents"

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

# 14. The catalog database suite is a package script, so a catalog change runs it, and a red one
#     stops the push. Until #1726 it was `test:spike`, named only by a one-off CI step, so a change
#     that broke catalog's SQL passed this hook and was caught in CI. The mutation here is that
#     script exiting non-zero — a broken query's assertion — which the gate must propagate.
new_repo
commit_change feature workers/catalog/src/x.ts
gate_env PNPM_FAIL_SCRIPT=test:integration
run_gate < /dev/null
expect_status "catalog integration failure" 1 "$STATUS"
expect "catalog integration failure" "packages: catalog" "$OUT"
expect "catalog integration failure" "--filter ...catalog run --if-present test:integration" "$RECORDED"
expect "catalog integration failure" "--filter ...catalog run --if-present test" "$RECORDED"
ok "a failing catalog test:integration stops the push"
gate_env GATE_PROBE=1  # the failure injection must not leak into later cases

# 15. A path the diff deletes has nothing left to gate — and a deleted package
#     can never cover its own deleted files, because `pnpm ls` answers from the
#     surviving tree (#1607). Deletions are waived; the surviving package of a
#     mixed diff still gates.
new_repo packages/old/src/x.ts packages/old/package.json
commit_delete feature packages/old
commit_message 'fix(catalog): probe the gate' workers/users/src/u.ts
run_gate < /dev/null
expect_status "deleted package" 0 "$STATUS"
refute "deleted package" "no gate covers" "$OUT"
expect "deleted package" "packages: users" "$OUT"
expect "deleted package" "--filter ...users run --if-present lint" "$RECORDED"
ok "a deleted package's paths are covered by definition; survivors still gate"

# 16. A deletion inside a surviving package is still that package's change: it
#     selects the package and covers its path — the waiver leaves selection
#     alone (#1607).
new_repo workers/catalog/src/gone.ts
commit_delete feature workers/catalog/src/gone.ts
run_gate < /dev/null
expect_status "deleted file in package" 0 "$STATUS"
expect "deleted file in package" "packages: catalog" "$OUT"
expect "deleted file in package" "--filter ...catalog run --if-present lint" "$RECORDED"
refute "deleted file in package" "no gate covers" "$OUT"
ok "a deleted file inside a surviving package still selects that package"

# 17. The retired stack's stragglers: the root analyzer configs name CI-side
#     scanners with no local gate, and supabase/ is the archived historical
#     migration dir (#1000), not a live surface — whitelisted, so a later
#     touch of any of the three cannot block a push either (#1607).
new_repo
commit_change feature .codacy.yml .sonarcloud.properties supabase/README.md
run_gate < /dev/null
expect_status "analyzer configs" 0 "$STATUS"
expect "analyzer configs" "packages: (none)" "$OUT"
refute "analyzer configs" "no gate covers" "$OUT"
refute "analyzer configs" "--filter" "$RECORDED"
ok "root analyzer configs and the archived supabase/ doc need no gate"

# 18. Waiving deletions must not waive the living: an unowned path that still
#     exists stops the push exactly as before.
new_repo
commit_change feature nowhere/thing.txt
run_gate < /dev/null
expect_status "unowned survivor" 1 "$STATUS"
expect "unowned survivor" "no gate covers" "$OUT"
expect "unowned survivor" "nowhere/thing.txt" "$OUT"
ok "an unowned surviving path still fails closed"

# 19. Deletions keep counting in the bucket tallies: removing a docs file must
#     still fire the docs checks rather than silently drop the bucket (#1607).
new_repo docs/gone.md
commit_delete feature docs/gone.md
run_gate < /dev/null
expect_status "deleted docs file" 0 "$STATUS"
expect "deleted docs file" "docs=1" "$OUT"
for check in agents-refs docs-paths root-allowlist spec-references; do
  expect "deleted docs file" "check-$check" "$RECORDED"
done
refute "deleted docs file" "no gate covers" "$OUT"
ok "a deleted docs file still fires the docs bucket"

# 20. Three changed packages whose dependent closures overlap must hand pnpm
#     the union of the closures — one selection per script — so a dependent
#     shared by two closures is gated once per push, not once per selector
#     (#1770). The selectors keep the routing order the table gives.
new_repo
commit_change feature apps/web/src/w.ts packages/contract/src/c.ts workers/catalog/src/x.ts
run_gate < /dev/null
expect_status "closure union" 0 "$STATUS"
for script in lint typecheck test test:integration; do
  expect "closure union" "--filter ...@animichi/contract --filter ...web --filter ...catalog run --if-present $script" "$RECORDED"
done
runs="$(grep -c 'run --if-present' <<<"$RECORDED")"
[ "$runs" = 4 ] || fail "closure union" "expected one run per script over the union (4), got $runs: $RECORDED"
ok "three overlapping closures run as one union per script, in routing order"

# 21. node passes a coverage threshold on a report that measured nothing, so the
#     reports the scripts wrote are read back over the same union, after the last
#     of them — and a refused report stops the push (#1766).
new_repo
commit_change feature packages/contract/src/c.ts workers/catalog/src/x.ts
run_gate < /dev/null
expect_status "coverage report check" 0 "$STATUS"
check="--workspace-concurrency=1 --filter ...@animichi/contract --filter ...catalog exec ruby"
expect "coverage report check" "$check" "$RECORDED"
expect "coverage report check" "test/repo-config/check-coverage-report.rb" "$RECORDED"
last="$(tail -n 1 <<<"$RECORDED")"
expect "coverage report check" "exec ruby" "$last"
gate_env PNPM_FAIL_SCRIPT=exec
run_gate < /dev/null
expect_status "coverage report refused" 1 "$STATUS"
gate_env GATE_PROBE=1
ok "the coverage reports are checked over the same union after the scripts, and a refusal blocks"

finish
