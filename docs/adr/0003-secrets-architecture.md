# Secrets architecture: Cloudflare Secrets Store as runtime truth, Neon-hosted role passwords, Pulumi-managed roles (runtime-role ownership amended 2026-09-23)

> **Status**: accepted — records the target architecture. Implemented as of **P4 (#912 PR1/PR2,
> 2026-08-09)** for **staging**: `infra/database-access` manages Neon role passwords + Secrets
> Store DSNs; catalog/users/jobs staging Workers consume them via `wrangler.toml` Secrets Store
> bindings; `wrangler secret bulk` steps and GitHub `*_DATABASE_URL` secrets are removed from the
> staging chain; `scripts/staging-roles-login.sh` is deleted. Production still delivers
> `*_DATABASE_URL` via GitHub env secrets until the production-role cutover phase of #912. The
> migration boundary is defined in **P4 — Secrets re-architecture** of
> `docs/specs/2026-08-08-repo-closeout-spec.md`. This ADR is authoritative for the target state;
> the spec's P4 wave owns the remaining cutover.

> **Amended 2026-09-06** (#1368, card D2; owner decisions of 2026-09-05 in
> `docs/specs/2026-09-05-cicd-redesign-spec.md`). Two of this ADR's premises no longer hold and are
> rewritten below: the CI-only-values bullet (§Decision, which sent them to GitHub environment
> secrets) and the no-Pulumi-Cloud bullet (§Why, which ruled ESC out for want of an account).
> Pulumi Cloud is now the state and `secure:` encryption backend for all four stacks
> (#1077, merged as PR #1329, `815666995`), and the values CI itself consumes move to Pulumi ESC
> (#1078, PR #1330). The runtime half of this ADR is untouched (decision 12): Pulumi composes the
> DSN from the Neon role password and writes it into Cloudflare Secrets Store, and Workers read it
> through a binding. The superseding record for the platform-over-hand-written principle and the
> resulting identity boundary is `docs/adr/0006-platform-over-handwritten-ci.md`.
>
> **Amended 2026-09-23** (#1915; owner decision). The runtime-role half changes. Measured on
> staging, the three API-created runtime roles all sat in `neon_superuser`: Neon grants that
> membership to every role its Console, CLI or API creates, and only Neon's own `cloud_admin`
> can revoke it. So `infra/database-access` no longer declares them as `neon.Role` resources;
> each gets a `random.RandomPassword` from Pulumi, which composes the DSN as before and
> additionally writes the password to the Secrets Store, bound to the migrator Worker alone.
> The roles themselves are created, attributed and re-passworded by the migrator's SQL step on
> every `/migrate` (`workers/migrator/src/service-roles.ts`) — SQL-created roles receive no
> membership, which is the property this amendment buys. Role DDL still lives outside the
> migration chain (`workers/edge/test/migrator-ac3-proof.test.ts`); its owner moved from Pulumi
> to the migrator Worker (amending the 2026-09-12 database-layer spec's §4.8.5). `migrator`
> stays a `neon.Role` — the chain needs `neon_superuser`-grade power for `CREATE EXTENSION` —
> and its DSN remains bound to the migrator only. Neon roles are branch-scoped, not
> project-scoped as an earlier revision of the cutover runbook said. Rotation of a runtime role
> now runs through a new `RandomPassword` plus one `/migrate`, not a Neon-API password reset.

The skeleton-refactor campaign exposed three broken assumptions about secrets: (1) GitHub Actions secrets are a values source, not a delivery layer — the `workflow_call.secrets` shadowing bug (#826) cost three deploy cycles; (2) psql out-of-band scripts are not infrastructure (`scripts/staging-roles-login.sh` did `ALTER ROLE ... LOGIN PASSWORD` by hand); (3) the #674 ESC centralisation direction assumed a Pulumi Cloud account, which the repo does not use (self-managed R2 backend).

## Decision

Secrets are managed by the platforms that own them, provisioned and consumed as code:

- **Neon role passwords** — generated and stored by Neon. Roles are declared with Pulumi (`@pulumi/neon`, bridged from `kislerdm/terraform-provider-neon`); the password is a `/*out*/` property Neon generates. Passwords never enter git, scripts, or logs. **(Superseded for `agent_svc`/`catalog_svc`/`users_svc` by the 2026-09-23 amendment below: they are no longer `neon.Role`s — Pulumi generates a `random.RandomPassword` for each, and the migrator's SQL step owns their DDL. `migrator` remains a `neon.Role`.)**
- **Worker runtime secrets** — Cloudflare Secrets Store (account-level, open beta, 100 secrets/account). Values are written once via `wrangler secrets-store secret create` (or the REST API) and are **not readable back**; Workers consume them via a declarative binding in `wrangler.toml` (`env.<binding>.get()`).
- **Connection strings** — composed by Pulumi from `neon.Role.password` + endpoint host, and written **directly** into Cloudflare Secrets Store. No intermediate store, no Neon API round-trip, no GitHub secrets copy.
- **CI-consumed values** (the Pulumi-plane Cloudflare token, the Neon API key, the staging Access service token, the nightly eval key) **will come from Pulumi ESC** (#1078, PR #1330 — not merged as of 2026-09-06; `cd.yml` still reads them from GitHub environment secrets), opened per job by `pulumi/esc-action` after `pulumi/auth-actions` exchanges the job's GitHub OIDC identity for a short-lived Pulumi token. Each job is to open only its own stage's environment (`lifeodyssey/animichi/staging` or `…/prod`) — the amendment to #1078's contract (b)/(c). Secrets Store values are not readable back, so a CI-consumed value cannot live there either way; ESC is the readable-back store. Emptying `gh secret list` in all three scopes is the acceptance target of D1 (#1367), not today's state.

## Why

- **No second IaC stack**: the repo is Pulumi; Neon roles via the bridged provider stay in Pulumi TypeScript.
- **Two stores, split by who reads the value**: Cloudflare Secrets Store is native to the account the Workers already run in, so it stays the runtime truth (write-only, read through a binding); Pulumi ESC holds what CI has to read back, and Pulumi Cloud — now the backend for all four stacks (#1077) — is what makes ESC available. Neither replaces the other.
- **No out-of-band DB operations**: role DDL moves from psql scripts into Pulumi **(superseded for the three runtime roles by the 2026-09-23 amendment: their DDL moved to the migrator's SQL step; only `migrator` stays Pulumi-declared)**; schema/GRANTs stay in Atlas migrations (`IF NOT EXISTS` guards make both idempotent).
- **Shrinks the GitHub secrets surface**: the DATABASE_URL delivery chain (`wrangler secret bulk` from GitHub secrets) disappears; Workers read bindings instead.

## Consequences

- New `infra/` module: a `neon` Pulumi stack declaring `neon.Role` ×4 (catalog_svc, agent_svc, users_svc, jobs_svc) with passwords; exports connection strings as stack outputs (secret-marked). **(Superseded for `catalog_svc`/`agent_svc`/`users_svc` by the 2026-09-23 amendment: one `neon.Role` remains, `migrator`; the runtime roles are SQL-created and carry Pulumi-generated `random.RandomPassword`s.)**
- `wrangler.toml` gains Secrets Store bindings for the worker packages; `wrangler secret bulk` steps and GitHub `*_DATABASE_URL` secrets are removed (Phase 5 of #674, adapted).
- `scripts/staging-roles-login.sh` is deleted; its `--set-secrets` job is replaced by the Pulumi stack.
- Atlas migrations keep `CREATE ROLE IF NOT EXISTS` (idempotent) and all GRANTs; role LOGIN state is driven by the Pulumi-managed role (Neon sets password → role is login-capable). **(Superseded for the runtime roles by the 2026-09-23 amendment: the migrator's SQL step drives their LOGIN state and passwords; what remains of the chain's role work here is the precheck.)**
- Rotation: Neon role password → recreate/rotate via Pulumi; Secrets Store value → update binding-backed secret (Workers pick up next deploy). **(Superseded for the runtime roles by the 2026-09-23 amendment: rotation is a new `random.RandomPassword` plus one `/migrate`; `migrator` still rotates through Pulumi.)**
- Supersedes: the #674 ESC-first plan for worker DSNs — worker DSNs stay in Secrets Store. ESC is no longer hypothetical: a Pulumi Cloud organization (`lifeodyssey`, individual edition) was adopted in #1077, and ESC is where CI-consumed values live from #1078 on. The context paragraph above describes the 2026-08 situation, not the current one.
