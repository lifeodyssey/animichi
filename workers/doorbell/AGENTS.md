# workers/doorbell — AGENTS.md

TypeScript Cloudflare Worker (Hono + jose): the **Workers Builds doorbell**
(issue #1073). A GitHub Actions OIDC token (audience
`animichi:github-actions:doorbell`) starts an allowlisted Cloudflare Builds run
for this repo's own workers (`catalog`, `users`, `web`, `root`, `jobs`) and
reports that run's status. Root guide: `../../AGENTS.md`.

## Commands (from `workers/doorbell/`)

- pnpm. `pnpm run typecheck` (TypeScript 7.0.2) · `pnpm run lint:oxlint`
  (type-aware, strict, warnings denied) · `pnpm run test` / `pnpm run test:worker`
  (vitest + coverage). Never `wrangler deploy` locally (hook `block-local-deploy`).

## What this worker does

1. **Verify identity**: reads `Authorization: Bearer <github-oidc-token>`,
   verifies it with jose (RS256) against GitHub's JWKS (constructor-injected
   for tests), then enforces the claims allowlist in `src/policy.ts`
   (`DOORBELL_OIDC_POLICY`, audience `animichi:github-actions:doorbell` — never
   the migrator audience, never the staging-gate audience). One worker serves
   both rings; the OIDC environment/ref claims select staging vs production.
2. **Resolve the trigger**: the trigger id comes ONLY from the ring's committed
   trigger map (`STAGING_TRIGGER_MAP` / `PRODUCTION_TRIGGER_MAP` vars), never
   from the request. Self-publish is banned (`isBannedComponent` rejects
   `doorbell` / `doorbell-staging` before any Builds call).
3. **Gate the commit**: staging accepts the token's `sha` claim; production
   requires the release-manifest pin (SAFE-1) at that sha to equal the commit.
4. **Start + report**: POST the allowlisted Cloudflare Builds run with the
   resolved trigger id; GET its status. The worker does NOT run Wrangler or
   Pulumi. The Builds API token (`BUILDS_API_TOKEN` Secrets Store binding) is
   never echoed, and the account id comes from vars, never the request.

Capability boundary: no caller-supplied trigger ids, no caller-supplied account
ids, no schema/data access. The edge isolation contract
(`workers/edge/test/migrator-role-isolation.test.ts`) scans this worker's
wrangler.toml for Builds-token-shaped bindings only.

## Tests

TDD at the HTTP seam (plain vitest — `src/create-app.ts` stays free of fetch;
the live Builds adapter lives in `src/live-builds.ts`, excluded from
coverage). Staging, production (pin-gated), reject, status, and file-scan
isolation suites live in `test/doorbell.worker.*.test.ts`; the shared fixtures
(injected JWKS, recording Builds client, pin reader) live in
`test/doorbell.worker.helpers.ts`.
