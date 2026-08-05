#!/usr/bin/env bash
# Resolve the public HTTPS base URL for a deployed component in a given
# environment — for the post-deploy smoke gate (issue #484, hardened by
# #695). This does NOT probe application-layer HTTP to guess whether a URL
# is live; it queries Cloudflare's own account state for what this Worker
# script is ACTUALLY reachable on right now, so the smoke gate always probes
# the real deploy target instead of a hardcoded guess about where it used to
# be (or where we expect it to be someday).
#
# Why "ask Cloudflare" instead of a static component/environment -> URL
# table (the previous version of this script, and the literal
# `animichi-staging.<personal-account>.workers.dev` this replaces, per
# issue #695): a static table is correct only until something it doesn't
# know about changes underneath it — a different Cloudflare account's
# workers.dev subdomain, or (issue #541) a Custom Domain getting attached to
# a Worker that used to answer only on workers.dev. Both are silent
# failures of the worst kind: the OLD address usually keeps answering, so
# the gate reports success while verifying the wrong thing. Querying
# Cloudflare's live Custom-Domain and workers.dev-enablement state for this
# exact Worker script removes the table entirely — there is nothing left to
# go stale, and #541's cutover requires zero edits here: the next run just
# sees the Custom Domain that now exists and uses it.
#
# Resolution order: (1) a Custom Domain attached to the Worker script;
# (2) workers.dev, when enabled; (3) for the root/edge Worker in staging
# only, the zone-routed hostname declared in the environment's committed
# Pulumi stack config (`stagingDomain`) — the root Worker's only staging
# surface is Pulumi's zone routes once #541 step 6 disables workers.dev,
# and reading that config is the same live-source-of-truth principle as
# reading the Worker name from wrangler.toml. Anything left is a loud fail.
#
# Concretely, the previous version of this script hardcoded root/production
# to `https://animichi.com` unconditionally — but per issue #541, that
# hostname has NO DNS record at all today, so that branch was already
# wrong in the opposite direction: it assumed a cutover that hasn't
# happened yet, rather than (as #695 describes) missing one that already
# has. Same defect class either way: a static assumption about where a
# Worker lives, disconnected from Cloudflare's actual state.
#
# Usage: resolve-worker-url.sh <root|web> <staging|production>
# Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment
# (same secrets `wrangler deploy` already needs — one source for one value,
# not two; see issue #484 / PR #493 if revisiting the token-scoping
# question). CLOUDFLARE_API_BASE_URL is an optional override, used ONLY by
# resolve-worker-url.test.sh to point at a local mock instead of the real
# Cloudflare API — production callers never set it and get the real
# https://api.cloudflare.com/client/v4.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
API_BASE="${CLOUDFLARE_API_BASE_URL:-https://api.cloudflare.com/client/v4}"

component="${1:?usage: resolve-worker-url.sh <root|web> <staging|production>}"
environment="${2:?usage: resolve-worker-url.sh <root|web> <staging|production>}"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required to resolve the deployed Worker URL}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required to resolve the deployed Worker URL}"

fail() {
  echo "::error title=resolve-worker-url::$1" >&2
  exit 1
}

# The Worker SCRIPT NAME is still read from this repo's own wrangler config
# (not re-hardcoded here) — that name is a structural identifier fixed at
# deploy time (`wrangler deploy --env <environment>` publishes to exactly
# this script), not a hostname that moves when infra changes. Reading it
# from the same file `wrangler deploy` reads keeps this script from ever
# drifting out of sync with what actually got deployed.
resolve_worker_name() {
  case "${component}" in
    root)
      awk -v want="[env.${environment}]" '
        $0 == want { found=1; next }
        found && /^\[/ { exit }
        found && /^name[[:space:]]*=/ { print; exit }
      ' "${REPO_ROOT}/wrangler.toml" | sed -E 's/^name[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/'
      ;;
    web)
      # wrangler.jsonc comments in this repo are always whole-line (never
      # trailing after a value) — confirmed by reading the file — so
      # stripping `//`-prefixed lines before handing it to jq is safe here.
      grep -v '^[[:space:]]*//' "${REPO_ROOT}/apps/web/wrangler.jsonc" \
        | jq -r --arg env "${environment}" '.env[$env].name // empty'
      ;;
    *)
      fail "unknown component: ${component}"
      ;;
  esac
}

worker_name="$(resolve_worker_name)"
[ -n "${worker_name}" ] || fail "could not resolve a Worker name for ${component}/${environment} from wrangler config"

# Every Cloudflare API v4 response, including a plain HTTP 200, carries its
# own success/errors envelope — `success: false` on a 200 is how CF reports
# an insufficient token scope, a missing resource, etc. `curl --fail-with-body`
# alone only catches TRANSPORT failures (a non-2xx status); it does NOT know
# CF's own envelope shape, so a 200-with-success:false response would sail
# straight through unnoticed. Left unchecked, that response's `result`
# is typically `null` or `[]` — which downstream jq code (`.result[] |
# select(...)`, `.result.enabled // false`) reads as "no Custom Domain" /
# "workers.dev not enabled", not as an error. That is the exact "quietly
# reports a plausible-looking wrong URL" failure mode issue #695 exists to
# remove — just one layer up, in the API call instead of the URL table.
# `cf_get_checked` is the one place that parses `.result` for every caller
# below, so this check cannot be bypassed by a call site forgetting it.
cf_get_checked() {
  local path="$1" purpose="$2" response success errors
  response="$(curl -sS --fail-with-body --connect-timeout 10 --max-time 20 --retry 3 --retry-delay 2 \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "${API_BASE}${path}")" || fail "Cloudflare API call failed (transport error) while trying to ${purpose}"
  success="$(echo "${response}" | jq -r '.success // false' 2>/dev/null)" || fail "Cloudflare API response was not valid JSON while trying to ${purpose}: ${response}"
  if [ "${success}" != "true" ]; then
    errors="$(echo "${response}" | jq -c '.errors // []' 2>/dev/null || echo '(unparseable)')"
    fail "Cloudflare API returned success:false while trying to ${purpose} — errors: ${errors}"
  fi
  echo "${response}"
}

# 1) Ground truth for a Custom Domain (issue #541 hostname cutover): if
# Cloudflare has a Custom Domain attached to this exact Worker script, that
# IS the real deploy target — full stop, no workers.dev fallback needed or
# wanted. This is what makes the cutover need zero changes here: today this
# list is empty for every Worker in this repo (per #541, no DNS/route
# exists yet), so this branch is a no-op until the day it isn't.
#
# Filtered server-side with `?service=<worker_name>` (confirmed as a
# documented query parameter of this endpoint — see
# developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/)
# rather than fetched unfiltered and paginated client-side: filtering at
# the source means there is no page boundary this script could ever fall
# on the wrong side of, which a client-side per_page cap would not
# guarantee no matter how large.
custom_domain_response="$(cf_get_checked \
  "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains?service=${worker_name}" \
  "list Custom Domains for ${worker_name}")"
custom_hostname="$(echo "${custom_domain_response}" \
  | jq -r --arg name "${worker_name}" '[.result[] | select(.service == $name)][0].hostname // empty')"

if [ -n "${custom_hostname}" ]; then
  echo "https://${custom_hostname}"
  exit 0
fi

# 2) No Custom Domain — fall back to workers.dev, but ask Cloudflare
# per-script whether it is actually enabled for THIS Worker (not just
# whether the account has a workers.dev subdomain configured at all — a
# Worker can have workers.dev explicitly disabled, e.g. #541 step 6 does
# exactly this after DNS cutover). Guessing "workers.dev is reachable"
# without checking this would be the same class of stale-address bug this
# script exists to remove.
subdomain_status_response="$(cf_get_checked \
  "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${worker_name}/subdomain" \
  "check workers.dev enablement for ${worker_name}")"
workers_dev_enabled="$(echo "${subdomain_status_response}" | jq -r '.result.enabled // false')"

if [ "${workers_dev_enabled}" = "true" ]; then
  account_subdomain_response="$(cf_get_checked \
    "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain" \
    "fetch the account's workers.dev subdomain")"
  account_subdomain="$(echo "${account_subdomain_response}" | jq -er '.result.subdomain')" || {
    fail "Cloudflare API response did not contain result.subdomain: ${account_subdomain_response}"
  }

  echo "https://${worker_name}.${account_subdomain}.workers.dev"
  exit 0
fi

# 3) No Custom Domain AND workers.dev disabled: a Worker with no reachable
#    URL is normally a real deploy problem (fail loudly below) — EXCEPT the
#    root/edge Worker in staging, whose surface is the ZONE ROUTES Pulumi
#    declares under the staging hostname ("routes belong to Pulumi": the
#    root wrangler config deliberately declares none, #541). That hostname
#    is committed in the environment's Pulumi stack config — read it from
#    the same file Pulumi builds the routes from, the same "live source of
#    truth" principle as reading the Worker name from wrangler.toml above
#    (issue #695): the config only changes through a PR, so it cannot go
#    stale behind this script. Production is deliberately NOT in scope
#    here: prod's `webDomain` still has no DNS record (#541), so resolving
#    it would just re-introduce the hardcoded animichi.com assumption this
#    script's header says was removed. Non-root components skip this and
#    fail loudly below.
if [ "${component}" = "root" ] && [ "${environment}" = "staging" ]; then
  pulumi_stack="infra/Pulumi.staging.yaml"
  routed_hostname="$(grep -E "^[[:space:]]+seichijunrei-infra:stagingDomain:" "${REPO_ROOT}/${pulumi_stack}" 2>/dev/null \
    | sed -E "s/^[[:space:]]+seichijunrei-infra:stagingDomain:[[:space:]]*//" | tr -d '[:space:]')"
  if [ -n "${routed_hostname}" ]; then
    echo "https://${routed_hostname}"
    exit 0
  fi
fi

fail "${worker_name} (${component}/${environment}) has neither a Custom Domain nor workers.dev enabled — there is no reachable URL for the post-deploy smoke gate to probe. If a Custom Domain cutover just happened, this is expected right up until Cloudflare's Custom Domain is actually attached; if not, this Worker is unreachable and that is itself a real deploy problem."
