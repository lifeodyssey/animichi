#!/usr/bin/env bash
# Behavioral routing tests for the explicit PR base/head adapter.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTE="$SCRIPT_DIR/pr-verification-route.sh"
WORKSPACE_LIB="$SCRIPT_DIR/../../scripts/local-gates/workspace-packages.sh"
MANIFEST="$SCRIPT_DIR/../ci/components.json"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pr-verification-route.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

workspace_dirs=(agent web catalog users edge migrator contract e2e infra)

package_path() {
  case "$1" in
    agent|web) printf 'apps/%s\n' "$1" ;;
    contract) printf 'packages/contract\n' ;;
    e2e|infra) printf '%s\n' "$1" ;;
    *) printf 'workers/%s\n' "$1" ;;
  esac
}

make_fixture() {
  local root="$1" dir package_dir
  mkdir -p "$root/scripts/local-gates"
  cp "$WORKSPACE_LIB" "$root/scripts/local-gates/workspace-packages.sh"
  printf '%s\n' 'packages:' '  - "workers/*"' '  - "apps/*"' '  - "packages/*"' '  - "e2e"' '  - "infra"' > "$root/pnpm-workspace.yaml"
  for dir in agent web catalog users edge migrator contract; do
    package_dir="$(package_path "$dir")"
    mkdir -p "$root/$package_dir"
  done
  mkdir -p "$root/e2e" "$root/infra"
  for dir in "${workspace_dirs[@]}"; do
    package_dir="$(package_path "$dir")"
    printf '{"name":"%s"}\n' "$dir" > "$root/$package_dir/package.json"
  done
  git -C "$root" init -q
  git -C "$root" config user.name test
  git -C "$root" config user.email test@example.com
  git -C "$root" add .
  git -C "$root" commit -qm base
}

route_case() {
  local label="$1" relative="$2" expected="$3" root base head output
  root="$TMP/$label"
  mkdir -p "$root"
  make_fixture "$root"
  mkdir -p "$root/$(dirname "$relative")"
  printf 'changed\n' > "$root/$relative"
  git -C "$root" add .
  git -C "$root" commit -qm change
  base="$(git -C "$root" rev-parse HEAD^)"
  head="$(git -C "$root" rev-parse HEAD)"
  output="$(PR_VERIFICATION_ROOT="$root" PR_VERIFICATION_MANIFEST="$MANIFEST" bash "$ROUTE" "$base" "$head")"
  [ "$output" = "$expected" ] || { echo "FAIL $label: expected [$expected], got [$output]" >&2; exit 1; }
}

route_case agent apps/agent/change.ts agent
route_case web apps/web/change.ts $'e2e\nweb'
route_case catalog workers/catalog/change.ts catalog
route_case users workers/users/change.ts users
route_case edge workers/edge/change.ts edge
route_case migrator workers/migrator/change.ts migrator
route_case contract packages/contract/change.ts $'agent\ncatalog\ncontract\ne2e\nedge\nmigrator\nusers\nweb'
route_case e2e e2e/change.ts e2e
route_case infra infra/change.ts infra
route_case docs docs/change.md docs
route_case secrets-read docs/ops/secrets.md docs
route_case vitest-read apps/web/vitest.config.ts $'docs\ne2e\nweb'
route_case container-env-read workers/edge/src/container/container-env.ts $'docs\nedge'
route_case auth-read workers/edge/src/identity/auth.ts $'edge\nusers'
route_case turnstile-read workers/edge/src/protect/turnstile.ts $'e2e\nedge\nweb'
route_case migrations migrations/change.sql $'agent\ncatalog\ndb\nedge\nmigrator\nusers'
ALL_EXPECTED=$'agent\ncatalog\ncontract\ndb\ndocs\ne2e\nedge\ninfra\nmigrator\nusers\nweb'
route_case workflow .github/workflows/change.yml ""
route_case readme README.md ""
route_case unknown unknown-root.txt "$ALL_EXPECTED"

echo "PR Verification routing tests: every workspace package and path bucket route deterministically"
