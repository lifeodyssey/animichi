# shellcheck shell=bash
# How the staging reset reads its Neon target out of the stack configuration: staging's project
# and branch, and production's branch, which the target must never be. Sourced by
# reset-staging-baseline.sh, which names the two stack files and hands them to `load_target`;
# reset-staging-baseline.stack-config-cases.sh drives it.

# One value of a stack's own configuration, read by js-yaml — the YAML library `infra`
# declares and reads these files with in its tests — so quoting is the parser's business; jq then
# takes a non-empty string or refuses by key and file: unset, a number, a boolean, a `secure:`
# object. The file goes in on stdin because `pnpm exec` runs js-yaml from `infra/`.
yaml_value() {
  local yaml="$1" key="animichi-neon-secrets:$2"
  pnpm --dir "$ROOT/infra" exec js-yaml < "$yaml" \
    | jq -er --arg key "$key" '.config[$key] | select(type == "string" and length > 0)' \
    || fail "refusing reset: $yaml sets no string $key"
}

# `main` calls this as `load_target … || fail`, where `set -e` does not act, and a refusal inside a
# command substitution ends only that subshell, so each read returns on its own. An empty id still
# refuses below: neonctl given no branch falls back to the project's default one.
load_target() { # load_target <staging stack file> <production stack file>
  local production_branch
  PROJECT_ID="$(yaml_value "$1" neonProjectId)" || return 1
  BRANCH_ID="$(yaml_value "$1" neonBranchId)" || return 1
  production_branch="$(yaml_value "$2" neonBranchId)" || return 1
  [[ -n "$PROJECT_ID" && -n "$BRANCH_ID" && -n "$production_branch" ]] || return 1
  [[ "$BRANCH_ID" != "$production_branch" ]] || return 1
}
