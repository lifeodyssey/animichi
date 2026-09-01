#!/usr/bin/env bash
set -euo pipefail

# scripts/build-pmtiles.sh — monthly map-tile supply pipeline (ADR-0001 D2,
# docs/adr/0001-map-stack-maplibre-protomaps.md): a Japan-wide PMTiles archive
# from the daily Protomaps build, CJK-capable glyph PBFs, the Protomaps sprite
# sheet, all uploaded to the R2 bucket the edge Worker's /tiles/* proxy reads.
#
# Usage:
#   scripts/build-pmtiles.sh <probe|extract|fonts|sprites|upload|all> [options]
#
# Options:
#   --env staging|prod  selects the R2 bucket (default: staging)
#   --bbox W,S,E,N       extract bbox (default: Japan)
#   --out <dir>          work dir for downloads/output (default: .local/tiles)
#   --name <name>        pmtiles archive base name (default: japan)
#   --force              redo steps even if their output already exists
#
# Requires: curl; pmtiles CLI (brew install pmtiles); for `fonts`, font-maker
# built from source (no package release — `git clone --recursive
# https://github.com/maplibre/font-maker && cd font-maker && cmake . && make`,
# needs `brew install boost freetype`) and git for `sprites`. `upload` needs
# the `aws` CLI (brew install awscli) plus R2_TILES_ACCESS_KEY_ID /
# R2_TILES_SECRET_ACCESS_KEY (a dedicated pair — the repo's Pulumi-state R2
# pair can't write to map-tiles buckets) and CLOUDFLARE_ACCOUNT_ID, read from
# the environment or a grep of repo-root .env; no secret is ever echoed.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$REPO_ROOT/scripts/build-pmtiles.sh"

ENV="staging"
BBOX="122.9,24.0,146.0,45.6"
OUT_DIR="$REPO_ROOT/.local/tiles"
NAME="japan"
FORCE=0
R2_ENDPOINT=""

usage() {
  sed -n '3,26p' "$SELF"
}

bucket_for_env() { # bucket_for_env <staging|prod> -> R2 bucket name
  case "$1" in
    staging) echo "map-tiles-staging" ;;
    prod) echo "map-tiles" ;;
    *) echo "build-pmtiles: unknown --env '$1' (want staging|prod)" >&2; return 1 ;;
  esac
}

# macOS ships BSD date (`-v-1d`); Linux/CI ships GNU date (`-d "-1 days"`).
# Probe which dialect is live once, rather than shelling out twice per call.
date_back() { # date_back <days-ago> -> YYYYMMDD in UTC
  if date -v-0d +%Y%m%d >/dev/null 2>&1; then
    date -u -v-"$1"d +%Y%m%d
  else
    date -u -d "-$1 days" +%Y%m%d
  fi
}

cmd_probe() {
  local days_ago candidate url
  for days_ago in 0 1 2 3 4 5 6 7; do
    candidate="$(date_back "$days_ago")"
    url="https://build.protomaps.com/${candidate}.pmtiles"
    echo "probe: checking ${url}" >&2
    if curl -fsI "$url" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  echo "build-pmtiles: no Protomaps daily build found in the last 7 days" >&2
  return 1
}

cmd_extract() {
  local build_date archive_url out_file
  out_file="${OUT_DIR}/${NAME}.pmtiles"
  if [[ -f "$out_file" && "$FORCE" -ne 1 ]]; then
    echo "extract: ${out_file} already exists, skip (--force to redo)"
    return 0
  fi
  build_date="$(cmd_probe)"
  archive_url="https://build.protomaps.com/${build_date}.pmtiles"
  mkdir -p "$OUT_DIR"
  echo "extract: pmtiles extract ${archive_url} -> ${out_file} (bbox=${BBOX})"
  pmtiles extract "$archive_url" "$out_file" --bbox="$BBOX" --download-threads=8
}

download_font() { # download_font <url> <dest-file>
  if [[ -f "$2" && "$FORCE" -ne 1 ]]; then
    echo "fonts: $(basename "$2") already downloaded, skip"
    return 0
  fi
  echo "fonts: downloading $(basename "$2")"
  curl -fsSL -o "$2" "$1"
}

# font-maker requires its outdir's PARENT to exist and the outdir itself to
# NOT exist (it creates it fresh) — so each stack gets its own slug subdir
# under fonts/, which also gives `upload` a clean per-stack tree to sync.
build_font_stack() { # build_font_stack <slug> <stack name> <font source file>...
  local slug="$1" stack="$2"
  local out_dir="${OUT_DIR}/fonts/${slug}"
  shift 2
  if [[ -d "$out_dir" ]]; then
    [[ "$FORCE" -eq 1 ]] || { echo "fonts: stack '${stack}' already built, skip"; return 0; }
    rm -rf "$out_dir"
  fi
  echo "fonts: building stack '${stack}'"
  font-maker --name "$stack" "$out_dir" "$@"
}

cmd_fonts() {
  # Protomaps' own font PBFs carry no CJK glyphs, so each stack is regenerated
  # locally by merging base Noto Sans with Noto Sans CJK JP (base first, CJK
  # second — the order Protomaps' own basemaps-assets/scripts/create_fonts.sh uses).
  command -v font-maker >/dev/null || { echo "build-pmtiles: font-maker not found (build from source, see header)" >&2; return 1; }
  local src="${OUT_DIR}/font-sources"
  mkdir -p "$src" "${OUT_DIR}/fonts"
  local noto="https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/unhinted/ttf"
  local cjk="https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese"
  download_font "${noto}/NotoSans-Regular.ttf" "${src}/NotoSans-Regular.ttf"
  download_font "${noto}/NotoSans-Medium.ttf" "${src}/NotoSans-Medium.ttf"
  download_font "${noto}/NotoSans-Italic.ttf" "${src}/NotoSans-Italic.ttf"
  download_font "${cjk}/NotoSansCJKjp-Regular.otf" "${src}/NotoSansCJKjp-Regular.otf"
  download_font "${cjk}/NotoSansCJKjp-Medium.otf" "${src}/NotoSansCJKjp-Medium.otf"
  build_font_stack regular "Noto Sans Regular" "${src}/NotoSans-Regular.ttf" "${src}/NotoSansCJKjp-Regular.otf"
  build_font_stack medium "Noto Sans Medium" "${src}/NotoSans-Medium.ttf" "${src}/NotoSansCJKjp-Medium.otf"
  # There is no CJK italic; the Italic stack borrows the Regular CJK weight.
  build_font_stack italic "Noto Sans Italic" "${src}/NotoSans-Italic.ttf" "${src}/NotoSansCJKjp-Regular.otf"
}

cmd_sprites() {
  local dest="${OUT_DIR}/basemaps-assets"
  if [[ -d "$dest" && "$FORCE" -ne 1 ]]; then
    echo "sprites: ${dest} already cloned, skip"
    return 0
  fi
  rm -rf "$dest"
  echo "sprites: cloning protomaps/basemaps-assets"
  git clone --depth 1 https://github.com/protomaps/basemaps-assets.git "$dest"
}

# scripts/local-login.sh's existing convention: grep one var out of a .env
# rather than sourcing the whole file (which shellcheck can't statically
# follow anyway, since the path is a variable) — never echoed.
env_value() { # env_value <VAR_NAME> -> already-exported value, else from repo-root .env, else ""
  local name="$1" file="$REPO_ROOT/.env"
  if [[ -n "${!name:-}" ]]; then
    printf '%s' "${!name}"
  elif [[ -f "$file" ]]; then
    grep -E "^${name}=" "$file" | tail -1 | cut -d= -f2- | tr -d '"'
  fi
}

require_r2_credentials() {
  R2_TILES_ACCESS_KEY_ID="$(env_value R2_TILES_ACCESS_KEY_ID)"
  R2_TILES_SECRET_ACCESS_KEY="$(env_value R2_TILES_SECRET_ACCESS_KEY)"
  CLOUDFLARE_ACCOUNT_ID="$(env_value CLOUDFLARE_ACCOUNT_ID)"
  if [[ -z "$R2_TILES_ACCESS_KEY_ID" || -z "$R2_TILES_SECRET_ACCESS_KEY" ]]; then
    echo "build-pmtiles: set R2_TILES_ACCESS_KEY_ID and R2_TILES_SECRET_ACCESS_KEY (env or .env) — the Pulumi-state R2 pair cannot write to map-tiles buckets" >&2
    return 1
  fi
  [[ -n "$CLOUDFLARE_ACCOUNT_ID" ]] || { echo "build-pmtiles: CLOUDFLARE_ACCOUNT_ID is not set" >&2; return 1; }
}

# wrangler refuses files over 300 MiB and the pmtiles archive is ~3.35 GiB, so
# `upload` goes through R2's S3-compatible API instead — `aws s3 cp` handles
# multipart automatically.
r2_upload_ready() {
  require_r2_credentials || return 1
  command -v aws >/dev/null || { echo "build-pmtiles: aws CLI not found (brew install awscli)" >&2; return 1; }
  export AWS_ACCESS_KEY_ID="$R2_TILES_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_TILES_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION=auto
  export AWS_EC2_METADATA_DISABLED=true
  R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
}

upload_archive() { # upload_archive <bucket>
  local file="${OUT_DIR}/${NAME}.pmtiles"
  echo "upload: ${file} -> s3://$1/tiles/${NAME}.pmtiles"
  aws s3 cp "$file" "s3://$1/tiles/${NAME}.pmtiles" \
    --endpoint-url "$R2_ENDPOINT" --content-type application/octet-stream --only-show-errors
}

upload_fonts() { # upload_fonts <bucket>
  local slug
  for slug in regular medium italic; do
    echo "upload: fonts/${slug} -> s3://$1/tiles/fonts/"
    aws s3 sync "${OUT_DIR}/fonts/${slug}" "s3://$1/tiles/fonts/" \
      --endpoint-url "$R2_ENDPOINT" --content-type application/x-protobuf --only-show-errors
  done
}

upload_sprites() { # upload_sprites <bucket>
  local src="${OUT_DIR}/basemaps-assets/sprites/v4" dest="s3://$1/tiles/sprites/v4/"
  echo "upload: sprites (json) -> ${dest}"
  aws s3 sync "$src" "$dest" --exclude "*" --include "light*.json" \
    --endpoint-url "$R2_ENDPOINT" --content-type application/json --only-show-errors
  echo "upload: sprites (png) -> ${dest}"
  aws s3 sync "$src" "$dest" --exclude "*" --include "light*.png" \
    --endpoint-url "$R2_ENDPOINT" --content-type image/png --only-show-errors
}

cmd_upload() {
  local bucket
  bucket="$(bucket_for_env "$ENV")"
  r2_upload_ready || return 1
  echo "upload: syncing to r2://${bucket}/tiles/ via the S3 API (multipart)"
  upload_archive "$bucket"
  upload_fonts "$bucket"
  upload_sprites "$bucket"
}

cmd_all() {
  cmd_extract
  cmd_fonts
  cmd_sprites
  cmd_upload
}

SUBCOMMAND="${1:-}"
[[ $# -gt 0 ]] && shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    --bbox) BBOX="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "build-pmtiles: unknown option '$1'" >&2; usage; exit 2 ;;
  esac
done
bucket_for_env "$ENV" >/dev/null || exit 2

case "$SUBCOMMAND" in
  probe) cmd_probe ;;
  extract) cmd_extract ;;
  fonts) cmd_fonts ;;
  sprites) cmd_sprites ;;
  upload) cmd_upload ;;
  all) cmd_all ;;
  *) usage; exit 2 ;;
esac
