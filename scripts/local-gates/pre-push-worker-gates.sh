#!/usr/bin/env bash
# Contract-consuming worker gates. Sourced by pre-push.sh; not standalone.
# CI-equivalent lint/test/build from pipeline-migrator.yml / pipeline-doorbell.yml.
# `gate` and GATE_OUTDIR come from the orchestrator (resolved at call time).

# ── migrator: pipeline-migrator.yml lint/test/build (contract consumer).
gate_migrator() {
  gate workers/migrator pnpm exec tsc --noEmit
  gate workers/migrator pnpm run lint:oxlint
  gate workers/migrator pnpm run test
  gate workers/migrator pnpm exec wrangler deploy --dry-run --env=staging --outdir "$GATE_OUTDIR/migrator-bundle"
}

# ── doorbell: pipeline-doorbell.yml lint/test/build (contract consumer).
gate_doorbell() {
  gate workers/doorbell pnpm exec tsc --noEmit
  gate workers/doorbell pnpm run lint:oxlint
  gate workers/doorbell pnpm run test
  gate workers/doorbell pnpm exec wrangler deploy --dry-run --env=staging --outdir "$GATE_OUTDIR/doorbell-bundle"
}
