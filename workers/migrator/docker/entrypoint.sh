#!/bin/sh
# #1051 — one-shot Atlas apply to head. The worker injects MIGRATOR_DATABASE_URL
# only for the seconds this container runs. Scope search_path=public the same
# way the reusable-deploy-component Atlas step did, then apply the full chain.
set -eu

DSN="${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL is required}"

case "$DSN" in
  *\?*) SCOPE="${DSN}&search_path=public" ;;
  *)    SCOPE="${DSN}?search_path=public" ;;
esac

atlas migrate apply --dir file:///migrations --url "$SCOPE" --revisions-schema public
