#!/usr/bin/env bash
# One-time adoption of the live resources the #926 local file-backend run
# created, into the CI R2 state backend (reusable-deploy-neon-secrets.yml).
#
# Why this exists: the #926 validation ran `pulumi up` against a LOCAL
# `file://` backend (/Users/lumimamini/work/neon-secrets-state). The Neon
# roles and the three Secrets Store secrets it created are live in staging
# today, but the R2 state backend CI uses has never seen them. A plain first
# `pulumi up` on the R2 backend would try to CREATE them again — the Neon API
# rejects a duplicate role create, so the first CI run would hard-fail.
# Adoption imports the existing resources by ID instead, so the first CI
# `pulumi up` is a no-change apply (the #926 run was verified idempotent).
#
# Idempotent: on a rerun after a partial import, resources already present in
# state are skipped. Safe to run on every deploy; it exits 0 immediately once
# the stack owns its neon roles (i.e. adoption is complete).
#
# URNs/IDs: roles' import IDs are `<projectId>/<branchId>/<roleName>`
# (projectId/branchId are read from the committed stack config, never
# hardcoded). The Secrets Store secrets' import IDs are the store-item UUIDs
# recorded in the #926 file-backend stack export (staging.json, resource
# `cloudflare:index/secretsStoreSecret:SecretsStoreSecret`) — they are stable
# store item identifiers, not secrets themselves; if the store items are ever
# deleted and recreated, these IDs must be refreshed from a `pulumi stack
# export` of a working stack (or from `pulumi import`'s error output).

set -euo pipefail

# <type>|<name>|<id>
# SecretsStoreSecret ids: from the #926 file-backend stack export
# (/Users/lumimamini/work/neon-secrets-state/.pulumi/stacks/
# animichi-neon-secrets/staging.json).
RESOURCES=(
  "neon:index/role:Role|catalog_svc|<projectId>/<branchId>/catalog_svc"
  "neon:index/role:Role|users_svc|<projectId>/<branchId>/users_svc"
  "neon:index/role:Role|jobs_svc|<projectId>/<branchId>/jobs_svc"
  "neon:index/role:Role|agent_svc|<projectId>/<branchId>/agent_svc"
  "cloudflare:index/secretsStoreSecret:SecretsStoreSecret|CATALOG_DATABASE_URL|e14b4f8b8c7e4fe485807921d952cb1a"
  "cloudflare:index/secretsStoreSecret:SecretsStoreSecret|USERS_DATABASE_URL|891fd7994212451a8483e67adc09426a"
  "cloudflare:index/secretsStoreSecret:SecretsStoreSecret|AGENT_DATABASE_URL|c331e43e26a740579767f6b775676858"
)

project_id="$(pulumi config get animichi-neon-secrets:neonProjectId)"
branch_id="$(pulumi config get animichi-neon-secrets:neonBranchId)"

# Names of the resources already owned by the current stack state.
state_names() {
  pulumi stack export | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)
resources = data.get("deployment", {}).get("resources", [])
for r in resources:
    urn = r.get("urn", "")
    name = urn.rsplit("::", 1)[-1] if "::" in urn else ""
    if name:
        print(name)
'
}

# If the stack already owns any neon role, adoption is complete — every
# resource here was created by the same #926 run and imports atomically.
if state_names | grep -qx 'catalog_svc'; then
  echo "neon-secrets: stack already owns its neon roles — adoption complete, nothing to do."
  exit 0
fi

imported=0
for entry in "${RESOURCES[@]}"; do
  IFS='|' read -r type name id_template <<<"$entry"
  id="${id_template//<projectId>/$project_id}"
  id="${id//<branchId>/$branch_id}"
  if state_names | grep -qx "$name"; then
    echo "neon-secrets: $name already in state — skipping import."
    continue
  fi
  echo "neon-secrets: importing $name ($type, id=$id)"
  pulumi import "$type" "$name" "$id" --yes
  imported=$((imported + 1))
done

if [ "$imported" -eq 0 ]; then
  echo "neon-secrets: no imports needed."
else
  echo "neon-secrets: imported $imported resource(s); the following 'pulumi up' will be a no-change apply."
fi
