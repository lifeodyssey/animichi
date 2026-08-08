# Secrets architecture: Cloudflare Secrets Store as runtime truth, Neon-hosted role passwords, Pulumi-managed roles

The skeleton-refactor campaign exposed three broken assumptions about secrets: (1) GitHub Actions secrets are a values source, not a delivery layer — the `workflow_call.secrets` shadowing bug (#826) cost three deploy cycles; (2) psql out-of-band scripts are not infrastructure (`scripts/staging-roles-login.sh` did `ALTER ROLE ... LOGIN PASSWORD` by hand); (3) the #674 ESC centralisation direction assumed a Pulumi Cloud account, which the repo does not use (self-managed R2 backend).

## Decision

Secrets are managed by the platforms that own them, provisioned and consumed as code:

- **Neon role passwords** — generated and stored by Neon. Roles are declared with Pulumi (`@pulumi/neon`, bridged from `kislerdm/terraform-provider-neon`); the password is a `/*out*/` property Neon generates. Passwords never enter git, scripts, or logs.
- **Worker runtime secrets** — Cloudflare Secrets Store (account-level, open beta, 100 secrets/account). Values are written once via `wrangler secrets-store secret create` (or the REST API) and are **not readable back**; Workers consume them via a declarative binding in `wrangler.toml` (`env.<binding>.get()`).
- **Connection strings** — composed by Pulumi from `neon.Role.password` + endpoint host, and written **directly** into Cloudflare Secrets Store. No intermediate store, no Neon API round-trip, no GitHub secrets copy.
- **CI-only values** (e.g. `STAGING_GATE_TOKEN`, needed by the smoke step as a request header) stay in GitHub environment secrets — Secrets Store values are not readable back, so a CI-consumed value cannot live there.

## Why

- **No second IaC stack**: the repo is Pulumi; Neon roles via the bridged provider stay in Pulumi TypeScript.
- **No Pulumi Cloud dependency**: ESC requires a Pulumi Cloud account; Cloudflare Secrets Store is native to the account we already use.
- **No out-of-band DB operations**: role DDL moves from psql scripts into Pulumi; schema/GRANTs stay in Atlas migrations (`IF NOT EXISTS` guards make both idempotent).
- **Shrinks the GitHub secrets surface**: the DATABASE_URL delivery chain (`wrangler secret bulk` from GitHub secrets) disappears; Workers read bindings instead.

## Consequences

- New `infra/` module: a `neon` Pulumi stack declaring `neon.Role` ×4 (catalog_svc, agent_svc, users_svc, jobs_svc) with passwords; exports connection strings as stack outputs (secret-marked).
- `wrangler.toml` gains Secrets Store bindings for the worker packages; `wrangler secret bulk` steps and GitHub `*_DATABASE_URL` secrets are removed (Phase 5 of #674, adapted).
- `scripts/staging-roles-login.sh` is deleted; its `--set-secrets` job is replaced by the Pulumi stack.
- Atlas migrations keep `CREATE ROLE IF NOT EXISTS` (idempotent) and all GRANTs; role LOGIN state is driven by the Pulumi-managed role (Neon sets password → role is login-capable).
- Rotation: Neon role password → recreate/rotate via Pulumi; Secrets Store value → update binding-backed secret (Workers pick up next deploy).
- Supersedes: the #674 ESC-first plan for worker DSNs; ESC remains an option if a Pulumi Cloud account is ever adopted.
