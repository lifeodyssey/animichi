#!/usr/bin/env bash
# Type-check the database-access Pulumi program (#1947) — the check `infra`'s
# own `tsc --noEmit` cannot provide, because this directory is a SECOND Pulumi
# project with its own manifest and a type error here failed no gate.
#
# `@pulumi/neon` is a bridged SDK generated from Pulumi.yaml's pinned
# `packages:` at release time and kept out of the repo (`.gitignore`). The gate
# resolves the REAL generated types — never a shim, never a skipped import — by
# materializing the SDK exactly as CD's "Materialise the generated provider
# SDKs" step does: `pulumi install --no-dependencies`, then the frozen install
# that links `file:sdks/neon` and runs the SDK's own postinstall `tsc`
# (allowlisted by this directory's `pnpm-workspace.yaml`, #1772).
#
# The install is credential-free: `PULUMI_BACKEND_URL` points at a throwaway
# `file://` backend, which outranks `backend.url`, so no real state is read
# (measured on the pinned Pulumi 3.255.0 — same preflight as
# `scripts/local-gates/infra-check.sh`).
#
# The compiler is the workspace's (catalog ^7.0.2), resolved from `infra/`
# rather than this directory's own `typescript` pin, so the program is held to
# the repository's TypeScript gate — the one that removed the
# `moduleResolution: node10` this program's tsconfig used to carry.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(mktemp -d)"
trap 'rm -rf "$BACKEND"' EXIT

cd "$DIR"
PULUMI_BACKEND_URL="file://$BACKEND/backend" \
  pulumi install --no-dependencies --non-interactive
pnpm install --frozen-lockfile

cd ..
pnpm exec tsc --noEmit -p database-access/tsconfig.json
