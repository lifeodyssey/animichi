#!/usr/bin/env bash
# One-shot #1077 import: DIY R2 stacks → Pulumi Cloud (service secrets).
# Must run logged into Pulumi Cloud (PULUMI_ACCESS_TOKEN from auth-actions)
# with the source URL passed as $1. Does not print the source URL.
set -euo pipefail

source_url="${1:?source DIY backend URL required}"
org="lifeodyssey"
# Stay on the Cloud backend even if the caller exported PULUMI_BACKEND_URL.
unset PULUMI_BACKEND_URL

migrate_one() {
  local workdir="$1"
  local stack="$2"
  local project="$3"
  local target="${org}/${project}/${stack}"
  echo "migrate ${project}/${stack} -> ${target}"
  (
    cd "$workdir"
    pulumi stack migrate "$source_url" "$stack" \
      --target "$target" \
      --secrets-provider default \
      --yes
  )
}

root="$(git rev-parse --show-toplevel)"
migrate_one "${root}/infra" staging seichijunrei-infra
migrate_one "${root}/infra/neon-secrets" staging animichi-neon-secrets
if ! migrate_one "${root}/infra/neon-secrets" prod animichi-neon-secrets; then
  echo "::warning::neon-secrets prod was not on the DIY backend; skip."
fi
