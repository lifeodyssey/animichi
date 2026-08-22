#!/usr/bin/env bash
# Put Worker secrets via `wrangler secret put`. Root's config lives at
# workers/edge/wrangler.toml while cwd stays the repo root (#853), so this
# helper always passes `-c` for component=root. wrangler-action's
# uploadSecrets() cannot inherit that flag from `command` (#1150).
#
# Values are read from the environment by name and piped on stdin — never
# argv — matching the existing post-deploy `secret put` step.
#
# Usage (CI): SECRET_NAMES, TARGET_COMPONENT, TARGET_ENVIRONMENT in env.
# EMPTY_POLICY=fail (required worker secrets) or skip (post-deploy, after
# preflight). WRANGLER_BIN is a test override; production callers omit it.
set -euo pipefail

: "${TARGET_COMPONENT:?TARGET_COMPONENT is required}"
: "${TARGET_ENVIRONMENT:?TARGET_ENVIRONMENT is required}"
: "${SECRET_NAMES:?SECRET_NAMES is required}"

EMPTY_POLICY="${EMPTY_POLICY:-fail}"
ROOT_CONFIG="workers/edge/wrangler.toml"

fail() {
  echo "::error title=wrangler-secret-put::$1" >&2
  exit 1
}

trim_name() {
  local name="$1"
  name="${name//$'\r'/}"
  name="${name#"${name%%[![:space:]]*}"}"
  name="${name%"${name##*[![:space:]]}"}"
  printf '%s' "$name"
}

run_wrangler() {
  if [[ -n "${WRANGLER_BIN:-}" ]]; then
    "${WRANGLER_BIN}" "$@"
    return
  fi
  pnpm exec wrangler "$@"
}

put_one() {
  local name="$1" value="$2"
  local extra=()
  [[ "$TARGET_COMPONENT" = "root" ]] && extra=(-c "${ROOT_CONFIG}")
  printf '%s' "$value" | run_wrangler secret put "$name" "${extra[@]}" \
    --env "$TARGET_ENVIRONMENT"
}

handle_empty() {
  local name="$1"
  if [[ "$EMPTY_POLICY" = "skip" ]]; then
    echo "::warning::$name is empty/unset for component=$TARGET_COMPONENT, environment=$TARGET_ENVIRONMENT — skipping the push."
    return 0
  fi
  fail "$name is empty/unset for component=$TARGET_COMPONENT, environment=$TARGET_ENVIRONMENT. Refusing to push an empty Worker secret."
}

if [[ "$EMPTY_POLICY" != "fail" ]] && [[ "$EMPTY_POLICY" != "skip" ]]; then
  fail "EMPTY_POLICY must be fail or skip, got '$EMPTY_POLICY'"
fi

while IFS= read -r raw || [[ -n "$raw" ]]; do
  name="$(trim_name "$raw")"
  [[ -z "$name" ]] && continue
  if ! [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
    fail "invalid secret name '$name' (expected ^[A-Z][A-Z0-9_]*$)"
  fi
  value="${!name-}"
  if [[ -z "$value" ]]; then
    handle_empty "$name"
    continue
  fi
  put_one "$name" "$value"
done <<< "$SECRET_NAMES"
