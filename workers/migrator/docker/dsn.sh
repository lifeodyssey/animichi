# shellcheck shell=sh
# #1100 — sourced helpers for the one-shot Atlas entrypoint.
#
# Secret-free by construction: none of these functions echo a DSN / URL /
# password. They only return derived non-secret values (hostname) or an
# appended URL *to be consumed as an argument*, never logged.

# Locked connect/session bound for the probe (owner sign-off 2026-08-16).
# The BusyBox timeout wrapper is PROBE_SECS + 5 so a driver that ignores
# connect_timeout still dies within the probe bound.
PROBE_SECS=30

# dsn_host <DSN> -> bare hostname (for pooler reject). Never prints the DSN.
dsn_host() {
  dsn_h="${1#*://}"
  dsn_h="${dsn_h##*@}"
  dsn_h="${dsn_h%%/*}"
  dsn_h="${dsn_h%%\?*}"
  case "$dsn_h" in *:*) dsn_h="${dsn_h%:*}" ;; esac
  printf '%s\n' "$dsn_h"
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
