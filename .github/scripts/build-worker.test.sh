#!/usr/bin/env bash
# SUT: .github/scripts/release/build-worker.mjs
# Exercise the native Wrangler bundler, including real module/asset resolution.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
[ ! -e release ] || { echo 'release already exists; refusing to overwrite it' >&2; exit 1; }
mkdir release
trap 'rm -rf release' EXIT
# #1606: no release unit carries a container image, so every bundle seals without one.
node .github/scripts/release/build-worker.mjs catalog
node .github/scripts/release/build-worker.mjs users
node .github/scripts/release/build-worker.mjs edge
node .github/scripts/release/build-worker.mjs migrator
[ -s release/catalog/bundle/index.js ]
[ -s release/users/bundle/index.js ]
[ -s release/edge/bundle/entry.js ]
[ -s release/migrator/bundle/index.js ]
jq -e '((.containers // []) | length == 0) and ((.env.staging.containers // []) | length == 0) and ((.env.production.containers // []) | length == 0)' release/edge/wrangler.json > /dev/null
jq -e '((.containers // []) | length == 0) and ((.env.staging.containers // []) | length == 0) and ((.env.production.containers // []) | length == 0)' release/migrator/wrangler.json > /dev/null
jq -e '.main == "bundle/entry.js" and (.build == null)' release/edge/wrangler.json > /dev/null
for environment in staging production; do
  for unit in catalog users edge migrator; do
    pnpm exec wrangler deploy --no-bundle --config "release/$unit/wrangler.json" --env "$environment" --dry-run
  done
done
echo 'native release bundles: all assertions hold'
