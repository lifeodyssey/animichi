#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="public/tiles/uji-kyoto.pmtiles"
BBOX="135.68,34.85,135.85,35.02"

if [[ -f "$OUT" ]]; then
  echo "$OUT already exists; skipping download."
  exit 0
fi

if ! command -v pmtiles >/dev/null 2>&1; then
  echo "pmtiles CLI is required." >&2
  echo "Install with: brew install pmtiles" >&2
  echo "Or download go-pmtiles releases: https://github.com/protomaps/go-pmtiles/releases" >&2
  exit 1
fi

probe_build() {
  if [[ -n "${BUILD:-}" ]]; then
    echo "$BUILD"
    return 0
  fi

  for offset in 0 1 2 3 4 5 6; do
    candidate="$(date -u -v-"${offset}"d +%Y%m%d 2>/dev/null || date -u -d "-${offset} day" +%Y%m%d)"
    url="https://build.protomaps.com/${candidate}.pmtiles"
    if curl -fsI "$url" >/dev/null; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

build="$(probe_build)" || {
  echo "No retained Protomaps daily build found in the last 7 days." >&2
  exit 1
}

mkdir -p public/tiles
pmtiles extract "https://build.protomaps.com/${build}.pmtiles" "$OUT" --bbox="$BBOX"
