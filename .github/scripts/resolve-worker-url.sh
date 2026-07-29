#!/usr/bin/env bash
# Resolve the public HTTPS base URL for a deployed component in a given
# environment. This does NOT probe the network to guess whether a URL is
# live — it derives the URL from the Worker naming convention fixed in
# wrangler.toml / apps/web/wrangler.jsonc, plus the account's workers.dev
# subdomain (an account-level Cloudflare API property, independent of
# whether any particular Worker has been deployed yet). See issue #484.
#
# Usage: resolve-worker-url.sh <root|web> <staging|production>
# Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment,
# except for root/production which resolves to the static custom domain
# (wrangler.toml env.production.routes) and needs neither. Only
# CLOUDFLARE_API_TOKEN is treated as sensitive here (a bare least-privilege
# read of GET .../workers/subdomain, distinct from the deploy-scoped token
# `wrangler deploy` uses elsewhere in this repo's CI); CLOUDFLARE_ACCOUNT_ID
# is not a credential and is sourced from a repository VARIABLE by the
# callers of this script, not a secret.
set -euo pipefail

component="${1:?usage: resolve-worker-url.sh <root|web> <staging|production>}"
environment="${2:?usage: resolve-worker-url.sh <root|web> <staging|production>}"

if [ "${component}" = "root" ] && [ "${environment}" = "production" ]; then
  # wrangler.toml [env.production] routes — custom domain, no workers.dev.
  echo "https://animichi.com"
  exit 0
fi

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required to resolve the workers.dev subdomain}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required to resolve the workers.dev subdomain}"

case "${component}.${environment}" in
  root.staging) worker_name="animichi-staging" ;;      # wrangler.toml [env.staging] name, workers_dev = true
  web.staging) worker_name="animichi-web-staging" ;;   # apps/web/wrangler.jsonc env.staging.name
  web.production) worker_name="animichi-web" ;;        # apps/web/wrangler.jsonc env.production.name
  *)
    echo "::error title=resolve-worker-url::unknown component/environment pair: ${component}/${environment}" >&2
    exit 1
    ;;
esac

response="$(curl -sS --fail-with-body --connect-timeout 10 --max-time 20 --retry 3 --retry-delay 2 \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain")" || {
  echo "::error title=resolve-worker-url::Cloudflare API call to fetch the account's workers.dev subdomain failed" >&2
  exit 1
}

subdomain="$(echo "${response}" | jq -er '.result.subdomain')" || {
  echo "::error title=resolve-worker-url::Cloudflare API response did not contain result.subdomain: ${response}" >&2
  exit 1
}

echo "https://${worker_name}.${subdomain}.workers.dev"
