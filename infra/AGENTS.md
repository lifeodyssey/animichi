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

- State backend is Cloudflare R2 through `PULUMI_BACKEND_URL` and R2 S3 credentials.
- `Pulumi.yaml` defines the project; `Pulumi.staging.yaml` and `Pulumi.prod.yaml` hold per-environment
  config. Secrets remain encrypted `secure:` values or CI/ESC inputs.
- `index.ts` derives names from `pulumi.getStack()`; prod uses stable names, other stacks suffix
  resource names.
- Routes belong to Pulumi; Worker implementation and service bindings belong to Wrangler.

## Key files + entrypoints

- `index.ts` — R2 media bucket, optional web/edge routes, exported catalog DB secret.
- `Pulumi.yaml` — project metadata and base encrypted config.
- `Pulumi.staging.yaml` · `Pulumi.prod.yaml` — live environment stacks.
- `../.github/workflows/_deploy-component.yml` — Pulumi `up` and Worker deploy sequence.
- `../docs/ops/deployment.md` — environment and approval runbook.

## Pitfalls

- Never run a production apply without explicit user approval; CI's `production` environment is the
  mandatory human gate.
- `webRoutesEnabled` defaults false. Enabling it is the route cutover and requires zone/domain
  config; do not flip it as routine cleanup.
- No Hyperdrive: catalog reaches Neon over `@neondatabase/serverless` HTTP.
