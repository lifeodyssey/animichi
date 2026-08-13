#!/usr/bin/env bash
# Pre-push gate orchestrator (#1003): mirror every deterministic CI check that
# can run locally on every push, fail-fast, routed by the changed package set.
#
# Routing (#1003): `scripts/local-gates/changed-packages.sh` reads the
# merge-base-to-head diff (AC1) and is the ONLY route source. The real hook
# never reads an override variable, so a caller cannot set
# GATE_CHANGED_PACKAGES to shrink the route and skip agent/db/infra gates.
# The deterministic Quality lane always runs (repo-wide, sub-second). Each
# affected package then runs its CI-equivalent gate set (lint + typecheck +
# unit + coverage + build, contract drift for contract, Pulumi program-load
# for infra, fresh-schema apply for db). `all` (unknown/root paths) runs every
# package's full gate set (AC2) — never a typecheck-only shortcut. The
# behavioral tests inject routes only through the dedicated test driver
# (scripts/local-gates/pre-push-test-driver.sh), which sources this file and
# calls run_pre_push; this file's real entry runs the canonical router and
# nothing else.
#
# Orchestration is decomposed to stay inside the repo's 1-10-50 rule: the
# routing state (changed / ALL / route_includes) is bound in init_route, each
# package's CI-equivalent gate set is a small gate_<package> function, and
# run_pre_push is a short dispatcher over them (run_package_gates).
#
# Everything runs exactly as CI runs it; nothing weaker is duplicated here.
# Fail-fast: the first failing gate aborts the push (set -euo pipefail).
# No command here mutates shared cloud infrastructure (test_no_forbidden_cloud_mutation_commands).
#
# Contract: docs/ops/local-gates.md. Behavioral tests: pre-push.test.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Prerequisite data (tool: install-hint). The presence loop keeps the rest of
# each line (including colons in URLs) as the hint, exactly as CI's install
# docs state.
PREREQ_TOOLS=(
  "uv: https://docs.astral.sh/uv/ — curl -LsSf https://astral.sh/uv/install.sh | sh"
  "pnpm: corepack enable, or npm install -g pnpm@10.33.2"
  "node: Node >= 24 required (nvm or Homebrew)"
  "ruby: system Ruby is sufficient"
  "atlas: must print a version (CI pins v0.30.0) — brew install ariga/tap/atlas, or download the darwin/linux binary for your arch from https://release.ariga.io/atlas/ (checksum in .github/workflows/pipeline-db.yml)"
  "pulumi: brew install pulumi/tap/pulumi"
  "docker: Docker Desktop/colima with the daemon running (fresh-schema + agent integration; the gate fails closed when it is unavailable)"
  "actionlint: brew install actionlint (CI pins v1.7.7)"
  "git: required for the contract drift checks"
)

prereq_hint() {
  printf '%s\n' "${PREREQ_TOOLS[@]}" | sed -n "s/^$1://p"
}

check_node_version() {
  command -v node >/dev/null 2>&1 || return 0
  local version major
  version="$(node -v 2>/dev/null)"
  major="${version#v}"; major="${major%%.*}"
  [ "${major:-0}" -lt 24 ] || return 0
  printf 'prerequisite version mismatch: node %s — %s\n' "$version" "$(prereq_hint node)" >&2
  return 1
}

check_atlas_version() {
  command -v atlas >/dev/null 2>&1 || return 0
  local version
  version="$(atlas version 2>/dev/null | head -n1)"
  [ -n "$version" ] && return 0
  printf 'prerequisite version mismatch: atlas produced no version — %s\n' "$(prereq_hint atlas)" >&2
  return 1
}
report_missing_prereqs() {
  local tool hint missing=0
  while IFS=: read -r tool hint; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      printf 'missing prerequisite: %s (%s)\n' "$tool" "$hint" >&2
      missing=1
    fi
  done <<< "$(printf '%s\n' "${PREREQ_TOOLS[@]}")"
  [ "$missing" -eq 0 ]
}

fail_prereqs() {
  printf 'install the missing prerequisites, then retry the push.\n' >&2
  exit 1
}

check_prereqs() {
  local missing=0
  report_missing_prereqs || missing=1
  check_node_version || missing=1
  check_atlas_version || missing=1
  [ "$missing" -eq 0 ] || fail_prereqs
}

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

gate() {
  local dir="$1"; shift
  printf '\n==> [%s] %s\n' "$dir" "$*"
  (cd "$dir" && "$@")
}

# Routing state: bound by init_route, consumed by route_has / route_includes.
changed=""
ALL=false

# route_has: raw membership of "$1" in the route string — no `all` expansion.
route_has() {
  printf '%s\n' "$changed" | grep -qx "$1"
}

# route_includes: does the route require "$1" (a package)? The `all` route
# short-circuits to yes for every package.
route_includes() {
  [ "$ALL" = true ] || route_has "$1"
}

# init_route: bind the routing state for one run from the route argument.
# The `if` form keeps this function returning 0 for any route (set -e safe).
init_route() {
  changed="$1"
  ALL=false
  if route_includes all; then ALL=true; fi
}

# run_pre_push: the full gate orchestration for one package set. $1 is the
# route (one package per line; `all` = every package). The real entry passes
# the canonical router's output; the test driver injects a fixed route.
run_pre_push() {
  init_route "$1"
  check_prereqs
  setup_gate_env
  run bash scripts/local-gates/quality.sh
  run_package_gates
  run_scripts_self_tests
  finish_gate "$changed"
}

# setup_gate_env: a unique scratch dir for build dry-runs; cleaned on exit.
# The dir is ALWAYS created here (mktemp -d) — an inherited GATE_OUTDIR is
# never used and never deleted, so the gate cannot rm -rf a directory it does
# not own.
setup_gate_env() {
  GATE_OUTDIR="$(mktemp -d)"
  trap 'rm -rf "${GATE_OUTDIR:-}"' EXIT
}

# finish_gate: the pass banner (the behavioral tests assert its exact format).
finish_gate() {
  printf '\npre-push gate: deterministic set for [%s] passed.\n' "${1//$'\n'/,}"
}

# ── agent (AC3): the full deterministic CI surface from
# .github/workflows/pipeline-agent.yml in CI's job order — ruff lint (check),
# ruff format check, mypy, vulture, then the canonical unit coverage floor from
# pyproject addopts (--cov-fail-under=87 — never overridden here), the offline
# docker-arm integration against a disposable fresh schema, and the container
# image build (docker build -f apps/agent/Dockerfile -t animichi-agent:ci .,
# from the repo root exactly as the CI build job runs it). The integration
# pytest is invoked through `env -u` on every live/BYO selector so an exported
# TEST_DB / TEST_DATABASE_URL can never route the local gate to Neon or a
# mutable external database — it deterministically uses the Docker arm
# (conftest_db.py fails closed when the offline image is missing; nothing is
# silently skipped).
gate_agent() {
  gate apps/agent uv run ruff check
  gate apps/agent uv run ruff format --check src/animichi/
  gate apps/agent uv run mypy src/animichi/agents/ src/animichi/interfaces/ src/animichi/domain/ src/animichi/infrastructure/ src/animichi/clients/
  gate apps/agent uv run vulture src/animichi/ vulture_whitelist.py
  gate apps/agent uv run pytest src/animichi/tests/unit/ -v --cov --cov-report=xml
  gate apps/agent env -u TEST_DB -u TEST_DATABASE_URL -u TEST_DB_ALLOW_MUTATION -u NEON_API_KEY -u NEON_PROJECT_ID -u NEON_ENDPOINT_SUFFIX uv run pytest src/animichi/tests/integration/ -v --no-cov
  run docker build -f apps/agent/Dockerfile -t animichi-agent:ci .
}

# ── web (AC4): CI lint + coverage-enabled test + build/output-layout
# integration test with the showcase guard CI sets.
gate_web() {
  gate apps/web pnpm --filter web typecheck
  gate apps/web pnpm --filter web run lint:oxlint
  gate apps/web pnpm --filter web test
  gate apps/web env VITE_SHOWCASE_MODE=false pnpm --filter web test:integration
}

# ── catalog (AC4): CI lint, coverage test, bundled-boot smoke, and the
# deploy-path dry-run (the build stage's hermetic proxy).
gate_catalog() {
  gate workers/catalog pnpm exec tsc --noEmit
  gate workers/catalog pnpm run lint:oxlint
  gate workers/catalog pnpm run test:worker
  gate workers/catalog pnpm run test:smoke
  gate workers/catalog pnpm exec wrangler deploy --dry-run --env= --outdir "$GATE_OUTDIR/catalog-bundle"
}

# ── users (AC4): CI lint, coverage test, deploy-path dry-run.
gate_users() {
  gate workers/users pnpm exec tsc --noEmit
  gate workers/users pnpm run lint:oxlint
  gate workers/users pnpm run test:worker
  gate workers/users pnpm exec wrangler deploy --dry-run --env= --outdir "$GATE_OUTDIR/users-bundle"
}

# ── edge (AC4): CI lint + node:test suite (doubles as the workflow-content
# guard tests) + production-config dry-run from the repo root.
gate_edge() {
  gate workers/edge pnpm run lint:oxlint
  run pnpm run test:worker
  run pnpm exec wrangler deploy -c workers/edge/wrangler.toml --dry-run -e production --outdir "$GATE_OUTDIR/edge-bundle"
}

# ── contract (AC2): CI lint + tests + the build-stage drift checks (OpenAPI
# documents and the generated agent Python models must regenerate clean).
# The OpenAPI drift check mirrors pipeline-contract.yml's build stage: it
# emits, stages the generated documents into a throwaway index, and fails on
# `git diff --cached` (scripts/local-gates/contract-drift.sh). The agent-model
# drift check compares the regenerated file to HEAD (`git diff HEAD`) — a
# staged correction cannot mask drift against the committed snapshot.
gate_contract() {
  gate packages/contract pnpm exec tsc --noEmit
  gate packages/contract pnpm run test
  gate packages/contract pnpm emit:openapi
  run bash scripts/local-gates/contract-drift.sh
  gate packages/contract pnpm emit:agent-python
  run git diff --exit-code HEAD -- apps/agent/src/animichi/interfaces/boundary/agent_models.py
}

# ── infra (AC4/AC7): CI typecheck + topology tests, then the credential-free
# Pulumi program-load check that catches loader/compiler incompatibility
# ordinary tsc --noEmit misses (TS5096 class).
gate_infra() {
  gate infra pnpm run typecheck
  gate infra pnpm test
  run bash scripts/local-gates/infra-check.sh
}

# ── db (AC3): checksum+parse validation, the migration boundary guard, and a
# fresh-schema apply on a disposable postgres container (never shared Neon).
gate_db() {
  run atlas migrate validate --dir file://migrations/neon
  run node --test workers/edge/test/migration-boundary.test.ts
  run bash scripts/local-gates/db-fresh-schema.sh
}

# ── docs (AC2/AC7): the two agent unit tests that assert docs/CI content stay
# in sync with the code (the full doc suite runs with the agent unit gate).
gate_docs() {
  gate apps/agent uv run pytest src/animichi/tests/unit/test_secrets_docs_consistency.py src/animichi/tests/unit/test_documentation_guardrails.py -q --no-cov
}

# ── run_package_gates: every package's CI-equivalent gate set, routed by the
# current route. A failing gate aborts the whole push (set -euo pipefail);
# a route that does not include the package simply skips it.
run_package_gates() {
  local pkg
  for pkg in agent web catalog users edge contract infra db docs; do
    if route_includes "$pkg"; then "gate_$pkg"; fi
  done
}

# ── run_full_scripts_suite: the gates' own behavioral tests (self-testing
# orchestration surface, AC5).
SCRIPT_SUITE=(
  pre-push.test.sh
  changed-packages.test.sh
  db-fresh-schema.test.sh
  infra-check.test.sh
  infra-check-unauthorized.test.sh
  pre-commit-config.test.sh
  contract-drift.test.sh
)

run_full_scripts_suite() {
  local f
  for f in "${SCRIPT_SUITE[@]}"; do
    run bash "scripts/local-gates/$f"
  done
}

# ── run_scripts_self_tests (AC5): an explicit `scripts` change runs the full
# suite; the `all` fallback (root config, unknown paths) still runs the config
# contract self-test so a root-only `.pre-commit-config.yaml` change cannot
# skip it. The recursive pre-push.test.sh stays scoped to an EXPLICIT
# `scripts` change — letting `all` nest the local-gates suite into itself
# would recurse. Uses route_has (raw membership), never the `all` expansion.
run_scripts_self_tests() {
  if route_has scripts; then
    run_full_scripts_suite
  elif route_has all; then
    run bash scripts/local-gates/pre-commit-config.test.sh
  fi
}

# Real hook entry: the canonical router is the only route source. Sourcing this
# file (the test driver's route-injection seam) skips this guard.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  changed="$(bash scripts/local-gates/changed-packages.sh)"
  run_pre_push "$changed"
fi
