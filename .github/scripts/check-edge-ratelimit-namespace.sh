#!/usr/bin/env bash
# Edge deploy-precheck (#680 + Standards finding): the edge worker's
# wrangler.toml [[ratelimits]] namespace_id is a CHOSEN POSITIVE INTEGER
# (per CF docs, not a dashboard/API-provisioned resource). A commit that
# ships the retired placeholder token cannot deploy, so this check FAILS
# CLOSED: it greps workers/edge/wrangler.toml for the placeholder and exits
# non-zero while it is present, making a deploy-blocked PR visibly red in
# the edge build lane instead of silently failing (or silently deploying).
# Choosing real, per-environment integer namespace_ids (distinct so counters
# stay independent) is the fix that turns this check green. The self-test
# keeps injecting the placeholder to prove the fail-closed path. Bash
# 3.2-safe (macOS system bash).
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
" "DEPLOY-BLOCKED: ${EDGE} still carries the retired placeholder ratelimit namespace_id ${PLACEHOLDER}; replace it with a chosen per-environment namespace integer (see the [[ratelimits]] comment) before deploy." >&2
  exit 1
fi

printf "%s
" "check-edge-ratelimit-namespace: ${EDGE} has no placeholder ratelimit namespace_id"
