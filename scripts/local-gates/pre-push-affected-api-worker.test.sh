#!/usr/bin/env bash
# SUT: scripts/local-gates/pre-push-affected.sh — the API Worker's routing row
# The edge Worker's code moved to `workers/api` as the package `api` (#1928). The
# gate joins `pnpm ls` against its routing table by directory, so a row left
# under the old directory would stop the push on "no routing row" at best, and a
# change under the new one must select the package exactly as the old directory
# did: the `package` bucket, its own four scripts over its dependent closure, and
# the coverage read-back. The fixture is pre-push-fixture.sh; the project list
# below is its default plus the Worker.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pre-push-fixture.sh"

API_PROJECTS="$PROJECTS workers/api:api"

new_repo
export PNPM_PROJECTS="$API_PROJECTS"
commit_change feature workers/api/src/entry.ts
run_gate < /dev/null
expect_status "api worker change" 0 "$STATUS"
expect "api worker change" "packages: api |" "$OUT"
for script in lint typecheck test test:integration; do
  expect "api worker change" "--workspace-concurrency=1 --filter ...api run --if-present $script" "$RECORDED"
done
expect "api worker change" "--workspace-concurrency=1 --filter ...api exec ruby" "$RECORDED"
refute "api worker change" "no routing row" "$OUT"
ok "a change under workers/api selects the api package's own gates"

new_repo
export PNPM_PROJECTS="$API_PROJECTS"
commit_change feature workers/api/AGENTS.md
run_gate < /dev/null
expect_status "api worker guide" 0 "$STATUS"
expect "api worker guide" "packages: api |" "$OUT"
expect "api worker guide" "docs=1" "$OUT"
ok "the Worker's own agent guide selects its package and the docs checks"

finish
