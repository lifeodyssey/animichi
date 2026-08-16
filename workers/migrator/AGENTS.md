# workers/migrator — AGENTS.md

TypeScript Cloudflare Worker + one-shot batch container: the **migration
executor** (spec `docs/specs/2026-08-16-migration-executor-spec.md`, issue
#1051). A request authenticated by a GitHub Actions OIDC token starts a
one-shot Atlas batch container that applies the committed Neon migration
chain; the worker returns success + the applied head. Staging first;
production is #1055. Root guide: `../../AGENTS.md`.

## Commands (from `workers/migrator/`)

- pnpm. `pnpm run typecheck` (TypeScript 7.0.2) · `pnpm run lint:oxlint`
  (type-aware, strict, warnings denied) · `pnpm run test` / `pnpm run test:worker`
  (vitest + coverage). Never `wrangler deploy` locally (hook `block-local-deploy`).

## What this worker does

1. **Verify identity**: reads `Authorization: Bearer <github-oidc-token>`,
   verifies it with jose (RS256) against GitHub's JWKS (constructor-injected
   for tests), then enforces the per-environment-anchored claims allowlist
   (MED-2): staging = `ref == refs/heads/main` AND `environment == staging`,
   repository == `lifeodyssey/animichi`, and
   `workflow_ref/job_workflow_ref` in the trusted deploy workflows. The
   audience is the fixed `animichi:github-actions:migrator`, DISTINCT from the
   staging-gate verifier audience (#1054). The reusable verifier lives in
   `packages/contract/src/oidc-github.ts` (`@animichi/contract/oidc-github`).
2. **Run the container**: starts the `MigrationContainer` Durable Object
   (batch-job mode; no ports) with `MIGRATOR_DATABASE_URL` injected as env,
   waits for `stopped_with_code`, reports the exit code.
3. **Report**: on exit 0, reads the applied head from
   `public.atlas_schema_revisions` (`src/ledger.ts`) and returns it. CI
   fails unless applied head == expected head.

Capability boundary: NO destructive path — no schema drop, no arbitrary SQL,
no down-migration. The migrator role's DSN is injected only for the seconds
the container runs (non-resident); `workers/edge/test/migrator-role-isolation.test.ts`
asserts it is not bound by any runtime worker.

## Tests

TDD at the HTTP seam (`test/migrate.worker.auth.test.ts`): valid test-signed JWT →
container started + success + applied head; wrong repo / wrong audience /
expired → 403; non-zero container exit → failure; hung container → 504. The
container binding is faked and the JWKS injected (plain vitest — `create-app.ts`
stays free of `@cloudflare/containers`, whose ESM build needs workerd). The
container image build + staging deploy are CI-verified.
