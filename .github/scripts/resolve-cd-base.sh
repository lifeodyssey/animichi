#!/usr/bin/env bash
set -euo pipefail

EVENT_BEFORE="${1:?event before required}"
SOURCE_SHA="${2:?source SHA required}"
SHA_RE='^[0-9a-f]{40}$'

[[ "$SOURCE_SHA" =~ $SHA_RE ]] || { echo "resolve-cd-base: invalid source SHA" >&2; exit 2; }
current_main="$(gh api "repos/${GITHUB_REPOSITORY:?}/git/ref/heads/main" --jq '.object.sha')"
[[ "$current_main" =~ $SHA_RE ]] || { echo "resolve-cd-base: invalid current main SHA" >&2; exit 2; }
[ "$SOURCE_SHA" = "$current_main" ] || {
  echo "resolve-cd-base: refusing stale run for $SOURCE_SHA; current main is $current_main" >&2
  exit 1
}
runs="$(gh api "repos/${GITHUB_REPOSITORY:?}/actions/workflows/cd.yml/runs?branch=main&status=success&per_page=20" --jq '.workflow_runs[].head_sha')"

while IFS= read -r candidate; do
  if [[ "$candidate" =~ $SHA_RE ]] && [ "$candidate" != "$SOURCE_SHA" ] && \
      git merge-base --is-ancestor "$candidate" "$SOURCE_SHA"; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done <<< "$runs"

if [[ "$EVENT_BEFORE" =~ $SHA_RE ]] && [[ ! "$EVENT_BEFORE" =~ ^0+$ ]] && \
    git merge-base --is-ancestor "$EVENT_BEFORE" "$SOURCE_SHA"; then
  printf '%s\n' "$EVENT_BEFORE"
  exit 0
fi
git rev-list --max-parents=0 "$SOURCE_SHA" | tail -n 1
