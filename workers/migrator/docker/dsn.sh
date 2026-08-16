# shellcheck shell=sh
# #1100 PR1 — sourced helpers for the one-shot Atlas entrypoint.
#
# Secret-free by construction: none of these functions echo a DSN / URL /
# password. They only return derived non-secret values (hostname, endpoint
# id, IPv4) or an appended URL *to be consumed as an argument*, never logged.

# Locked connect/session bound for the probe (owner sign-off 2026-08-16).
# The BusyBox timeout wrapper is PROBE_SECS + 5 so a driver (or a resolver)
# that ignores connect_timeout still dies within the probe bound.
PROBE_SECS=30

# dsn_host <DSN> -> bare hostname (for pooler reject + A-only resolve).
# Never prints the DSN.
dsn_host() {
  dsn_h="${1#*://}"
  dsn_h="${dsn_h##*@}"
  dsn_h="${dsn_h%%/*}"
  dsn_h="${dsn_h%%\?*}"
  case "$dsn_h" in *:*) dsn_h="${dsn_h%:*}" ;; esac
  printf '%s\n' "$dsn_h"
}

# dsn_endpoint_id <host> -> Neon endpoint id (first dot-segment of the host):
# ep-….eu-central-1.aws.neon.tech -> the 'options=endpoint=<id>' SNI hint.
dsn_endpoint_id() {
  printf "%s\n" "${1%%.*}"
}

# dsn_reject_pooler <host> -> exits 1 on a -pooler (PgBouncer) endpoint.
# The match is case-insensitive; the host is never echoed.
dsn_reject_pooler() {
  rj_lc="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$rj_lc" in
    *-pooler*)
      echo "error: pooled endpoint rejected (-pooler host is banned for Atlas DDL)" >&2
      exit 1
      ;;
  esac
}

# with_timeout <secs> <cmd...> -> run <cmd> under BusyBox timeout when present,
# else run it directly. Returns the command's status (124 if it timed out).
with_timeout() {
  wt_secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$wt_secs" "$@"
  else
    "$@"
  fi
}

# append_query <URL> <param> -> URL with <param> added, keeping ? vs &.
append_query() {
  case "$1" in
    *\?*) printf '%s&%s\n' "$1" "$2" ;;
    *) printf '%s?%s\n' "$1" "$2" ;;
  esac
}

# rewrite_url <DSN> <ipv4> <endpoint_id> -> DSN with the host substituted by
# <ipv4>:5432 (hostaddr is a no-op in Atlas's pg driver), keeping sslmode;
# appends options=endpoint (Neon SNI), connect_timeout, search_path.
rewrite_url() {
  rw_url="$(printf '%s\n' "$1" | sed -E "s|@[^/?#]+|@$2:5432|")"
  rw_url="$(append_query "$rw_url" "options=endpoint%3D$3")"
  rw_url="$(append_query "$rw_url" "connect_timeout=$PROBE_SECS")"
  rw_url="$(append_query "$rw_url" "search_path=public")"
  printf '%s\n' "$rw_url"
}

# aaaa_note <resolver-output> -> best-effort "ignored=AAAA" diagnostic when a
# fallback answer shows IPv6. Always returns 0 (set -e safe).
aaaa_note() {
  if printf "%s\n" "$1" | grep -Eq ":[0-9a-fA-F]"; then
    echo "resolve: ignored=AAAA" >&2
  fi
}

# resolve_ipv4 <host> -> IPv4 A record via getent ahostsv4, falling back to
# nslookup -type=a, both bound by the probe timeout so a resolver hang cannot
# outlive the probe. Prints the IP (empty when resolve failed). AAAA is never
# used (that black-hole hang is the bug we avoid).
resolve_ipv4() {
  rv_t=$((PROBE_SECS + 5))
  rv_out="$(with_timeout "$rv_t" getent ahostsv4 "$1" 2>/dev/null)" || rv_out=""
  rv_ip="$(printf '%s\n' "$rv_out" | awk '$2=="STREAM" {print $1; exit}')"
  if [ -z "$rv_ip" ]; then
    rv_out="$(with_timeout "$rv_t" nslookup -type=a "$1" 2>/dev/null)" || rv_out=""
    aaaa_note "$rv_out"
    rv_ip="$(printf '%s\n' "$rv_out" | awk '/^Address:/ {gsub(/[^0-9.]/,"",$2); if ($2 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) {print $2; exit}}')"
  fi
  printf '%s\n' "$rv_ip"
}

# run_probe <dir> <url> -> atlas migrate status bound by the probe timeout;
# a non-zero / 124 status flows straight to the entrypoint's fail-fast exit.
run_probe() {
  rp_t=$((PROBE_SECS + 5))
  with_timeout "$rp_t" atlas migrate status --dir "$1" --url "$2" --revisions-schema public
}

# apply_chain <dir> <url> -> exec atlas migrate apply so signals reach it.
apply_chain() {
  echo "apply: start"
  exec atlas migrate apply --dir "$1" --url "$2" --revisions-schema public
}
