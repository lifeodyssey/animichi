#!/usr/bin/env bash
set -euo pipefail

# scripts/spike/pi-s5-egress.sh — W0-S5 (#1248) red-line matrix for the deployed
# pi probe Worker (workers/edge/spike/pi).
#
# Every row of the 8/29 note's condition 6 is a request to the deployed Worker,
# because the questions are about a real workerd isolate behind Cloudflare's own
# outbound proxy: which refusals are the application's `EgressPolicy` and which
# are the platform's. The unit suite proves the policy over doubles
# (workers/edge/test/byok-egress-*.test.ts); this script is the deployed run.
#
# Cases:
#   matrix    the BYOK decision table — provider allowlist, non-empty key with
#             no server-key fallback, HTTPS + port 443, metadata / private /
#             loopback / link-local / CGNAT / own-infra in IPv4 and IPv6, the
#             userinfo disguise, two real public names whose A record is
#             127.0.0.1, and the provider error text's redaction. Each
#             row is one POST /egress; an allowed row performs the real pi round
#             trip with the throwaway key, so its reason cell carries the round
#             trip's outcome as well.
#   platform  GET /egress/platform — the same address families with NO policy in
#             the way, so the deployed run can say which refusals were already
#             the platform's. A `blocked` row is Cloudflare; a `reachable` row
#             means only the application policy stands between a BYOK caller and
#             that address.
#   redirect  GET /egress/redirect — the 302 re-validation, against a fixed
#             public fixture (httpbingo.org). It cannot be measured through
#             POST /egress: the allowlist refuses the fixture host before any
#             redirect exists, so the Worker runs the same guarded fetch over a
#             fixture-only allowlist. The third row is the control — a redirect
#             that IS re-validated and then followed.
#
# Usage:
#   scripts/spike/pi-s5-egress.sh          --url <worker-url> [--out DIR] [--key K]
#   scripts/spike/pi-s5-egress.sh all      --url <worker-url> [--out DIR] [--key K]
#   scripts/spike/pi-s5-egress.sh matrix   --url <worker-url>
#   scripts/spike/pi-s5-egress.sh platform --url <worker-url>
#   scripts/spike/pi-s5-egress.sh redirect --url <worker-url>
#   scripts/spike/pi-s5-egress.sh format < "$OUT/results.txt"
#
# The command defaults to `all`, so the bare `--url <worker-url>` form works.
#
# `--key` is the BYOK credential the allowed rows send. It is meant to be
# invalid: the measurement is that the provider's 401 comes back scrubbed. Never
# pass a live key — nothing here needs one, and it would end up in your shell
# history.
#
# Records accumulate in "$OUT/results.txt" as `case|expect|decision|reason|leak`
# lines, the same file-then-format shape pi-s1-measure.sh and pi-s4-durable.sh
# use, so the spec appendix keeps one table format.

URL=""
OUT="${PWD}/.local/spike/pi-s5"
BYOK_KEY="spike-not-a-real-key-000000000000"

# Prints the header comment block, whatever length it grows to.
usage() {
  awk 'NR > 3 && /^#/ { sub(/^# ?/, ""); print; next } NR > 3 { exit }' "$0" >&2
  exit 64
}

fail() {
  echo "pi-s5-egress: $1" >&2
  exit 1
}

parse_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --url) URL="${2:-}"; shift 2 ;;
      --out) OUT="${2:-}"; shift 2 ;;
      --key) BYOK_KEY="${2:-}"; shift 2 ;;
      *) usage ;;
    esac
  done
}

require_url() {
  [ -n "${URL}" ] || fail "--url is required (the deployed Worker's base URL)"
  mkdir -p "${OUT}"
}

sanitize() {
  tr '|' '/' <<< "$1" | tr -d '\n'
}

record() {
  local line
  line="$(sanitize "$1")|$(sanitize "$2")|$(sanitize "$3")|$(sanitize "$4")|$(sanitize "$5")"
  echo "${line}" >> "${OUT}/results.txt"
  echo "${line}"
}

# BSD and GNU sed disagree about BRE alternation, so every reader below is
# grep + cut. `field_of` reads from a file, `member_of` from one JSON object on
# stdin — the probe routes answer arrays, and the matrix answers one object.
field_of() {
  member_of "$2" < "$1"
}

member_of() {
  local object
  object="$(cat)"
  grep -o "\"$1\":\"[^\"]*\"" <<< "${object}" | head -1 | cut -d'"' -f4
}

scalar_of() {
  local object
  object="$(cat)"
  grep -o "\"$1\":[A-Za-z0-9]*" <<< "${object}" | head -1 | cut -d':' -f2
}

# The matrix. Columns: case, expected reason (or `allow`), provider, base URL,
# key mode (`key` sends --key, `none` sends the empty string).
matrix_rows() {
  cat <<'ROWS'
allowlisted-openai|allow|openai|https://api.openai.com/v1|key
allowlisted-anthropic|allow|anthropic|https://api.anthropic.com|key
allowlisted-google|allow|google|https://generativelanguage.googleapis.com/v1beta/openai|key
http-scheme|scheme_not_https|openai|http://api.openai.com/v1|key
port-8080|port_not_443|openai|https://api.openai.com:8080/v1|key
metadata-ipv4|metadata_address|openai|https://169.254.169.254/latest/meta-data|key
metadata-hostname|metadata_address|openai|https://metadata.google.internal/computeMetadata/v1|key
metadata-ipv4-mapped|metadata_address|openai|https://[::ffff:169.254.169.254]/v1|key
private-ipv4|private_address|openai|https://10.0.0.1/v1|key
private-ipv6-ula|private_address|openai|https://[fd00::1]/v1|key
loopback-ipv4|loopback_address|openai|https://127.0.0.1/v1|key
loopback-ipv6|loopback_address|openai|https://[::1]/v1|key
link-local-ipv4|link_local_address|openai|https://169.254.1.1/v1|key
cgnat-ipv4|cgnat_address|openai|https://100.64.0.1/v1|key
own-workers-dev|own_infrastructure|openai|https://animichi-spike-pi.example.workers.dev/v1|key
own-catalog-internal|own_infrastructure|openai|https://catalog.internal/v1|key
userinfo-disguise|userinfo_present|openai|https://api.openai.com@evil.test/v1|key
wrong-provider-family|host_not_allowlisted|anthropic|https://api.openai.com/v1|key
dns-resolves-loopback|host_not_allowlisted|openai|https://localtest.me/v1|key
dns-resolves-loopback-wildcard|host_not_allowlisted|openai|https://127.0.0.1.nip.io/v1|key
unknown-provider|unknown_provider|openrouter|https://api.openai.com/v1|key
empty-key-no-fallback|empty_key|openai|https://api.openai.com/v1|none
ROWS
}

key_for() {
  if [ "$1" = "key" ]; then printf '%s' "${BYOK_KEY}"; else printf ''; fi
}

# An allowed row's reason cell carries the round trip too: a platform refusal
# shows up there as `allowlisted/failed` with the runtime's own error text,
# while a provider that answered shows the scrubbed 401.
reason_cell() {
  local body="$1" decision reason trip detail
  decision="$(field_of "${body}" decision)"
  reason="$(field_of "${body}" reason)"
  trip="$(field_of "${body}" roundTrip)"
  # `detail` is JSON-escaped provider text; the reader stops at the first
  # escaped quote, so a trailing backslash is trimmed off the truncation.
  detail="$(field_of "${body}" detail | cut -c1-70 | sed 's/\\*$//')"
  if [ "${decision}" != "allow" ]; then printf '%s' "${reason}"; return 0; fi
  printf '%s/%s %s' "${reason}" "${trip}" "${detail}"
}

matrix_row() {
  local name="$1" expect="$2" provider="$3" base_url="$4" mode="$5"
  local body="${OUT}/${name}.json" payload
  payload="$(printf '{"provider":"%s","baseUrl":"%s","key":"%s"}' \
    "${provider}" "${base_url}" "$(key_for "${mode}")")"
  curl -sS -o "${body}" -H 'content-type: application/json' -d "${payload}" \
    "${URL}/egress" || fail "POST /egress failed for ${name}"
  record "${name}" "${expect}" "$(field_of "${body}" decision)" \
    "$(reason_cell "${body}")" "$(scalar_of keyLeaked < "${body}")"
}

matrix_case() {
  require_url
  local name expect provider base_url mode
  while IFS='|' read -r name expect provider base_url mode; do
    [ -n "${name}" ] || continue
    matrix_row "${name}" "${expect}" "${provider}" "${base_url}" "${mode}"
  done < <(matrix_rows)
}

# Fetches a probe route and splits `{"probes":[{...},{...}]}` into one object
# per line, so the readers above work on each. Assumes no probe string contains
# the literal `},{`, which holds for the fixed target lists and the runtime
# error texts they produce.
probe_objects() {
  local path="$1" body="$2"
  curl -sS -o "${body}" "${URL}${path}" || fail "GET ${path} failed"
  tr -d '\n' < "${body}" | sed -e 's/^{"probes":\[//' -e 's/\]}$//' -e 's/},{/}\
{/g'
}

platform_case() {
  require_url
  local object target outcome
  while IFS= read -r object || [ -n "${object}" ]; do
    target="$(member_of target <<< "${object}")"
    [ -n "${target}" ] || continue
    outcome="$(member_of outcome <<< "${object}")"
    record "platform:${target}" "observed" "${outcome}" \
      "$(member_of detail <<< "${object}" | cut -c1-70)" "n/a"
  done < <(probe_objects /egress/platform "${OUT}/platform.json")
}

redirect_case() {
  require_url
  local object name expect outcome hops
  while IFS= read -r object || [ -n "${object}" ]; do
    name="$(member_of name <<< "${object}")"
    [ -n "${name}" ] || continue
    expect="$(member_of expect <<< "${object}")"
    outcome="$(member_of outcome <<< "${object}")"
    hops="$(scalar_of hops <<< "${object}")"
    record "redirect:${name}" "${expect}" "${outcome}" \
      "hops=${hops} status=$(scalar_of status <<< "${object}")" "n/a"
  done < <(probe_objects /egress/redirect "${OUT}/redirect.json")
}

format_case() {
  echo '| case | expect | decision | reason | key leaked |'
  echo '| --- | --- | --- | --- | --- |'
  while IFS='|' read -r name expect decision reason leak; do
    [ -n "${name}" ] || continue
    case "${name}" in \#*) continue ;; esac
    printf '| %s | %s | %s | %s | %s |\n' "${name}" "${expect}" "${decision}" "${reason}" "${leak}"
  done
}

all_cases() {
  require_url
  matrix_case
  redirect_case
  platform_case
  echo
  format_case < "${OUT}/results.txt"
}

main() {
  # The command is optional and defaults to `all`, so both the brief's bare
  # `--url <worker-url>` form and `all --url <worker-url>` work. `shift` is only
  # safe once we know a command word is actually there.
  local command="all"
  case "${1:-}" in
    ""|--*) ;;
    *) command="$1"; shift ;;
  esac
  parse_options "$@"
  case "${command}" in
    all) all_cases ;;
    matrix) matrix_case ;;
    platform) platform_case ;;
    redirect) redirect_case ;;
    format) format_case ;;
    *) usage ;;
  esac
}

main "$@"
