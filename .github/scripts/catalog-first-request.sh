#!/usr/bin/env bash
# The staging CD's measure of catalog's first database request after a deploy. Catalog loads
# Prisma on its first database request rather than at startup (#2119), so the new version's first
# request pays for that load, and only a request to the deployed Worker shows what it costs there.
# cd.yml runs this right after the smoke, which reaches nothing in catalog: it reads the API
# Worker's own `/healthz` and the web shell, whose server render fetches nothing. The first request
# below is therefore the deployed catalog's first.
#
# One cold request, then one warm one, each a curl process of its own, so both pay the same
# connection setup and their difference approximates the first load. Neither is retried: a retry
# would hide the very failure this exists to record. Both timings are in the log before either
# answer is judged, so a failed request still leaves its number behind.
#
# Staging's catalog answers this route with a `Server-Timing` header that splits its own share of
# the time: the database connect, the query and catalog's total, in milliseconds
# (`workers/catalog/src/server-timing.ts`). Each answer's value goes to the log on a line of its own
# beside its timing, `none` when it carried none, and decides nothing.
#
# No `limit` query: catalog reads a query value as a string and the contract's `limit` is a number,
# so `?limit=1` answers 400. The route's own default answers 200.
set -euo pipefail

ORIGIN="${1:?staging edge origin required}"
ROUTE="/catalog/public/popular"
TITLE="catalog first database request"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ACCESS_HEADERS=()
TOTALS=()
FAILURES=()

fail() { echo "::error title=$TITLE::$*"; exit 1; }

# The host of a URL, as `staging-smoke-check.sh` reads it: no scheme, credentials, port or path.
url_host() {
  local rest="${1#*://}"
  rest="${rest##*@}"
  rest="${rest%%/*}"
  case "$rest" in
    \[*\]*) printf '%s]' "${rest%%\]*}" ;;
    *) printf '%s' "${rest%%:*}" ;;
  esac
}

# MIRROR of `isLoopbackHostname` in packages/contract/src/access-service-token.ts, spelled as
# `staging-smoke-check.sh` spells it; this script's test greps both files for the same literals.
is_loopback_url() {
  case "$(url_host "$1")" in
    localhost|*.localhost|'[::1]'|'[::]'|0.0.0.0) return 0 ;;
    127.[0-9]*.[0-9]*.[0-9]*) return 0 ;;
  esac
  return 1
}

# Access lets this route through only with both service-token headers. The token is staging's:
# it is required here by name, and never sent to this machine.
read_access_service_token() {
  local id="${CF_ACCESS_CLIENT_ID:-}" secret="${CF_ACCESS_CLIENT_SECRET:-}"
  [ -n "$id" ] || fail "CF_ACCESS_CLIENT_ID is unset: Cloudflare Access takes both service-token headers"
  [ -n "$secret" ] || fail "CF_ACCESS_CLIENT_SECRET is unset: Cloudflare Access takes both service-token headers"
  if is_loopback_url "$ORIGIN"; then fail "staging's Access service token is never sent to a loopback origin: $ORIGIN"; fi
  ACCESS_HEADERS=(-H "CF-Access-Client-Id: $id" -H "CF-Access-Client-Secret: $secret")
}

# One request, its body written to $1 and its response headers to $2; prints "<status> <first byte>
# <total>". No redirect is followed: the login page Access redirects to is an answer, and a wrong one.
timed_request() {
  curl -sS --max-time 15 -o "$1" -D "$2" -w '%{http_code} %{time_starttransfer} %{time_total}' \
    "${ACCESS_HEADERS[@]}" "$ORIGIN$ROUTE"
}

# The Server-Timing in the headers curl wrote: every field line of it, in any letter case, joined as
# HTTP joins a repeated field; `none` when it carried none, or when curl wrote no headers at all.
server_timing() { # server_timing <header file>
  [ -f "$1" ] || { echo none; return; }
  awk 'tolower($0) ~ /^server-timing:/ { sub(/^[^:]*:[ \t]*/, ""); sub(/\r$/, ""); value = value (value == "" ? "" : ", ") $0 }
       END { print (value == "" ? "none" : value) }' "$1"
}

# What is wrong with one answer; nothing when it is a 200 carrying a bangumi array.
answer_problem() { # answer_problem <curl exit> <status> <body file>
  if [ "$1" -ne 0 ]; then echo "curl exit $1"; return; fi
  if [ "$2" != "200" ]; then echo "HTTP $2"; return; fi
  jq -e '.bangumi | type == "array"' "$3" >/dev/null 2>&1 || echo "the body has no bangumi array"
}

# One timed request: its timing and its Server-Timing go to the log before its answer is judged.
measure() { # measure <cold|warm>
  local body="$WORK/$1" headers="$WORK/$1.headers" out rc status first total problem
  out="$(timed_request "$body" "$headers")" && rc=0 || rc=$?
  read -r status first total <<<"$out"
  echo "$1 request: HTTP $status in $total s (first byte $first s, curl exit $rc)"
  echo "$1 request Server-Timing: $(server_timing "$headers")"
  TOTALS+=("$total")
  problem="$(answer_problem "$rc" "$status" "$body")"
  if [ -n "$problem" ]; then FAILURES+=("the $1 request failed: $problem"); fi
}

# Cold minus warm, with its sign: a warm request can be the slower one.
difference() {
  awk -v cold="${TOTALS[0]}" -v warm="${TOTALS[1]}" 'BEGIN { printf "%+.6f", cold - warm }'
}

report_failures() {
  local failure
  for failure in "${FAILURES[@]}"; do echo "::error title=$TITLE::$failure"; done
  exit 1
}

main() {
  read_access_service_token
  measure cold
  measure warm
  echo "::notice title=$TITLE::cold ${TOTALS[0]} s, warm ${TOTALS[1]} s, cold minus warm $(difference) s"
  if [ "${#FAILURES[@]}" -gt 0 ]; then report_failures; fi
  echo "$TITLE: both requests answered 200 with a bangumi array"
}

main
