#!/usr/bin/env bash
# Mint a GitHub Actions OIDC token for audience $1 into $2. Re-run to refresh.
set -euo pipefail
audience="${1:?audience required}"
outfile="${2:?outfile required}"
curl -sSfL -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?}" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL:?}&audience=${audience}" \
  | jq -er .value > "$outfile"
