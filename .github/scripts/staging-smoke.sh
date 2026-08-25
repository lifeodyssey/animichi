#!/usr/bin/env bash
# Prove the staging cohort serves a page before it may be promoted to production.
#
# "Deployed" is not "serving". The cohort that took staging down answered
# {"status":500,"unhandled":true,"message":"HTTPError"} to every request — static
# assets included, because a Nitro Worker routes those through its own fetch
# handler — and the gate that stood here recorded the SHA with `echo` and waved it
# on to the production approval. A deployed-but-dead Worker must not be
# promotable.
#
# This needs no browser. The staging hostname is a real SSR surface, so `curl` for
# a rendered `<main>` is the whole test, and `infra/src/staging.ts` already turns
# Browser Integrity Check and the Security Level challenge off for that host
# precisely so CI is not challenged. Protection there is the access gate instead:
# an allowlisted source IP, the `animichi_staging` cookie, or the `x-staging-key`
# header. GitHub's egress IPs are dynamic, so the header is CI's door.
set -euo pipefail

ORIGIN="${STAGING_ORIGIN:-}"
GATE_TOKEN="${STAGING_GATE_TOKEN:-}"
ATTEMPTS="${STAGING_SMOKE_ATTEMPTS:-6}"
DELAY_SECONDS="${STAGING_SMOKE_DELAY_SECONDS:-10}"

[ -n "$ORIGIN" ] || { echo "staging-smoke: STAGING_ORIGIN is unset" >&2; exit 1; }
ORIGIN="${ORIGIN%/}"

CURL_ARGS=(--silent --show-error --location --max-time 30)
# Absent token: still probe. If the access gate is armed the request comes back
# 403 and this fails, which is the report we want — never a silent skip.
[ -z "$GATE_TOKEN" ] || CURL_ARGS+=(--header "x-staging-key: $GATE_TOKEN")

# `$1` path, `$2` required body marker (empty = status only).
check_route() {
  local path="$1" marker="$2" body status
  body="$(mktemp)"
  status="$(curl "${CURL_ARGS[@]}" --output "$body" --write-out '%{http_code}' "$ORIGIN$path" || echo 000)"
  if [ "$status" = 200 ] && { [ -z "$marker" ] || grep -qF -- "$marker" "$body"; }; then
    rm -f "$body"
    return 0
  fi
  printf 'staging-smoke: GET %s%s -> %s\n%s\n' "$ORIGIN" "$path" "$status" "$(head -c 400 "$body")" >&2
  rm -f "$body"
  return 1
}

# `<main>` only exists once the route tree rendered on the server; a Worker that
# boots but cannot run a route still answers 200 from the asset binding alone.
smoke_cohort() {
  check_route / '<main' && check_route /chat ''
}

for attempt in $(seq 1 "$ATTEMPTS"); do
  if smoke_cohort; then
    echo "staging-smoke: $ORIGIN serves a rendered document (attempt $attempt/$ATTEMPTS)"
    exit 0
  fi
  [ "$attempt" -eq "$ATTEMPTS" ] || sleep "$DELAY_SECONDS"
done

echo "staging-smoke: $ORIGIN never served a rendered document; refusing to promote" >&2
exit 1
