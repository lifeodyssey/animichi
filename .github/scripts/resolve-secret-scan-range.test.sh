#!/usr/bin/env bash
set -euo pipefail

RESOLVER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/resolve-secret-scan-range.sh"
REPO="$(mktemp -d)"
trap 'rm -rf "$REPO"' EXIT

git -C "$REPO" init -q -b main
git -C "$REPO" config user.email ci@example.invalid
git -C "$REPO" config user.name CI

commit_file() {
  local name="$1"
  printf '%s\n' "$name" > "$REPO/$name"
  git -C "$REPO" add "$name"
  git -C "$REPO" commit -qm "$name"
  git -C "$REPO" rev-parse HEAD
}

root="$(commit_file root)"
git -C "$REPO" switch -qc feature "$root"
feature_one="$(commit_file feature-one)"
git -C "$REPO" switch -qc side "$feature_one"
side="$(commit_file side-secret)"
git -C "$REPO" switch -q feature
feature_two="$(commit_file feature-two)"
git -C "$REPO" merge -q --no-ff side -m merge-side
feature_head="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" switch -q main
pr_base="$(commit_file main-advanced)"

pr_range="$(cd "$REPO" && bash "$RESOLVER" pull_request "$pr_base" "$feature_head")"
[ "$pr_range" = "$root..$feature_head" ] || { echo "wrong PR range: $pr_range" >&2; exit 1; }
git -C "$REPO" rev-list "$pr_range" | grep -qx "$side"
git -C "$REPO" rev-list "$pr_range" | grep -qx "$feature_two"

git -C "$REPO" switch -qc queue "$pr_base"
queue_head="$(commit_file queued-pr)"
queue_range="$(cd "$REPO" && bash "$RESOLVER" merge_group "$pr_base" "$queue_head")"
[ "$queue_range" = "$pr_base..$queue_head" ] || { echo "wrong queue range: $queue_range" >&2; exit 1; }

if (cd "$REPO" && bash "$RESOLVER" merge_group "$feature_head" "$queue_head") >/dev/null 2>&1; then
  echo "merge_group accepted a non-ancestor base" >&2
  exit 1
fi
if (cd "$REPO" && bash "$RESOLVER" pull_request not-a-sha "$queue_head") >/dev/null 2>&1; then
  echo "resolver accepted an invalid SHA" >&2
  exit 1
fi

echo "Secret scan range behavior: PR merge-base, complete side history, and queue ancestry pass"
