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
- **`pulumi stack export` runs unmodified before every `pulumi up`** (rollback backup, #485;
  `_deploy-component.yml`'s "Pulumi stack export" step), then is copied to the **R2 bucket the
  Pulumi state backend already lives in** (`rollback-backups/` prefix) via `aws s3 cp` — deliberately
  **not** a GitHub Actions artifact, because this repo is **public**: a public repo's workflow
  artifacts are downloadable by any signed-in GitHub account, not just people with repo access. It is
  **never** run with `--show-secrets` — encrypted `secure:` config must stay ciphertext in that
  export. Any new sensitive value added to `index.ts`/the stack configs MUST go through
  `config.requireSecret()` / `getSecret()` (see `pulumi-best-practices` skill §5), never a plain
  `config.require()` or a literal — a value that isn't marked secret is exported in the clear into
  that R2 object. The R2 bucket is only as private as the R2 credentials that already gate the
  Pulumi state itself; keeping the backup there (not GitHub artifacts) is what keeps that true for
  the backup too.
- No lifecycle/expiry rule exists yet on the `rollback-backups/` R2 prefix — objects accumulate
  indefinitely. Adding one is a Pulumi resource change (`index.ts`), not a CI change; tracked as
  **#521**.
