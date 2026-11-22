#!/usr/bin/env bash
# SUT: .github/scripts/release/build-worker.mjs
# Exercise the native Wrangler bundler, including real module/asset resolution.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
[ ! -e release ] || { echo 'release already exists; refusing to overwrite it' >&2; exit 1; }
mkdir release
# A release build asks no upstream for anything. Wrangler's banner runs an update check against
# registry.npmjs.org unless WRANGLER_HIDE_BANNER is set, and caches the answer under
# os.tmpdir()/update-check/, so the builds run with a TMPDIR of their own and that cache is the
# evidence.
build_tmp="$(mktemp -d)"
trap 'rm -rf release "$build_tmp"' EXIT
# #1606: no release unit carries a container image, so every bundle seals without one.
TMPDIR="$build_tmp" node .github/scripts/release/build-worker.mjs catalog
TMPDIR="$build_tmp" node .github/scripts/release/build-worker.mjs users
TMPDIR="$build_tmp" node .github/scripts/release/build-worker.mjs api
TMPDIR="$build_tmp" node .github/scripts/release/build-worker.mjs migrator
[ ! -e "$build_tmp/update-check" ] || { echo "a release build ran wrangler's update check" >&2; exit 1; }
[ -s release/catalog/bundle/index.js ]
[ -s release/users/bundle/index.js ]
[ -s release/api/bundle/entry.js ]
[ -s release/migrator/bundle/index.js ]
jq -e '((.containers // []) | length == 0) and ((.env.staging.containers // []) | length == 0) and ((.env.production.containers // []) | length == 0)' release/api/wrangler.json > /dev/null
jq -e '((.containers // []) | length == 0) and ((.env.staging.containers // []) | length == 0) and ((.env.production.containers // []) | length == 0)' release/migrator/wrangler.json > /dev/null
jq -e '.main == "bundle/entry.js" and (.build == null)' release/api/wrangler.json > /dev/null
for environment in staging production; do
  for unit in catalog users api migrator; do
    WRANGLER_HIDE_BANNER=true WRANGLER_SEND_METRICS=false \
      pnpm exec wrangler deploy --no-bundle --config "release/$unit/wrangler.json" --env "$environment" --dry-run
  done
done
echo 'native release bundles: all assertions hold'
