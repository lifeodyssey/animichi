#!/usr/bin/env bash
# Workspace-derivation tests for the changed-package router (#1113).
# Sourced by changed-packages.test.sh (the single entry); not standalone.
#
# Independent SoT for the package list is pnpm-workspace.yaml (sed) plus
# directories that contain package.json (bash glob). Gate functions are
# grepped from pre-push.sh and pre-push-worker-gates.sh. This file must not
# source workspace-packages.sh.
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRE_PUSH="$SCRIPT_DIR/pre-push.sh"

workspace_yaml_globs() {
  sed -n 's/^[[:space:]]*-[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' \
    "$REPO_ROOT/pnpm-workspace.yaml"
}

expand_star_packages() {
  local prefix="$1" d
  for d in "$REPO_ROOT/$prefix"/*; do
    [ -f "$d/package.json" ] || continue
    printf '%s\n' "${d##*/}"
  done
}

# Expand one yaml glob via a different path than the router (bash glob vs awk).
expand_yaml_glob() {
  case "$1" in
    workers/*) expand_star_packages workers ;;
    apps/*) expand_star_packages apps ;;
    packages/*) expand_star_packages packages ;;
    e2e) [ -f "$REPO_ROOT/e2e/package.json" ] && printf 'e2e\n' ;;
    infra) [ -f "$REPO_ROOT/infra/package.json" ] && printf 'infra\n' ;;
    *) echo "FAIL: independent expander does not cover yaml glob: $1" >&2; return 1 ;;
  esac
}

independent_extra_gate_dirs() {
  sed -n 's/^EXTRA_GATE_DIRS="\(.*\)"$/\1/p' "$SCRIPT_DIR/workspace-packages.sh"
}

emit_yaml_package_names() {
  local glob
  while IFS= read -r glob; do
    [ -n "$glob" ] || continue
    expand_yaml_glob "$glob"
  done <<< "$(workspace_yaml_globs)"
}

emit_extra_package_names() {
  local extra
  extra="$(independent_extra_gate_dirs)"
  [ -z "$extra" ] || printf '%s\n' "$extra" | sed 's|.*/||'
}

independent_workspace_names() {
  { emit_yaml_package_names; emit_extra_package_names; } | sort -u
}

gate_defined_in() {
  grep -qE "^gate_$1\(\)" "$2" "$SCRIPT_DIR/pre-push-worker-gates.sh"
}

assert_every_workspace_package_has_gate() {
  local file="$1" pkg missing=0
  while IFS= read -r pkg; do
    [ -n "$pkg" ] || continue
    gate_defined_in "$pkg" "$file" && continue
    echo "FAIL: workspace package '$pkg' has no gate_$pkg set in $file" >&2
    missing=1
  done <<< "$(independent_workspace_names)"
  [ "$missing" -eq 0 ]
}

# AC: workers/migrator/foo.ts routes to migrator, never `all`. Migrator
# imports @animichi/contract/oidc-github (workers/migrator/src/policy.ts),
# so the existing consumer-union rule also emits contract.
test_migrator_change_routes_to_migrator() {
  seed_base
  mkdir -p workers/migrator
  touch workers/migrator/foo.ts
  git add workers/migrator/foo.ts
  assert_eq $'contract\nmigrator' "$(run_staged)" \
    "migrator-only change routes to migrator+contract, not all"
  echo "ok: workers/migrator/ change routes to migrator (contract union)"
}

test_workspace_packages_have_gate_sets() {
  assert_every_workspace_package_has_gate "$PRE_PUSH" \
    || { echo "FAIL: every derived workspace package must have a gate set" >&2; exit 1; }
  echo "ok: every derived workspace package has a gate set"
}

# Mutation on a one-time copy (never edit the signed-in file): strip gate_web
# → assertion red; original file still green.
strip_gate_web_copy() {
  sed '/^gate_web() {/,/^}/d' "$PRE_PUSH"
}

assert_copy_missing_web_gate() {
  local copy="$1" err="$2"
  if assert_every_workspace_package_has_gate "$copy" 2>"$err"; then
    echo "FAIL: removing gate_web must fail the gate-set assertion" >&2
    return 1
  fi
  grep -q "has no gate_web set" "$err" && return 0
  echo "FAIL: red path must name the missing gate_web" >&2
  cat "$err" >&2
  return 1
}

test_missing_gate_set_fails_closed_on_copy() {
  local copy err
  copy="$(mktemp "$TMP/pre-push.XXXXXX")"
  err="$(mktemp "$TMP/pre-push-err.XXXXXX")"
  strip_gate_web_copy > "$copy"
  assert_copy_missing_web_gate "$copy" "$err"
  assert_every_workspace_package_has_gate "$PRE_PUSH" \
    || { echo "FAIL: original gate sets must still pass" >&2; exit 1; }
  echo "ok: missing gate set fails closed on a copy; original stays green"
}

workspace_path_case_arm() {
  grep -E '^[[:space:]]+(apps|workers|packages)/[^[:space:]]+\)' "$1"
}

literal_workspace_case_arm() {
  grep -E '^[[:space:]]+(e2e|infra)(/\*)?\)' "$1"
}

test_router_has_no_handwritten_workspace_cases() {
  if workspace_path_case_arm "$ROUTER" || literal_workspace_case_arm "$ROUTER"; then
    echo "FAIL: router must not hand-write workspace path-case arms" >&2
    workspace_path_case_arm "$ROUTER" || true
    literal_workspace_case_arm "$ROUTER" || true
    exit 1
  fi
  echo "ok: router has no handwritten workspace path-case arms"
}

write_literal_miss_yaml() {
  printf '%s\n' 'packages:' '  - "e2e"' '  - "no-such-pkg"' '  - "infra"'
}

derived_names_from_yaml() {
  GATE_REPO_ROOT="$REPO_ROOT" GATE_WORKSPACE_YAML="$1" bash -c \
    'set -euo pipefail; source "$0"; load_workspace_packages; printf "%s\n" "$WORKSPACE_NAMES"' \
    "$SCRIPT_DIR/workspace-packages.sh"
}

assert_name_present() {
  printf '%s\n' "$1" | grep -qx "$2" \
    || { echo "FAIL: derived names lack $2" >&2; exit 1; }
}

assert_name_absent() {
  if printf '%s\n' "$1" | grep -qx "$2"; then
    echo "FAIL: derived names must not include $2" >&2
    exit 1
  fi
}

test_literal_glob_without_package_json_is_skipped() {
  local yaml names
  yaml="$(mktemp "$TMP/ws.XXXXXX.yaml")"
  write_literal_miss_yaml > "$yaml"
  names="$(derived_names_from_yaml "$yaml")"
  assert_name_present "$names" e2e
  assert_name_present "$names" infra
  assert_name_absent "$names" no-such-pkg
  echo "ok: literal yaml glob without package.json is skipped"
}

test_extra_gate_dirs_are_unioned() {
  local copy names
  copy="$(mktemp "$TMP/ws-pkg.XXXXXX")"
  sed 's/^EXTRA_GATE_DIRS=""/EXTRA_GATE_DIRS="docs"/' \
    "$SCRIPT_DIR/workspace-packages.sh" > "$copy"
  names="$(GATE_REPO_ROOT="$REPO_ROOT" bash -c \
    'set -euo pipefail; source "$0"; load_workspace_packages; printf "%s\n" "$WORKSPACE_NAMES"' \
    "$copy")"
  assert_name_present "$names" docs
  echo "ok: EXTRA_GATE_DIRS are unioned into the derived set"
}
