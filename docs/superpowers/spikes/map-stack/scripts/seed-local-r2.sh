#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export WRANGLER_WRITE_LOGS=false
export WRANGLER_LOG_PATH="$PWD/.wrangler/logs"
export XDG_CONFIG_HOME="$PWD/.wrangler/config"
export XDG_CACHE_HOME="$PWD/.wrangler/cache"

if [[ ! -f public/tiles/uji-kyoto.pmtiles ]]; then
  echo "Missing public/tiles/uji-kyoto.pmtiles; run npm run fetch-tiles first." >&2
  exit 1
fi

mkdir -p .wrangler/logs .wrangler/config .wrangler/cache .wrangler/state

npx wrangler r2 object put "seichijunrei-assets-dev/tiles/uji-kyoto.pmtiles" \
  --file=public/tiles/uji-kyoto.pmtiles \
  --local \
  --persist-to=.wrangler/state \
  --force \
  --config worker/wrangler.toml
