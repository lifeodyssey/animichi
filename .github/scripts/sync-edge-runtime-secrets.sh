#!/usr/bin/env bash
set -euo pipefail

MODE="${1:?mode required}"
TARGET_ENVIRONMENT="${2:?environment required}"
WORKER_CONFIG="${3:?worker config required}"
ROOT="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
RENDER="$ROOT/.github/scripts/edge-runtime-secrets.py"

python3 "$RENDER" preflight "$TARGET_ENVIRONMENT" "$WORKER_CONFIG"
[ "$MODE" = preflight ] && exit 0
[ "$MODE" = apply ] || { echo "edge runtime secrets: mode must be preflight or apply" >&2; exit 1; }
python3 "$RENDER" render "$TARGET_ENVIRONMENT" "$WORKER_CONFIG" \
  | pnpm --dir "$ROOT" exec wrangler secret bulk --config "$WORKER_CONFIG" --env "$TARGET_ENVIRONMENT"
