# infra — AGENTS.md

Pulumi TypeScript IaC for Cloudflare R2 and optional Worker route topology. Worker code and deploy
bindings remain in Wrangler; route ownership stays here. Root guide: `../AGENTS.md`.

## Commands (from `infra/`)

- `pulumi preview --stack lifeodyssey/staging` — preview against `Pulumi.staging.yaml`.
- `pulumi preview --stack lifeodyssey/prod` — preview against `Pulumi.prod.yaml`.
- `pulumi up --stack lifeodyssey/staging` — apply the staging stack; normal delivery runs this through CI.
- Production apply is CI-only: the deploy workflow runs Pulumi `up` with stack `prod` after the
  GitHub `production` environment approval.

## Conventions

- State and `secure:` encryption live in **Pulumi Cloud**, org `lifeodyssey`, declared by `backend.url`
  in each `Pulumi.yaml` (#1077). CI logs in with `pulumi/auth-actions` (GitHub OIDC → short-lived
  organization token); there is no Pulumi access token, backend URL, R2 state key pair, or config
  passphrase on the delivery lane. Applies are org-qualified: `pulumi up --stack lifeodyssey/<stack>`.
  The one exception is `scripts/local-gates/infra-check.sh`, whose credential-free program-load
  preflight sets `PULUMI_BACKEND_URL` to a throwaway `file://` backend and never reads real state —
  that env var takes precedence over `backend.url` (measured on the pinned Pulumi 3.255.0).
- `Pulumi.yaml` defines the project; `Pulumi.staging.yaml` and `Pulumi.prod.yaml` hold per-environment
  config. Secrets remain encrypted `secure:` values or CI/ESC inputs.
- `index.ts` derives names from `pulumi.getStack()`; prod uses stable names, other stacks suffix
  resource names.
- Routes belong to Pulumi; Worker implementation and service bindings belong to Wrangler.

## Key files + entrypoints

- `index.ts` — R2 media bucket, flag-gated web Custom Domains, edge routes, www redirect, staging WAF gate, exported catalog DB secret, and the Neon Auth staging declarations (JWKS/issuer derivation + QA login, AUTH-2 #950).
- `database-access/` — database roles, per-service DSNs, and Auth access material. Its Pulumi project name remains the stable persisted state identity until an explicit cross-project stack migration.
- `src/neon-auth.ts` — pure Neon Auth derivation (JWKS URL ↔ issuer base URL, env-var names); pinned by `topology-neon-auth.test.ts`.
- `Pulumi.yaml` — project metadata and base encrypted config.
- `Pulumi.staging.yaml` · `Pulumi.prod.yaml` — live environment stacks.
- `../.github/workflows/cd.yml` — main-only affected release cohort and production approval.
- `../.github/actions/build-release-unit/action.yml` — immutable release payload builder.
- `../.github/actions/promote-release-phase/action.yml` — ordered staging phase promotion.
- `../docs/ops/deployment.md` — environment and approval runbook.

## Pitfalls

- Never run a production apply outside CD; its single `production` environment approval is the
  mandatory human gate after the complete affected cohort reaches staging.
- `webRoutesEnabled` defaults false. **Flipping it publishes the site**, and does so atomically on
  purpose: the Custom Domain and the narrowed `/v1/*`, `/img/*`, `/healthz` edge routes appear
  together. Splitting them is the bug this gate exists to prevent — a hostname that resolves before
  its routes are narrowed answers a browser navigation with the edge Worker's JSON 404. Every stack
  gets the same Custom-Domain-plus-three-routes shape (staging included: `apps/web` calls `/v1/*`
  relative to its own origin, so a staging hostname pointed wholly at the web Worker has no chat).
  Prod additionally gets the www placeholder and redirect, and so requires `wwwDomain` on top of
  `cloudflareZoneId` + `webDomain`; other stacks require `cloudflareZoneId` + `stagingDomain`.
  Do not flip it as routine cleanup.
- `stagingGateEnabled` defaults false. Enabling it requires `stagingDomain` and the
  `stagingGateToken` secret.
- No Hyperdrive: catalog reaches Neon over `@neondatabase/serverless` HTTP.
- **The pre-apply `pulumi stack export` rollback backup is retired** (#485 → #1077). Pulumi Cloud's
  own update history is the rollback record, so CD no longer copies a state snapshot into the R2
  bucket before every `pulumi up`. Nothing writes to that `rollback-backups/` prefix any more, so
  #521 (no lifecycle rule on it) stops growing; the already-accumulated objects are the owner's to
  delete when the R2 state bucket itself is retired. **Marking secrets still matters**: any sensitive
  value in `index.ts` or the stack configs MUST go through `config.requireSecret()` / `getSecret()`
  (see the `pulumi-best-practices` skill §5), never a plain `config.require()` or a literal. An
  unmarked value is stored in the clear in Pulumi Cloud state and comes out in the clear in any
  `pulumi stack export` an operator takes. Never run an export with `--show-secrets`, and never put
  a state export in a GitHub Actions artifact — this repo is public, and a public repo's artifacts
  are downloadable by any signed-in GitHub account.
