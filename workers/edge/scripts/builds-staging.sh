#!/usr/bin/env bash
# Workers Builds command for staging root/edge (#1076): full wrangler deploy
# so the agent container image updates. Not versions-upload.
set -euo pipefail
cd "$(dirname "$0")/../../.."
wrangler deploy -c workers/edge/wrangler.toml --env staging
