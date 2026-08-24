#!/usr/bin/env bash
set -euo pipefail

event_name="${1:?event name is required}"
base_sha="${2:?base SHA is required}"
head_sha="${3:?head SHA is required}"
sha_pattern='^[0-9a-f]{40}$'

[[ "$base_sha" =~ $sha_pattern ]] || { echo "invalid base SHA" >&2; exit 2; }
[[ "$head_sha" =~ $sha_pattern ]] || { echo "invalid head SHA" >&2; exit 2; }
git cat-file -e "$base_sha^{commit}"
git cat-file -e "$head_sha^{commit}"

case "$event_name" in
  pull_request)
    merge_base="$(git merge-base "$base_sha" "$head_sha")"
    printf '%s..%s\n' "$merge_base" "$head_sha"
    ;;
  merge_group)
    git merge-base --is-ancestor "$base_sha" "$head_sha" \
      || { echo "merge-group base is not an ancestor of head" >&2; exit 1; }
    printf '%s..%s\n' "$base_sha" "$head_sha"
    ;;
  *)
    echo "unsupported secret-scan event: $event_name" >&2
    exit 2
    ;;
esac
