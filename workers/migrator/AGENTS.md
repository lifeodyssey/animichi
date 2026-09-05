# workers/migrator — AGENTS.md

TypeScript Cloudflare Worker: the **migration executor** (spec
`docs/specs/2026-08-16-migration-executor-spec.md`, issue #1051; Option 2
connectivity spec / #1124). A request authenticated by a GitHub Actions OIDC
token applies the committed Neon Atlas chain over neon-http and returns
success + the applied head. Staging first; production is #1055. Root guide:
`../../AGENTS.md`.

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
2. **Apply the chain over neon-http (#1124)**: after OIDC, a fixed-name
   Durable Object mutex (`migrator-apply-lock`, not `migrator-job-*`)
   serializes apply. The Worker executes committed `migrations/neon` files
   (compile-time Text modules + `atlas.sum` order) via
   `@neondatabase/serverless`, writes `public.atlas_schema_revisions` with
   Atlas v0.30 version/hash semantics (`operator_version =
   animichi-http-apply/0.30.0`), and skips already-applied versions. The
   revision row rides in the file's own transaction (#1338), so no crash can
   leave a file applied and its ledger row missing. `CREATE INDEX
   CONCURRENTLY` files cannot be transactional; on that path alone the window
   is inherent, so a duplicate-object error (`42P07`) is read as
   already-applied — but only for a version the ledger holds no attempt at
   under a different hash — and the re-run finishes the file instead of
   wedging the chain. A `-pooler` DSN is rejected before SQL. SQL is never taken from the
   request body (OIDC + optional `{expectedHead?}` only). The batch
   container classes stay until staging proof; `POST /migrate` no longer
   starts them. Tests may inject `runContainer` (including unknown_exit
   ledger judgment).
3. **Report**: returns success + applied head from
   `public.atlas_schema_revisions` (`src/ledger.ts`) + `pathVerification`.
   CI fails unless applied head == expected head; it does not gate on
   `pathVerification`. The applied head is visible **only** through this
   OIDC-authenticated response: #1339 removed the anonymous `GET /ledger-head`
   route (it resolved the DDL-capable DSN on every anonymous hit of a public
   `workers_dev` host and had no caller), and `test/migrate.worker.http.test.ts`
   pins the 404. The post-staging smoke (#1198,
   `.github/scripts/staging-smoke-check.sh`) probes the edge and the web shell,
   not the head; if it is ever extended to assert the applied head, it must read
   a short-TTL value written at apply time (KV / DO storage), never a live DSN
   read.

Capability boundary: NO destructive path — no schema drop, no arbitrary SQL,
no down-migration. The migrator DSN is Secrets Store only (non-resident);
`workers/edge/test/migrator-role-isolation.test.ts` asserts it is not bound
by any runtime worker.

## Tests

TDD at the HTTP seam (`test/migrate.worker.auth.test.ts` +
`test/migrate.worker.http.test.ts` + `test/http-apply*.test.ts`): valid
test-signed JWT → apply + success + applied head; wrong repo / wrong audience /
expired → 403; HTTP apply of a fixture chain against a fake `neon()`;
`-pooler` rejected before SQL; fake-lock concurrency; hung-container injection
→ 504. The container binding is faked and the JWKS injected (plain vitest —
`create-app.ts` stays free of `@cloudflare/containers`). The container image
build + staging deploy are CI-verified.
