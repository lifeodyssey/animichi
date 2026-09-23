#!/usr/bin/env bash
# Migrate one environment through the migrator Worker (CI/CD redesign spec §3.1).
#
# CI never holds a database credential, not even a short-lived one (decision 6):
# the job proves who it is with its own GitHub OIDC token, and the migrator
# Worker — which does hold the DSN — decides whether to apply. The selected
# schema identity is the contract hash inside the release artifact, so the
# Worker applies exactly the graph this run packaged.
#
# C3 (#1365) adds the handshake that closes #1332: `wrangler deploy` returning
# is not the new bundle serving, and the old bundle answering a POST would
# apply a graph this release never packaged. So the identity the Worker reports
# on /healthz is polled until it matches, and the Worker's own `409
# stale_prisma_bundle` — the same fact from the other side — is retried rather
# than failing the release. With one authority there is one identity on both
# sides (#1634).
#
# Usage: MIGRATOR_URL=… migrate-through-worker.sh <environment> [contract-file]
set -euo pipefail

TARGET_ENVIRONMENT="${1:?target environment required}"
CONTRACT_FILE="${2:-release/migrator/bundle/contract.json}"
# shellcheck source=scripts/delivery/migrator-bundle.sh
source "$(dirname "${BASH_SOURCE[0]}")/migrator-bundle.sh"
RESPONSE="${RUNNER_TEMP:-/tmp}/migrate-$TARGET_ENVIRONMENT.json"
# The propagation window: 12 × 5s covers the observed Cloudflare rollout, and
# the tests shrink both so they assert the behaviour, not the wall clock.
BUNDLE_SLEEP="${BUNDLE_POLL_SECONDS:-5}"
STALE_ATTEMPTS="${STALE_BUNDLE_ATTEMPTS:-3}"

fail() { echo "::error title=migration::$*"; exit 1; }
required() { [ -n "${!1:-}" ] || fail "$1 is required for $TARGET_ENVIRONMENT"; }

# Every call below either carries a credential (the OIDC request token, then the
# minted token itself) or decides whether the credential-bearing POST happens, so
# the transport is pinned to TLS. curl refuses a plain-http URL — and a redirect
# that leaves https — instead of sending the token over it (CWE-319).
https_only() { curl --proto '=https' --proto-redir '=https' "$@"; }

# `audience` scopes the token to the migrator alone: the same token is rejected
# by Pulumi Cloud and by every other relying party.
oidc_token() {
  required ACTIONS_ID_TOKEN_REQUEST_URL
  required ACTIONS_ID_TOKEN_REQUEST_TOKEN
  https_only -sSfL -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=animichi:github-actions:migrator" | jq -r .value
}

post_migrate() {
  local token="$1" body="$2"
  https_only -sS -o "$RESPONSE" -w '%{http_code}' -X POST \
    "$MIGRATOR_URL/migrate" -H "Authorization: Bearer $token" \
    -H 'content-type: application/json' --max-time 900 -d "$body"
}

# Only an explicit stale-bundle response permits another mutation request.
stale_bundle_response() {
  [ "$1" = 409 ] && jq -e '.error == "stale_prisma_bundle"' "$RESPONSE" > /dev/null
}

# A bundle can change between the health check and POST; re-poll that race only.
trigger() {
  local token="$1" body="$2" attempt=1 code
  while [ "$attempt" -le "$STALE_ATTEMPTS" ]; do
    await_migrator_bundle "$PRISMA_REF" || fail "migrator never served schema identity $PRISMA_REF"
    code="$(post_migrate "$token" "$body")"
    [ "$code" = 200 ] && return 0
    stale_bundle_response "$code" || report_failure "migrator returned HTTP $code"
    echo "migrator answered 409 $(jq -r .error "$RESPONSE"); re-polling ($attempt/$STALE_ATTEMPTS)"
    attempt=$((attempt + 1))
    sleep "$BUNDLE_SLEEP"
  done
  report_failure "migrator still served a stale bundle after $STALE_ATTEMPTS attempts"
}

verify() {
  jq -e --arg prisma "$PRISMA_REF" '.success == true
    and .prisma.markerHash == $prisma
    and (.prisma.migrationsApplied | type == "number" and . >= 0 and . == floor)' "$RESPONSE" >/dev/null \
    || report_failure "migrator did not apply schema identity $PRISMA_REF"
}

# The response body carries the migrator's own error; discarding it left a
# staging failure reading only "migrator returned HTTP 500" (#1216). This
# repository is public, so any DSN in that body is redacted before it is logged.
# Truncation is a substring, not `| head -c`: past the 64 KiB pipe buffer head
# exits first, sed dies on SIGPIPE, and `set -e` takes the function down before
# `fail` reports anything — losing the message on exactly the large bodies that
# most needed it.
report_failure() {
  local body
  body="$(redact_dsn_passwords "$RESPONSE")"
  echo "migrator response body (credentials redacted):"
  echo "${body:0:4000}"
  fail "$1"
}

# PostgreSQL carries the password in URI user-info (`//user:pw@host`), in a URI
# parameter (`?password=pw`), and in keyword/value DSNs (`password=pw`). Three rules
# cover the shapes a driver prints, and this pass's criterion is "no password" rather
# than the Worker's "no connection string": the role and the endpoint stay, so the
# failure stays diagnosable, and only the secret goes.
#
#   1. URI user-info: `://user:pw@` becomes `://user:***@`. The secret class admits the
#      at-sign this rule is hunting and refuses `/` and `?`, so the engine gives characters
#      back until the last at-sign INSIDE the authority is left standing — the split
#      `new URL` performs, and the reason a later `?opt=a@b.c` cannot drag the match past
#      the endpoint. A class without the at-sign stops at the first one instead, and the
#      secret's tail reaches the log (#1881). The price is a raw `/` or `?` in the secret,
#      which `new URL` rejects as not a URL at all; percent-encoded, it is matched.
#   2. One `password` key bound to one value, over the surfaces it is printed on:
#      `password=pw`, `password: pw`, `password='pw'`, `password="pw"`,
#      `{"password":"pw"}`, the JSON-escaped `password=\"pw\"` (#1887) and a JSON
#      object carried inside a JSON string, `{\"password\":\"pw\"}` (#1905). The
#      escaped surface is what the JSON encoder makes of a quoted assignment carried
#      inside a string — a driver echoing a config line in a response body. This pass
#      redacts whatever body came back, not only the cause `redactedCause` already
#      cleaned, so an assignment arriving escaped is covered here alone. Key and
#      separator are captured and written back unchanged, and the quote closing the key
#      may be plain or escaped; the value's own quotes go with the value, as in the
#      Worker's replacement. A quoted value is matched whole, so `{"password":"pw"}`
#      keeps its closing brace, and a bare one still stops at a space, an `&` or a
#      quote. The escaped branch reads its body one JSON token at a time (#1909): a
#      character that is neither quote nor backslash; a JSON escape of anything other
#      than a quote or a backslash, such as `\/` or `\n`; or an inner-layer escape —
#      two raw backslashes followed by one JSON token. That third unit is the general
#      case of the two the branch used to name separately: an inner `\\` arrives as
#      four backslashes and an inner `\"` as three backslashes and a quote, and both
#      are two raw backslashes plus one token. A lone `\"` matches no unit, so it can
#      only close the value; the trailing unit in front of the closer takes the two raw
#      backslashes of a value ending in an inner backslash, so it stops before the quote
#      that ends the JSON string and `","tail":…` survives with it. A second span
#      behind a closer reaches rule 2 with its key intact — but that closer is optional,
#      so a value whose end never arrived still ends where the units stop instead of
#      falling through to the bare branch, which takes the lone backslash and prints the
#      rest of the secret behind the next quote (#1905). A closed escaped value also stops
#      before a following `;host=`, which the bare branch eats (#1881 gap 4). A value
#      whose closer never arrived has no such boundary and takes it.
#      Where two of the line's `\"` could close the value, the reading that leaves no
#      secret visible wins: a nested `password` assignment's own opener is a body unit
#      too, so the value runs over it and the second secret is swallowed with the first
#      instead of printed behind it (#1912). Without that unit the body stops one
#      character short of the nested opener, the optional closer takes that opener as its
#      own, and the second value reaches the log whole.
#   3. The user-info half with no scheme in front of it, which a driver prints on its
#      own: `user:pw@host.tld/db`. Three gates keep it off ordinary prose — no whitespace
#      anywhere in the pair, a dot required inside the host, and a left boundary so a
#      match cannot start mid-token. The secret may open with at most one `/`; two of them
#      is the `://` of rule 1's own output, and refusing that is what keeps this rule off
#      it, where `postgresql://user:***@host/db` would otherwise read as user `postgresql`
#      and secret `//user:***`.
#
# A secret split across lines survives this pass, and that is a refusal rather than a
# limit: `sed` reads one line at a time, and joining them first is POSIX (`:a`/`N`/`$!ba`).
# Measured, that join closes this gap and lets rule 2's quoted branch run past the line
# that opened it, eating the diagnostic #1868 restored. The migrator's own thrown cause is
# already redacted before it gets here, by `redactedCause`, whose `password` pattern
# uses `\s` and so spans a newline; the two passes are independent, though, so this one
# is not that one's fallback.
#
# Written for BSD and GNU sed alike: no `\b`, no `I` flag, no lookbehind, no `\w` —
# POSIX ERE only, no backreference inside a pattern, and the `s` delimiter `#` never
# inside a bracket expression, which a sed is free to read as the end of the command.
redact_dsn_passwords() {
  sed -E \
    -e "s#://([^:/@[:space:]]+):[^[:space:]/?]+@#://\1:***@#g" \
    -e "s#([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd](\"|\\\\\")?[[:space:]]*[=:][[:space:]]*)(\"[^\"]*\"|'[^']*'|\\\\\"([^\"\\\\]|\\\\[^\"\\\\]|\\\\\\\\([^\"\\\\]|\\\\.)|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd](\"|\\\\\")?[[:space:]]*[=:][[:space:]]*\\\\\")*(\\\\\\\\)?(\\\\\")?|[^[:space:]&\"]+)#\1***#g" \
    -e "s#(^|[^[:alnum:]_:/@])([[:alnum:]_.-]+):/?[^[:space:]/][^[:space:]]*@([[:alnum:]_.-]+\.[[:alnum:]_.-]+)#\1\2:***@\3#g" \
    "$1"
}

main() {
  required MIGRATOR_URL
  local token body
  PRISMA_REF="$(jq -er '.storage.storageHash | select(type == "string" and test("^[a-f0-9]{64}$"))' "$CONTRACT_FILE")"
  body="$(selected_metadata)"
  token="$(oidc_token)"
  echo "migrating $TARGET_ENVIRONMENT to schema identity $PRISMA_REF"
  trigger "$token" "$body"
  verify
  echo "migrator applied $PRISMA_REF"
}

selected_metadata() {
  jq -cn --arg expectedPrismaRef "$PRISMA_REF" '{expectedPrismaRef:$expectedPrismaRef}'
}

main
