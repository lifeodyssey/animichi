#!/usr/bin/env bash
# Resolve the environment's EDGE_SHOWCASE_MODE from the same wrangler.toml
# `wrangler deploy --env <environment>` publishes from (S0-v2 GOAL C / C9).
# The post-deploy smoke probes (post-deploy-assert.sh) need to know which
# contract to assert — the showcase denial (403 showcase_denied) or the
# classic one (401/200) — and the answer must come from the deployed config,
# not a duplicated constant.
#
# The value lives in the environment's [env.<environment>.vars] block, NOT
# the bare [env.<environment>] block (which holds `name =` and deploy
# settings). A parser that slices [env.production] and stops at the next
# section header exits at the [env.production.vars] header and finds
# nothing — the exact bug the previous inline awk in
# reusable-post-deploy-test.yml shipped (it sliced `[env.${ENVIRONMENT}]`),
# and the reason this logic is a real script now: inline in YAML nothing
# could test it; post-deploy-assert-probes.test.sh pins this script against
# the real repo wrangler.toml.
#
# Fail-closed contract (mirrors workers/edge/proxy/showcase.ts): only the literal
# "true" or "false" is accepted; anything else — a missing key, a blank
# value, "TRUE"/"1", a section that does not exist — exits 1 with a loud
# diagnostic, so a deploy config that lost or corrupted the key fails the
# post-deploy smoke BEFORE any probe runs, instead of the probes guessing
# which contract to assert.
#
# Usage: edge-showcase-mode.sh <path-to-wrangler.toml> <staging|production>
set -euo pipefail

toml="${1:?usage: edge-showcase-mode.sh <path-to-wrangler.toml> <staging|production>}"
environment="${2:?usage: edge-showcase-mode.sh <path-to-wrangler.toml> <staging|production>}"

# Anchored to a full section-header line, so a `[env.<environment>]` block
# earlier in the file (whose header is a strict prefix of this one) can
# never start the slice; the slice ends at the NEXT section header.
want="[env.${environment}.vars]"
value="$(awk -v want="${want}" '
  $0 == want { found=1; next }
  found && /^\[/ { exit }
  found && /^EDGE_SHOWCASE_MODE[[:space:]]*=/ { print; exit }
' "${toml}" | sed -E 's/^EDGE_SHOWCASE_MODE[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/')"

case "${value}" in
  true|false)
    echo "${value}"
    ;;
  *)
    echo "::error title=edge-showcase-mode::EDGE_SHOWCASE_MODE for ${environment} must be the literal \"true\" or \"false\" in ${toml} (got: '${value}') — the post-deploy probes cannot know which contract to assert" >&2
    exit 1
    ;;
esac
