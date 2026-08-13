#!/usr/bin/env bash
# Edge deploy-precheck (#680 + Standards finding): the edge worker's
# wrangler.toml [[ratelimits]] binding requires an OPERATOR-PROVISIONED
# Cloudflare ratelimit namespace_id. A commit that ships the placeholder
# token cannot deploy. This check FAILS CLOSED: it greps workers/edge/
# wrangler.toml for the placeholder and exits non-zero while it is present,
# so a deploy-blocked PR is visibly red in the edge build lane instead of
# silently failing (or silently deploying) at deploy time. Provisioning the
# real namespace id at deploy time is a separate HITL operator step; this
# check only surfaces the blocker early. Bash 3.2-safe (macOS system bash).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
EDGE="workers/edge/wrangler.toml"
PLACEHOLDER="REPLACE_WITH_OPERATOR_PROVISIONED_RATELIMIT_NAMESPACE_ID"

file="${ROOT}/${EDGE}"
if [ ! -f "${file}" ]; then
  printf "%s
" "check-edge-ratelimit-namespace: ${EDGE} not found (${file})" >&2
  exit 1
fi

if grep -qF "${PLACEHOLDER}" "${file}"; then
  printf "%s
" "DEPLOY-BLOCKED: ${EDGE} still carries the placeholder ratelimit namespace_id ${PLACEHOLDER}; probe the operator to provision the real Cloudflare ratelimit namespace before deploy." >&2
  exit 1
fi

printf "%s
" "check-edge-ratelimit-namespace: ${EDGE} has no placeholder ratelimit namespace_id"
