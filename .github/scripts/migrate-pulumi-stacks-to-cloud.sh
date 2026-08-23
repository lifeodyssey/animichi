#!/usr/bin/env bash
# One-shot #1077 import: DIY R2 stacks → Pulumi Cloud (service secrets).
# Must run logged into Pulumi Cloud (PULUMI_ACCESS_TOKEN from auth-actions)
# with the source URL passed as $1. Does not print the source URL.
set -euo pipefail

source_url="${1:?source DIY backend URL required}"
org="lifeodyssey"
# Stay on the Cloud backend even if the caller exported PULUMI_BACKEND_URL.
unset PULUMI_BACKEND_URL

stack_missing() {
  grep -qiE 'no stack named|could not find stack|unknown stack' <<<"$1"
}

migrate_one() {
  local workdir="$1"
  local stack="$2"
  local project="$3"
  local target="${org}/${project}/${stack}"
  local err
  echo "migrate ${project}/${stack} -> ${target}"
  if err="$(
    cd "$workdir"
    pulumi stack migrate "$source_url" "$stack" \
      --target "$target" \
      --secrets-provider default \
      --yes 2>&1
  )"; then
    echo "$err"
    return 0
  fi
  echo "$err"
  stack_missing "$err" && return 2
  return 1
}

root="$(git rev-parse --show-toplevel)"
migrate_one "${root}/infra" staging seichijunrei-infra
migrate_one "${root}/infra/neon-secrets" staging animichi-neon-secrets
rc=0
migrate_one "${root}/infra/neon-secrets" prod animichi-neon-secrets || rc=$?
if [ "$rc" -eq 2 ]; then
  echo "::warning::neon-secrets prod was not on the DIY backend; skip."
elif [ "$rc" -ne 0 ]; then
  exit "$rc"
fi
