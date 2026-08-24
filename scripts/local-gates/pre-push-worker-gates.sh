#!/usr/bin/env bash
# Contract-consuming worker gates. Sourced by pre-push.sh; not standalone.
# CI-equivalent lint/test/build from pr-verification.yml's affected matrix.
# `gate` and GATE_OUTDIR come from the orchestrator (resolved at call time).

# ── migrator affected lane (contract consumer).
gate_migrator() {
  gate workers/migrator pnpm exec tsc --noEmit
  gate workers/migrator pnpm run lint:oxlint
  gate workers/migrator pnpm run test
  gate workers/migrator pnpm exec wrangler deploy --dry-run --env=staging --outdir "$GATE_OUTDIR/migrator-bundle"
}
