# Production least-privilege DSN cutover (runbook)

**Ticket:** [#855](https://github.com/lifeodyssey/animichi/issues/855) · **Parent:** [#829](https://github.com/lifeodyssey/animichi/issues/829) · **Campaign:** [#904](https://github.com/lifeodyssey/animichi/issues/904) P5 (#913)
**Precedent:** staging cutover [#832](https://github.com/lifeodyssey/animichi/issues/832) (closed) · **Secrets ADR:** `docs/adr/0003-secrets-architecture.md` · **Env map:** `docs/ops/neon-env-topology.md`

## Current state (investigated for #913)

- **Production is an empty data plane**: the production Neon branch (`main` compute) has
  **no tables in `public`** (confirmed during the #846 spike — `public` is empty; the only
  object is an orphaned `atlas_schema_revisions` schema on some envs, see
  `reusable-deploy-component.yml` "Atlas schema drift" note). Nothing reads or writes prod
  today, so the cutover has **zero traffic risk** — the first Atlas apply *creates* the schema.
- Prod runtime DSNs today come from **GitHub environment secrets** (`NEON_DATABASE_URL` owner
  DSN + `CATALOG_DATABASE_URL` / `USERS_DATABASE_URL` / `AGENT_DATABASE_URL`), injected by
  `reusable-deploy-component.yml` (`wrangler secret put`). This is exactly the P4 target state
  that staging is being migrated away from (ADR 0003; P4 = #912).
- **Roles are Neon-project-scoped, not branch-scoped**; GRANTs are branch/schema-scoped and
  shipped as Atlas migrations. The role matrix lives in
  `migrations/neon/20260809000001_roles.sql` + `20260809000030_grants.sql`:
  `catalog_svc` · `agent_svc` · `users_svc` · `jobs_svc` · `readonly` (all `NOLOGIN` in Atlas;
  LOGIN state comes from Pulumi `neon.Role`, which also owns the password).

## Target

- Runtime DSNs for catalog / agent / users / jobs are **role-scoped** (never owner/migrator).
- **Migrator/owner DSN** exists only for Atlas apply (deploy workflow, production approval gate).
- Roles built by **Pulumi** (`neon.Role` ×4, passwords Neon-generated), connection strings
  composed by Pulumi and written **once** to the **Cloudflare Secrets Store** (not readable
  back); Workers bind Secrets Store values (`wrangler.toml` bindings — P4 shape).
- Schema + GRANTs applied by **Atlas** via the deploy path (`search_path=public`).

## Cutover steps (owner window, HITL — mirror #832)

1. **Prereq: P4 green and stable on staging** (#912: roles exist project-wide once Pulumi ran;
   verify the Pulumi prod stack config points at the same Neon project and reuses the same
   role names — import, do not recreate, if the stack otherwise diverges).
2. **Pulumi prod stack up** (`reusable-deploy-component` prod lane / owner-approved apply):
   confirms prod roles, composes prod DSNs (main-branch endpoint), writes them to the
   **Secrets Store** for the prod environment. Verify with the deploy report hash row.
3. **First prod Atlas apply** (deploy workflow, `production` environment approval): creates the
   schema in the empty `public` + applies `*_grants.sql` GRANTs. Empty data plane ⇒ this is a
   pure creation, nothing to preserve; soft-baseline decision for the future history squash
   stays per #845/#849.
4. **Flip Workers to Secrets Store bindings for prod** (wrangler.toml bindings land in P4;
   the prod deploy picks them up next deploy). Until then, old GitHub-secret DSNs keep working
   unchanged — the two planes coexist; do not delete old secrets before this step is verified.
5. **Remove GitHub `*_DATABASE_URL` secrets for prod** once no workflow references them
   (post-P4 code state, `needs`/`env` maps cleaned). Zero `*_DATABASE_URL` GitHub secrets is the
   P4 acceptance condition.
6. **Negative permission checks on prod** (record redacted on #855): catalog role cannot write a
   users-owned table; users role cannot write points; jobs cannot DDL; migrator-only DDL via a
   second connection as `jobs_svc` must fail.
7. **Update `docs/ops/neon-env-topology.md` + `docs/ops/secrets.md`** with the prod secret
   matrix (which secret → which role → which consumer).

## Rollback path

- **Order is the reverse of cutover, and roles are never dropped** (additive only):
  1. Re-point Workers at the previous secrets plane: re-set the GitHub environment secrets
     (`NEON_DATABASE_URL` etc. — values unchanged in GitHub until step 5) and redeploy; the
     Secrets Store binding value stays but is superseded by the explicit secret in the env map
     until P4's env-map removal is reverted.
  2. Secrets Store value rotation/repair: Pulumi rotates the `neon.Role` password (Neon
     regenerates; rotation path per ADR 0003) → re-write Secrets Store → redeploy Workers.
  3. **Data**: Neon PITR / backup window (runbook `docs/ops/neon-backup-rpo.md`); with an
     empty pre-cutover data plane there is nothing to restore from the cutover itself — PITR
     only matters for post-cutover prod data.
  4. Migration rollback: `atlas migrate` down is not a routine path (revisions are forward-only
     in this repo); bad-migration recovery is the HITL checklist in `docs/ops/neon-backup-rpo.md`.
- **No wipe**: production is no-wipe by policy (`docs/ops/neon-env-topology.md`), cutover
  included.

## Who does what

| Actor | Action |
|---|---|
| Agent (this PR / #855 prep) | Documents steps, prepares scripts/docs, records redacted evidence |
| Owner | Prod window approval; Secrets Store value write verification (once, not readable back); Pulumi prod apply approval |
| CI deploy | Pulumi prod `up` + Atlas apply via the `production` environment approval gate |
