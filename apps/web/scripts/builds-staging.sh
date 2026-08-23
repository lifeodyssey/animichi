#!/usr/bin/env bash
# Workers Builds command for staging web (#1075): env-neutral bundle plus
# runtime-config injection. Cloudflare Builds runs this, then wrangler deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm run build
if [ -n "${VITE_NEON_AUTH_BASE_URL:-}" ]; then
  TARGET_ENVIRONMENT=staging node ../../.github/scripts/inject-web-runtime-config.mjs
else
  echo "VITE_NEON_AUTH_BASE_URL unset; using wrangler.jsonc staging RUNTIME_CONFIG"
fi
