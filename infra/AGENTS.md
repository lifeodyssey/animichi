# infra — AGENTS.md

Pulumi TypeScript IaC for Cloudflare R2 and optional Worker route topology. Worker code and deploy
bindings remain in Wrangler; route ownership stays here. Root guide: `../AGENTS.md`.

## Commands (from `infra/`)

- `pulumi preview --stack staging` — preview against `Pulumi.staging.yaml`.
- `pulumi preview --stack prod` — preview against `Pulumi.prod.yaml`.
- `pulumi up --stack staging` — apply the staging stack; normal delivery runs this through CI.
- Production apply is CI-only: the deploy workflow runs Pulumi `up` with stack `prod` after the
  GitHub `production` environment approval.

## Conventions

- Staging state backend is Pulumi Cloud (GitHub OIDC via `pulumi/auth-actions`). Production
  catalog still applies the main stack against the R2 DIY backend until that path is split.
- `Pulumi.yaml` defines the project; `Pulumi.staging.yaml` and `Pulumi.prod.yaml` hold per-environment
  config. Secrets remain encrypted `secure:` values or CI/ESC inputs.
- `index.ts` derives names from `pulumi.getStack()`; prod uses stable names, other stacks suffix
  resource names.
- Routes belong to Pulumi; Worker implementation and service bindings belong to Wrangler.

## Key files + entrypoints

- `index.ts` — R2 media bucket, flag-gated web Custom Domains, edge routes, www redirect, staging WAF gate, exported catalog DB secret, and the Neon Auth staging declarations (JWKS/issuer derivation + QA login, AUTH-2 #950).
- `src/neon-auth.ts` — pure Neon Auth derivation (JWKS URL ↔ issuer base URL, env-var names); pinned by `topology-neon-auth.test.ts`.
- `Pulumi.yaml` — project metadata and base encrypted config.
- `Pulumi.staging.yaml` · `Pulumi.prod.yaml` — live environment stacks.
- `../.github/workflows/reusable-deploy-infra.yml` — staging main-stack Pulumi `up` (Pulumi Cloud).
- `../.github/workflows/reusable-deploy-component.yml` — Worker deploy sequence.
- `../docs/ops/deployment.md` — environment and approval runbook.

## Pitfalls

- Never run a production apply without explicit user approval; CI's `production` environment is the
  mandatory human gate.
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
- Staging infra no longer writes an R2 `pulumi stack export` backup (#1077); rollback is Pulumi
  Cloud history. Production catalog still exports to R2 before `up` in
  `reusable-deploy-component.yml`. New sensitive values still go through `config.requireSecret()` /
  `getSecret()` (see `pulumi-best-practices` skill §5).
- No lifecycle/expiry rule exists yet on the leftover `rollback-backups/` R2 prefix — objects
  accumulate indefinitely. Adding one is a Pulumi resource change (`index.ts`), not a CI change;
  tracked as **#521**.
