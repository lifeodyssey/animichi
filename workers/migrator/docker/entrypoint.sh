#!/bin/sh
# #1051/#1100 — one-shot Atlas apply to head.
#
# The worker injects MIGRATOR_DATABASE_URL only for the seconds this container
# runs. PR1 of the Neon-connectivity spec makes connect fail-fast: reject a
# -pooler (PgBouncer) endpoint case-insensitively, resolve A only (getent
# ahostsv4 / nslookup, timeout-bound), then pin IPv4 by substituting the
# resolved address into the URL host field (hostaddr is a no-op in Atlas
# 0.30's pg driver) with options=endpoint=<id> for Neon SNI + sslmode; run
# `atlas migrate status` with a 30s connect bound and apply only when it
# succeeds. Nothing here echoes the DSN / URL / password; logs are secret-free.
set -eu

# shellcheck source=workers/migrator/docker/dsn.sh
. "$(dirname "$0")/dsn.sh"

DSN="${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL is required}"

HOST="$(dsn_host "$DSN")"
dsn_reject_pooler "$HOST"

IP="$(resolve_ipv4 "$HOST")" || IP=""
if [ -n "$IP" ]; then
  echo "resolve: family=A"
else
  echo "resolve: no A record" >&2
  exit 1
fi

EP_ID="$(dsn_endpoint_id "$HOST")"
SCOPE="$(rewrite_url "$DSN" "$IP" "$EP_ID")"

echo "probe: start"
probe_start="$(date +%s)"
if run_probe "file:///migrations" "$SCOPE"; then
  probe_end="$(date +%s)"
  echo "probe: elapsed_ms=$(((probe_end - probe_start) * 1000)) ok"
else
  probe_code=$?
  probe_end="$(date +%s)"
  echo "probe: elapsed_ms=$(((probe_end - probe_start) * 1000)) fail code=$probe_code"
  exit "$probe_code"
fi

apply_chain "file:///migrations" "$SCOPE"
