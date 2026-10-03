#!/usr/bin/env bash
set -euo pipefail
case "${1:?environment required}" in staging|production) ;; *) exit 1 ;; esac
: "${SOURCE_SHA:?selected source required}"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
for unit in catalog users api web; do
  pnpm exec wrangler deploy --no-bundle --config "release/$unit/wrangler.json" --env "$1" --tag "sha-$SOURCE_SHA"
  # #1929: the api unit ALSO deploys its own workers.dev script rings beside
  # the old one, from the same sealed config — `animichi-api-staging` when
  # staging publishes, `animichi-api` once a production promotion is approved.
  # The old script keeps the zone routes; the ring's Access destination was
  # applied by the topology step earlier in this job, so the door exists
  # before the script behind it first serves.
  if [ "$unit" = api ]; then
    pnpm exec wrangler deploy --no-bundle --config "release/api/wrangler.json" --env "api-$1" --tag "sha-$SOURCE_SHA"
  fi
done
