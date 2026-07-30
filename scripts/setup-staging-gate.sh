#!/usr/bin/env bash
set -euo pipefail

# Staging access gate — one-shot setup (#529 / #559 / #541)
#
# Generates the shared token for the Cloudflare WAF rule that fronts
# staging.animichi.com, and installs the SAME value in the two places that
# need it:
#
#   1. Pulumi config (encrypted into infra/Pulumi.staging.yaml) — the WAF rule
#      is built from it.
#   2. The STAGING_GATE_TOKEN GitHub secret — the Playwright suite sends it as
#      the `x-staging-key` header.
#
# A mismatch between the two locks CI out of staging with no useful symptom,
# which is the whole reason this is a script and not a checklist.
#
# The token is never printed unless you ask for it with --show. You need it
# once, by hand, to set the `animichi_staging` cookie in a browser — put it in
# a password manager then.
#
# Usage:
#   bash scripts/setup-staging-gate.sh            # generate + install, silent
#   bash scripts/setup-staging-gate.sh --show     # also print it once, to copy
#   bash scripts/setup-staging-gate.sh --rotate   # replace an existing token

SHOW=0
ROTATE=0
for arg in "$@"; do
  case "$arg" in
    --show) SHOW=1 ;;
    --rotate) ROTATE=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK=staging

fail() { echo "✗ $*" >&2; exit 1; }

# ── Preconditions, all of them, before touching anything ────────────────────
# Setting one location and failing on the other is the exact broken state this
# script exists to prevent, so everything is checked up front.
command -v openssl >/dev/null || fail "openssl not found"
command -v gh >/dev/null      || fail "gh not found — https://cli.github.com"
command -v pulumi >/dev/null  || fail "pulumi not found — https://pulumi.com/docs/install"

gh auth status >/dev/null 2>&1 || fail "gh is not authenticated — run: gh auth login"

: "${PULUMI_CONFIG_PASSPHRASE:?PULUMI_CONFIG_PASSPHRASE must be set (same value CI uses)}"
: "${PULUMI_BACKEND_URL:?PULUMI_BACKEND_URL must be set (the R2 state backend)}"

cd "$REPO_ROOT/infra"
pulumi stack select "$STACK" >/dev/null 2>&1 \
  || fail "cannot select Pulumi stack '$STACK' — check PULUMI_BACKEND_URL and your R2 credentials"

# ── Refuse to clobber silently ──────────────────────────────────────────────
EXISTING_PULUMI=0
pulumi config get stagingGateToken --stack "$STACK" >/dev/null 2>&1 && EXISTING_PULUMI=1
EXISTING_GH=0
gh secret list --json name -q '.[].name' 2>/dev/null | grep -qx STAGING_GATE_TOKEN && EXISTING_GH=1

if [ "$ROTATE" -eq 0 ] && { [ "$EXISTING_PULUMI" -eq 1 ] || [ "$EXISTING_GH" -eq 1 ]; }; then
  echo "A gate token already exists:"
  [ "$EXISTING_PULUMI" -eq 1 ] && echo "  • Pulumi config (stack $STACK)"
  [ "$EXISTING_GH" -eq 1 ]     && echo "  • GitHub secret STAGING_GATE_TOKEN"
  echo
  echo "Re-run with --rotate to replace it. Rotating invalidates any browser"
  echo "cookie already carrying the old value; you will need to set it again."
  exit 1
fi

# ── Generate and install ────────────────────────────────────────────────────
# Held in a variable, never written to a file, never echoed by default.
TOKEN="$(openssl rand -base64 32)"

printf '%s' "$TOKEN" | gh secret set STAGING_GATE_TOKEN
echo "✓ GitHub secret STAGING_GATE_TOKEN set"

# `--secret` encrypts it into Pulumi.staging.yaml under the stack passphrase.
pulumi config set --secret stagingGateToken "$TOKEN" --stack "$STACK" >/dev/null
echo "✓ Pulumi config stagingGateToken set (encrypted, stack $STACK)"

if [ "$SHOW" -eq 1 ]; then
  echo
  echo "Token (copy into a password manager — needed to set the browser cookie):"
  echo
  echo "    $TOKEN"
  echo
  echo "Browser cookie:  name=animichi_staging  value=<the value above>"
  echo "                 on https://staging.animichi.com"
fi

cat <<'NEXT'

Installed, but the gate is still OFF. To turn it on:

    cd infra
    pulumi config set stagingGateEnabled true --stack staging

and commit the updated Pulumi.staging.yaml. The gate also needs DNS to exist
(#538 / #541) before it has anything to guard.

Verify once live — the first must be blocked, the second must not:

    curl -sS -o /dev/null -w '%{http_code}\n' https://staging.animichi.com/
    curl -sS -o /dev/null -w '%{http_code}\n' \
      -H "x-staging-key: $(cd infra && pulumi config get stagingGateToken --stack staging)" \
      https://staging.animichi.com/
NEXT
