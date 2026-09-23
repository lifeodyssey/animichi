#!/usr/bin/env bash
# SUT: scripts/local-gates/pre-push-affected.sh — the contracts bucket a push selects
# Behavioral tests for the contracts bucket (#1883): the three families that run
# CI's `contracts` job — `.github/**`, `scripts/**` and `test/repo-config/**` —
# and the pushes that run none of it. The fixture this file shares with
# pre-push-affected.test.sh and pre-push-affected-commitlint.test.sh is
# pre-push-fixture.sh, which stubs the bucket's runner: a case reads the
# invocation off the record rather than running that job's 74 commands.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pre-push-fixture.sh"

# 1. `.github/**` is what every `.github/test/*.test.rb` reads and it was
#    whitelisted until this card, so a change to a workflow reached CI's
#    `contracts` job with no local reader at all. It fires that job's own
#    registry, and selects no package.
new_repo
commit_change feature .github/workflows/x.yml
run_gate < /dev/null
expect_status "workflow change" 0 "$STATUS"
expect "workflow change" "packages: (none)" "$OUT"
expect "workflow change" "contracts=1" "$OUT"
expect "workflow change" "repository-contracts" "$RECORDED"
refute "workflow change" "--filter" "$RECORDED"
ok "a workflow change runs the contracts bucket and selects no package"

# 2. The other two families. `scripts/**` holds the two Orca runners the
#    contracts job runs, `delivery-test-naming.test.rb`'s four delivery homes
#    and `pre-push-routing.test.rb`'s subject; `test/repo-config/**` is the
#    contracts' own home, where a changed contract has to re-run.
new_repo
commit_change feature scripts/delivery/x.sh
run_gate < /dev/null
expect_status "delivery script change" 0 "$STATUS"
expect "delivery script change" "contracts=1" "$OUT"
expect "delivery script change" "repository-contracts" "$RECORDED"
refute "delivery script change" "--filter" "$RECORDED"
ok "a scripts/ change runs the contracts bucket"

new_repo
commit_change feature test/repo-config/x.test.rb
run_gate < /dev/null
expect_status "contract test change" 0 "$STATUS"
expect "contract test change" "contracts=1" "$OUT"
expect "contract test change" "repository-contracts" "$RECORDED"
ok "a changed contract test re-runs the contracts bucket"

# 3. A push that touches none of the three runs none of it: the bucket is the
#    contracts' own, not a tax on every push. The diff carries the rest of the
#    whitelist too — a docs file and the root configs the contracts job also
#    reads — so a route that grew or shrank shows up here. `Gemfile.lock` and
#    `.ruby-version` are this case's own: the split left them with no
#    `contracts=0` guard anywhere else.
new_repo
commit_change feature workers/catalog/src/x.ts docs/a.md Gemfile Gemfile.lock .ruby-version .gitignore
run_gate < /dev/null
expect_status "outside the contracts" 0 "$STATUS"
expect "outside the contracts" "contracts=0" "$OUT"
refute "outside the contracts" "repository-contracts" "$RECORDED"
expect "outside the contracts" "--filter ...catalog run --if-present test" "$RECORDED"
ok "a push outside the contracts' three families runs no contract test"

finish
