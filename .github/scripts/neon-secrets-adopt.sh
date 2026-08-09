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
# Why --file imports with an explicit provider (not `pulumi import` args):
#   - `pulumi import` never runs the stack program, so the program's
#     `new neon.Provider("neon", {apiKey: config.requireSecret("neonApiKey")})`
#     is never constructed. The committed neonApiKey config secret therefore
#     does NOT authenticate an import; the neon provider must be given its key
#     explicitly. We inject it via the import file's `providerInputs` map,
#     fed from the NEON_API_KEY env var (the same value the #926 run used).
#   - The imported resources must bind to the EXACT provider URNs the program
#     will construct on the next `up`, or the `up` would REPLACE them
#     (create-before-delete -> Neon rejects the duplicate role create -> the
#     first CI deploy hard-fails, the exact failure adoption exists to avoid).
#     Neon roles bind to the program's NAMED provider
#     (urn:pulumi:<stack>::animichi-neon-secrets::pulumi:providers:neon::neon)
#     via the file's nameTable + providerInputs (which also carries the
#     bridged provider's name/version/parameterization from the generated SDK
#     so the engine can load it). The Secrets Store secrets bind to the
#     package DEFAULT provider (default_6_19_0) by pinning the entry `version`
#     to the @pulumi/cloudflare version the lockfile resolves — the same
#     version the program's default provider gets named with on `up`.
#   - Secrets Store secret import IDs are `<accountId>/<storeId>/<uuid>` (the
#     provider rejects bare UUIDs); the UUIDs come from the #926 file-backend
#     stack export (staging.json, resource
#     `cloudflare:index/secretsStoreSecret:SecretsStoreSecret`). They are
#     stable store item identifiers, not secrets themselves; if the store
#     items are ever deleted and recreated, these IDs must be refreshed from a
#     `pulumi stack export` of a working stack (or from `pulumi import`'s
#     error output). Roles' import IDs are `<projectId>/<branchId>/<roleName>`
#     (projectId/branchId are read from the committed stack config, never
#     hardcoded).

set -euo pipefail

stack="${PULUMI_STACK:-$(pulumi stack --show-name 2>/dev/null || echo staging)}"
export PULUMI_STACK="$stack"

sdk_json="sdks/neon/package.json"
if [ ! -f "$sdk_json" ]; then
  echo "::error::$sdk_json not found — the 'Generate Neon provider SDK' step must run before this script." >&2
  exit 1
fi

# <type>|<name>|<id>
# SecretsStoreSecret ids: from the #926 file-backend stack export
# (/Users/lumimamini/work/neon-secrets-state/.pulumi/stacks/
# animichi-neon-secrets/staging.json).
RESOURCES=(
  "neon:index/role:Role|catalog_svc|<projectId>/<branchId>/catalog_svc"
  "neon:index/role:Role|users_svc|<projectId>/<branchId>/users_svc"
  "neon:index/role:Role|jobs_svc|<projectId>/<branchId>/jobs_svc"
  "neon:index/role:Role|agent_svc|<projectId>/<branchId>/agent_svc"
  "cloudflare:index/secretsStoreSecret:SecretsStoreSecret|CATALOG_DATABASE_URL|<accountId>/<storeId>/e14b4f8b8c7e4fe485807921d952cb1a"
  "cloudflare:index/secretsStoreSecret:SecretsStoreSecret|USERS_DATABASE_URL|<accountId>/<storeId>/891fd7994212451a8483e67adc09426a"
  "cloudflare:index/secretsStoreSecret:SecretsStoreSecret|AGENT_DATABASE_URL|<accountId>/<storeId>/c331e43e26a740579767f6b775676858"
)

project_id="$(pulumi config get animichi-neon-secrets:neonProjectId)"
branch_id="$(pulumi config get animichi-neon-secrets:neonBranchId)"
account_id="$(pulumi config get animichi-neon-secrets:cloudflareAccountId)"
store_id="$(pulumi config get animichi-neon-secrets:secretsStoreId)"

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

if [ -z "${NEON_API_KEY:-}" ]; then
  echo "::error::NEON_API_KEY not set — the neon provider authenticates with it during adoption (pulumi import does not run the stack program, so the committed neonApiKey config secret does not apply; the import injects this key as the provider's apiKey input)." >&2
  exit 1
fi

import_file="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/neon-secrets-import.json"

# Emit an import file for one resource. The neon provider's name/version/
# parameterization come from the generated SDK's package.json (same source
# the program uses at `up` time), and the cloudflare version from the
# lockfile the program resolves — keeping the import-bound provider URNs
# identical to what the next `pulumi up` constructs.
emit_import_file() {
  local type="$1" name="$2" id="$3"
  NEON_API_KEY="$NEON_API_KEY" python3 - "$type" "$name" "$id" >"$import_file" <<'PY'
import json, os, re, sys

kind, name, rid = sys.argv[1], sys.argv[2], sys.argv[3]
stack = os.environ["PULUMI_STACK"]

def secret(value):
    return {"4dabf18193072939515e22adb298388d": "1b47061264138c4ac30d75fd1eb44270",
            "plaintext": json.dumps(value)}

def read_sdk():
    d = json.load(open("sdks/neon/package.json"))["pulumi"]
    return {
        "plugin_name": d["name"],
        "plugin_version": d["version"],
        "package_version": d["parameterization"]["version"],
        "parameterization_value": d["parameterization"]["value"],
    }

def read_cloudflare_version():
    lock = open("pnpm-lock.yaml").read()
    match = re.search(r"@pulumi/cloudflare':\s*\n(?:[^\n]*\n)*?\s*version: ([\d.]+)\(?",
                      lock)
    if not match:
        raise SystemExit("could not parse @pulumi/cloudflare version from pnpm-lock.yaml")
    return match.group(1)

spec = {"type": kind, "name": name, "id": rid}
if kind.startswith("cloudflare:"):
    spec["version"] = read_cloudflare_version()
    file = {"resources": [spec]}
else:
    sdk = read_sdk()
    spec["provider"] = "neon"
    file = {
        "nameTable": {"neon": "urn:pulumi:%s::animichi-neon-secrets::pulumi:providers:neon::neon" % stack},
        "providerInputs": {"neon": {
            "apiKey": secret(os.environ["NEON_API_KEY"]),
            "version": sdk["package_version"],
            "__internal": {
                "name": sdk["plugin_name"],
                "version": sdk["plugin_version"],
                "parameterization": sdk["parameterization_value"],
            },
        }},
        "resources": [spec],
    }
json.dump(file, sys.stdout)
PY
}

imported=0
for entry in "${RESOURCES[@]}"; do
  IFS='|' read -r type name id_template <<<"$entry"
  id="${id_template//<projectId>/$project_id}"
  id="${id//<branchId>/$branch_id}"
  id="${id//<accountId>/$account_id}"
  id="${id//<storeId>/$store_id}"
  if state_names | grep -qx "$name"; then
    echo "neon-secrets: $name already in state — skipping import."
    continue
  fi
  echo "neon-secrets: importing $name ($type, id=$id)"
  emit_import_file "$type" "$name" "$id"
  pulumi import --file "$import_file" --yes
  imported=$((imported + 1))
done

if [ "$imported" -eq 0 ]; then
  echo "neon-secrets: no imports needed."
else
  echo "neon-secrets: imported $imported resource(s); the following 'pulumi up' will be a no-change apply."
fi
