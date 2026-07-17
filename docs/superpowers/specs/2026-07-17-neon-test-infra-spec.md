# Neon Test Infrastructure — testcontainers + Neon Local replaces supabase-start / raw Docker-Postgres for DB-backed tests

- **Status:** Draft v4.1 (v4 = the owner-driven Neon Local re-scope; round-3 dual review of v4 — Fable + Codex xhigh, both request-changes, high convergence, architecture validated — closed here. **Last paper round: after v4.1 the lead spot-verifies and the Phase-0 gating spike becomes the real validator.**)
- **Date:** 2026-07-17
- **Decision of record (reconciled owner requirements, 2026-07-17):** (1) **automated tests use TESTCONTAINERS, local AND CI**; (2) **the test database is NEON, not raw Postgres**; (3) **"staging 就是测试的"** — no separate test project; test branches live beside `staging` in the existing project. The three are reconciled by **Neon Local** (official `neondatabase/neon_local` image, §3a): a testcontainers-managed proxy container whose start auto-creates an ephemeral cloud branch and whose stop auto-deletes it. This still executes the ratified environment matrix of `docs/superpowers/specs/2026-06-23-multi-env-neon-supabase-design.md` §4 (dev/CI = Neon branch; `supabase start` retained only for the magic-link flow); "staging = testing" holds at the ENVIRONMENT level — deployed-app testing on staging — while the fixture branches here are the disposable DB copies underneath, in the same project.
- **Base & ordering (HARD DEPENDENCY):** base = **`feat/frontend-rebuild` AFTER PR #347 merges** — this series starts only once #347 lands (#349 is already merged into the n1 stack; #347 is the imminent stack head). Every surface this spec cites exists on THAT base and NOT all of them on `main`: the 13 spike files, the 13 integration-test files, the 5 atlas migrations (incl. the 2.6 MB gazetteer), ci.yml's `migrations:` changes-filter, `preview.yml`, `workers/users`, the 82% coverage floor, and the `route_anime` supabase migration + persistence test — the last two are **inherited base content**, so the v2/v3 "cross-PR content coupling" machinery is gone; what remains is Phase A's job to add the missing **atlas twin** (§3b). The evidence worktree (`feat/agent-redesign-phase0-security` @ `3eed9b6`) is a member of that stack and reflects the post-#347 world.
- **Implementer:** Codex, phase-by-phase. Dependency graph: **0 → A → C → D; 0 → B → C(spike job)**; A ∥ B after 0; **Phase 0 delivers `test-base` + the provisioning script** (A and B consume them). Phase 0 is GATING — its findings confirm or amend §3c/§3d/§3f before implementation proceeds.
- **Evidence base:** worktree @ `3eed9b6`, all file:line references re-verified through the v2/v3/v4.1 rounds. Neon Local semantics from the official docs: https://neon.com/docs/local/neon-local (env vars, connection strings, both-drivers support, branch lifecycle, self-signed local TLS), with https://neon.com/blog/docker-compose-neon-branches-testing and https://neon.com/guides/neon-local-docker-compose-javascript as usage references; plan/quota semantics: https://neon.com/pricing (Phase 0 pins the actual behavior).

## 1. TL;DR

There are **three distinct DB-test substrates today, not one**:

1. **Agent Python integration + eval tests** → testcontainers Docker Postgres (`postgis/postgis:16-3.4`), session-scoped container (`apps/agent/agent/tests/conftest_db.py:177-184`). The client is already pure PG-wire asyncpg (`integration/conftest.py:45-54`); auth is faked via `X-User-Id` headers (`integration/conftest.py:213-218`) — no GoTrue anywhere. Schema comes from `supabase/migrations/*.sql` applied statement-by-statement with **failures swallowed** (`conftest_db.py:149-154`) and **pgvector neutralized** (`vector(N)→TEXT`, HNSW dropped, `conftest_db.py:38-96`) because no maintained image ships PostGIS+pgvector together.
2. **Catalog TS spike suite** → 13 files, each `execSync docker run` its own PostGIS container with DDL marker-sliced out of `supabase/migrations` (`vitest.spike.config.ts`; e.g. `test/db.spike.test.ts:27-53`). **8 of 13 are broken** since Wave 2 swapped `makeDb` to the HTTP-only neon-http driver (`workers/catalog/src/db/client.ts:11-14`). `npm test` in catalog runs BOTH suites (`workers/catalog/package.json:12`), so the local catalog test script is broken today (CI runs `test:worker` alone, `_ts-ci.yml:47-48`).
3. **`supabase start` full stack** → consumed only by `make dev-local` (Makefile:141-180) and the e2e magic-link flow (`scripts/e2e-setup.sh`, `e2e/auth-flow-local.spec.ts`, GoTrue + `send-auth-email` Edge Function + Mailpit).

**The switch (v4):** substrates 1 and 2 keep their **testcontainers shape** but the DEFAULT container becomes **Neon Local** (`neondatabase/neon_local`): container start = an ephemeral **cloud** branch forked from a golden `test-base` parent (atlas schema + seed, §3b); container stop = branch auto-deleted; the suite connects to a LOCAL endpoint with static non-secret credentials (`postgres://neon:npg@localhost:5432/<db>?sslmode=require`). One container serves BOTH drivers: asyncpg over the postgres wire, and `@neondatabase/serverless` over local HTTP (`neonConfig.fetchEndpoint`) — **exactly the driver whose incompatibility with raw local PG broke the 8 spikes**. Scope honesty: "default" means the Neon Local arm — a BYO `TEST_DATABASE_URL` bypass and an offline `TEST_DB=docker` arm exist by design (§3c truth table), and the e2e magic-link flow stays on `supabase start` (§3e). Substrate 3 is retired only by the Neon Auth track.

**What this buys:** the pgvector neutralization + swallow-failures loop **die** (the branch has real postgis+pgcrypto+vector from the atlas baseline `db/migrations/20260623000001_init.sql:14-16` — byte-identical to `supabase/neon/0001_init.sql`, diff-verified — HNSW :296); the 8 broken spikes are fixed **natively**; integration tests enter CI for the first time (`_python-ci.yml:63-64` runs unit only) with **zero CI branch-lifecycle YAML** — the container manages the branch, so v3's create-branch-action/expires_at/sweeper/guard-library apparatus evaporates (a stray-cleanup note survives only if Phase 0 finds unclean exits orphan branches); and the two-schema-source problem collapses to `db/migrations`.

## 2. Problem statement

- **No env hook, wrong schema source (substrate 1).** `db_pool`/`tc_db`/`real_db` all chain off `pg_container` (`conftest_db.py:177-215`, `integration/conftest.py:46`); there is no way to point the suite at any external database. The schema is `supabase/migrations` filtered through `_filter_migration_lines`/`_skip_vector_statements`/`_apply_migrations_sync`. The conftest's own comment concedes real pgvector is "validated in CD against a real Neon PR-branch database" (`conftest_db.py:49-51`). The standalone eval runner is a **separate consumer**: `make test-eval-fullstack` (Makefile:72-73) invokes `python -m agent.tests.eval.run_agent_eval`, whose `_db_url()` reads `SUPABASE_DB_URL` with a hardcoded `localhost:54322` fallback (`run_agent_eval.py:129-133`) — no pytest fixtures involved.
- **Latency moves from per-POOL to per-QUERY (the v4-specific risk).** Today every query is sub-ms local. Through Neon Local, every query is a **cloud round trip**. ~59 DB-bound tests (13 integration files, ~80 test functions, 2 files remote-API-gated at `test_e2e_smoke.py:24` / `test_frontend_contracts.py:21`) × N queries × RTT — not tunable by pool scoping. **Phase 0 measures it and gates the arm-default decision (§3a/§4).**
- **Spikes are dead code walking (substrate 2).** The 8 `makeDb` spikes cannot run against ANY raw local Postgres again; only `postgis.spike.test.ts` and `resolve-api.spike.test.ts` survive via node-postgres. `resolve-api.spike.test.ts:18` already reads the atlas baseline (consumed at :65) — the target schema source. Neon Local's serverless mode is the first way `makeDb` can work in a local test at all.
- **Already-broken adjacent config (same surface, bundled):** `workers/catalog/.dev.vars.example:6` + `workers/users/.dev.vars.example:2` point `wrangler dev` at `localhost:54322` — impossible for neon-http; **the fix for the WORKERS is a standing cloud dev-branch DSN, not Neon Local** (§3g — neon-http works natively against the cloud, and the local-proxy path would require `neonConfig` edits in `src/`, which this spec bans). Also: `scripts/e2e-setup.sh:23` seeds from `agent/tests/fixtures/seed.sql` (missing `apps/` prefix); `.pre-commit-config.yaml:76` hardcodes a supabase-local DSN into the pre-push **unit** hook (unit tests never connect; the var only satisfies `settings.py:219-220`); `.claude/skills/e2e/SKILL.md:62` carries the pre-monorepo seed path.

## 3. Target design

### 3a. The enabler — Neon Local, and the Phase-0 gate

**Official semantics (https://neon.com/docs/local/neon-local):** image `neondatabase/neon_local:latest`; required env `NEON_API_KEY` + `NEON_PROJECT_ID`; **`PARENT_BRANCH_ID` selects the fork parent BY ID** (defaults to the project default branch — we always pass the `test-base` branch id, resolved as in §7); container start **instantly creates** the ephemeral branch, container stop **deletes** it (`DELETE_BRANCH` default `true`); `BRANCH_ID` instead connects to an EXISTING branch without deletion (persistent mode). Local endpoint: `postgres://neon:npg@localhost:5432/<database>?sslmode=require` — **static, non-secret credentials** (the only secret in the container env is `NEON_API_KEY`). Both drivers served simultaneously (the `DRIVER` var is deprecated): postgres-wire on the port, and `@neondatabase/serverless` via app-side `neonConfig.fetchEndpoint = 'http://localhost:<port>/sql'` + `useSecureWebSocket = false` + `poolQueryViaFetch = true`. **The local proxy presents a SELF-SIGNED certificate (documented):** node-postgres needs `ssl: { rejectUnauthorized: false }` (or `?sslmode=no-verify`); the spike pins the asyncpg equivalent (ssl context / `ssl` connect arg).

**Documented gaps the spike MUST close:** (a) **unclean-exit behavior** — whether a killed container orphans its branch (testcontainers' Ryuk reaper may remove containers un-gracefully), and what auto-created branches are NAMED (needed for any cleanup tooling); (b) **the atlas revisions ledger location** — Atlas keeps its revision table in its OWN schema (not `public`; there are zero in-repo anchors for the fully-qualified name): locate and record it, since the preflight reads it (§3c); (c) **plan/quota semantics** — whether the current plan REJECTS branch creation over the cap or BILLS overage (Launch-tier behavior; https://neon.com/pricing) — this changes the §3f failure mode from "clear error" to "silent cost".

**Phase 0 — the gating validation spike.** No production code lands until these are proven end-to-end (scratch branch + findings write-up). **Phase 0 also DELIVERS `test-base` + `scripts/neon-test-base.sh`** (§3b) — the spike needs the parent branch to exist, and A/B consume it (this resolves the v4 chicken-and-egg where A both delivered and needed the provisioner).

1. `testcontainers-python` `GenericContainer("neondatabase/neon_local:latest")` with `NEON_API_KEY`/`NEON_PROJECT_ID`/`PARENT_BRANCH_ID=<resolved test-base id>` starts; readiness wait strategy identified; start→ready wall time recorded.
2. `SupabaseClient` (asyncpg) connects via the static local DSN — **the self-signed-cert handling pinned for asyncpg** — and runs a PostGIS geo query + a `vector(1024)` round-trip with HNSW present.
3. `pg.Pool` (node-postgres) connects with `ssl: { rejectUnauthorized: false }` / `sslmode=no-verify` and round-trips a query (the two node-postgres spikes depend on this).
4. Ephemeral branch parent verified = `test-base` via the Neon API; the auto-created branch NAME format recorded (gap a).
5. Clean stop deletes the branch (API-verified); `docker kill` + Ryuk-reap paths checked for orphaning; TTL alternatives noted (gap a → decides the §3f stray note).
6. vitest + `neonConfig` wiring + `makeDb(localConnStr)` executes a Drizzle query through the same container; **plus a `db.transaction()` batch round-trip** (the catalog code the spikes exercise depends on it: `workers/catalog/src/enrich/enrich.ts:48`; the blue/green publish is a single transaction, `workers/catalog/src/publish/versioning.ts`).
7. **Upstream-path probe (pooled vs direct semantics through the proxy):** `pg_backend_pid()` stability across sequential queries on one connection; prepared statements; session-level `SET` visibility — pins whether the proxy routes via a pooled endpoint and whether session state is safe.
8. `SET LOCAL ROLE agent_svc` through the proxy: which upstream role does the local `neon` user map to; does the grant provisioning (§3b) suffice (`test_service_roles.py:29-31` must pass).
9. **Seed + TRUNCATE cycle through the serverless driver** (the spike helper's isolation op works over HTTP).
10. **Negative auth cases:** wrong `NEON_PROJECT_ID`, revoked key, insufficient-scope key → each surfaces as an actionable container/startup error, not a hang.
11. **Atlas ledger located:** run the pinned `atlas migrate apply` against a scratch branch; record the fully-qualified revisions table name (gap b) for the preflight.
12. **Latency table:** per-query RTT, pool-connect cost, projected ~59-test suite wall time. **Decision rule:** projected ≤ ~2× current testcontainers wall time → Neon Local is the local DEFAULT arm; worse → the default-arm question goes to the owner with the numbers (CI keeps Neon Local either way; offline arm exists regardless).
13. Two containers simultaneously (distinct mapped ports) → two independent branches, no interference.
14. **Plan semantics pinned** (gap c): drive branch count to the cap on the current plan; record reject-vs-bill behavior (https://neon.com/pricing).
15. A minimal GH Actions job starts the container with repo secrets and runs one query — CI viability proven before Phase C.

**If Neon Local cannot serve a piece** (driver, role, latency, stability), that piece falls back to the corresponding raw-PG design (offline arm §3h for Python; skip-gating for spikes) and this spec is amended — the gate exists so the fallback is a decision, not a surprise.

### 3b. The golden parent — `test-base` (delivered in Phase 0)

A long-lived branch in the shared project holding exactly: the full `db/migrations` schema (one `atlas migrate apply`, per `atlas.hcl` env `neon`) + `apps/agent/agent/tests/fixtures/seed.sql` (88 lines, 2 INSERTs, already idempotent — `ON CONFLICT (id) DO NOTHING` at :24/:88) + the service-role membership grants (below). Parent pinned to the project default branch, then **rebuilt to a deterministic empty-root construction** by the provisioning script (guarded wipe → atlas → seed) — deliberately **NOT a CoW of staging's data**: deterministic seed assertions beat drifting staging data. Ephemeral test branches are born migrated + seeded, amortizing the expensive gazetteer migration (`20260714000002_gazetteer_data.sql`, 2.6 MB — ~1–3 min once, never per Neon Local run).

**`scripts/neon-test-base.sh` (Phase 0 deliverable; provision/refresh) — the one destructive script in v4.** Rails: refuses any branch name other than literal `test-base`; resolves the branch id via the API and re-verifies name-on-id before DDL (the wipe can never land on `staging` or a preview); verifies the target project id equals `NEON_PROJECT_ID`. Refresh (= apply + seed, never the wipe) runs on demand and via a small path-filtered push-main job when `db/migrations/**` or the seed changes.

**Service-role grants (kept, pending Phase 0 §3a.8).** Roles are cluster-level and copied by branching; the baseline's `IF NOT EXISTS` CREATE ROLE blocks (`db/migrations/20260623000001_init.sql:365-382`) no-op on parented branches, so creation-time mechanisms never fire there. The provisioning script executes an explicit idempotent `GRANT catalog_svc, agent_svc TO current_user WITH INHERIT FALSE, SET TRUE` — kept unless the spike proves the proxy's connecting role makes it unnecessary; never an atlas migration (it would leak the executing role into migration history that preview/prod also apply).

**`route_anime` atlas twin (Phase A; the supabase side is inherited base content).** The base (post-#347 `feat/frontend-rebuild`) already contains `supabase/migrations/20260716120000_route_anime.sql` and `test_route_anime_persistence_contract.py` — but `db/migrations` still lacks the table, and `test-base` is built from atlas, so the contract test cannot pass until Phase A adds `db/migrations/20260717000001_route_anime.sql` (+ `atlas migrate hash` → `db/migrations/atlas.sum`): content-mirror under the baseline's auth-strip treatment (`…0001_init.sql:4-5`) — keep the table (FKs `route_id → routes(id)`, `bangumi_id → bangumi(id)`, supabase :3-4), backfill DO block, index, `GRANT … TO agent_svc`, `ALTER TABLE routes DROP COLUMN IF EXISTS bangumi_id`; drop RLS/policy/`REVOKE … FROM anon, authenticated` (roles absent on bare Neon). Standing runbook rule: **any new `supabase/migrations/*.sql` that integration tests touch MUST land with its auth-stripped atlas twin.**

### 3c. Substrate 1 — agent Python integration + eval tests

**Arm selection — the normative truth table** (evaluated once per session; implemented as a pure function with direct tests):

| `TEST_DATABASE_URL` | `TEST_DB` | `NEON_API_KEY`+`NEON_PROJECT_ID` | Result |
|---|---|---|---|
| set | set (any value) | — | **HARD ERROR** (conflicting config — refuse to guess) |
| set | unset | — | **BYO arm** (no container; mutation-gated, below) |
| unset | `docker` | — | **Offline arm** (derived raw-PG image, §3h) |
| unset | any other value | — | **HARD ERROR** (unknown `TEST_DB` value) |
| unset | unset | both present | **Neon Local arm** (default) |
| unset | unset | partial (one of the two) | **HARD ERROR** (partial config named explicitly) |
| unset | unset | neither | **HARD ERROR** listing the three options (never a silent skip — `make check`/Makefile:86 and `make test-all`/Makefile:59-60 include integration) |

**Schema convergence at test time = the PINNED Atlas CLI, on ALL container arms.** The v4 custom "delta-apply" is DEAD: Atlas keeps its revision ledger in its own schema with sum-file validation, advisory locking, per-file transactional apply and recovery semantics that a hand-rolled applier cannot replicate — so the preflight shells out to `atlas migrate apply --dir file://db/migrations --url <session DSN>` using ONE pinned Atlas version (a single `ATLAS_VERSION` pin consumed by the Makefile, the conftest helper, CI installs — curl pattern as `preview.yml:95` — and `neon-test-base.sh`). Atlas thereby becomes a required, version-pinned test-time tool on the container arms.

**Per-arm session preflight matrix:**

| Step | Neon Local | Offline (`TEST_DB=docker`) | BYO (`TEST_DATABASE_URL`) |
|---|---|---|---|
| wake/backoff (`SELECT 1`, 6 attempts, 10 s per-attempt timeout, sleeps 1/2/4/8/16 s ⇒ ≤91 s worst case) | yes (branch cold start) | yes (container start) | yes |
| capability checks (`to_regclass('public.bangumi')`, `to_regclass('public.route_anime')`, `vector` ext) | yes | yes | yes |
| `atlas migrate apply` (pinned CLI) | yes — normally a no-op (parent current); covers PR-added migrations | yes — full apply from empty (**~1–3 min incl. the gazetteer**, §3h) | **NO by default** — read-verify the revision state; **fail-on-behind** with an actionable message |
| idempotent seed re-apply (2 statements) | yes (no-op on a fresh branch) | yes (initial seed) | only under the mutation opt-in |

The seed re-apply's justification (corrected from v3): it is the offline arm's INITIAL seed, and the healing step for a REUSED BYO database; on a fresh Neon Local branch it is a no-op by idempotency.

**BYO arm is mutation-gated (the trust hole closed).** A mistyped staging/main DSN must never be migrated, seeded, or written by tests. Default BYO behavior = read-verify preflight then **refuse to proceed** (the suite errors before any write) unless **`TEST_DB_ALLOW_MUTATION=1`** is set AND an **identity check** passes: when the DSN host resolves to a Neon endpoint, the preflight resolves the branch via the Neon API and REJECTS any DSN whose branch is the project default/`main`, `staging`, `test-base`, or `preview/*` lineage; non-Neon hosts (e.g. a local docker DB) pass the identity check by construction (the explicit flag remains required). **`TEST_DATABASE_URL` is classified a SECRET** (it may be a real cloud DSN): no DSN fragments in any log — endpoint-host-only logging (the static Neon Local DSN remains non-secret; this rule is about BYO).

**The container swap.** `conftest_db.py`'s `pg_container` (session-scoped, kept) becomes the arm-selected fixture per the truth table; `db_pool`, `real_db` (`conftest_db.py:187-215`) and `tc_db` (`integration/conftest.py:45-54`) re-chain onto it. The schema hacks die on all arms: Neon Local inherits from `test-base`; offline applies `db/migrations` verbatim via atlas (the derived image has `vector`); `_apply_migrations_sync`/`_filter_migration_lines`/`_skip_vector_statements`/`_split_sql_statements` (`conftest_db.py:55-157`) are deleted in Phase D. **Restored coverage win, gated:** a new integration test pins `points.embedding` is `vector(1024)`, round-trips an embedding, and finds the HNSW index — on both container arms.

**The eval runner (kept, adapted).** Extract the arm-selection + container logic into a shared helper module (used by `conftest_db.py` AND the runner). `run_agent_eval.py`'s `_db_url()` (:129-133): when `EVAL_FULLSTACK=1`, resolve per the same truth table; the `localhost:54322` fallback is REMOVED in that mode (fail-fast naming the options). Endpoint-host-only logging; `NEON_API_KEY` never logged.

**Pool scoping + event loops — data-driven at Phase A (unchanged from v4).** If Phase 0 shows pool-connect cost is material, adopt the preserved v3 mechanics exactly: fixtures `loop_scope="session"` + conftest hook `item.add_marker(pytest.mark.asyncio(loop_scope="session"), append=False)` path-filtered to the DB suites (`append=False` is load-bearing: pytest-asyncio 1.4.0 auto mode adds a bare `asyncio` marker at `makeitem`, and `get_closest_marker` returns the first marker), with the zero-loop-affinity + cross-module pool-reuse + unit-loop-spot-check ACs. Otherwise keep function-scoped pools.

### 3d. Substrate 2 — catalog spike suite

**One Neon Local container per suite run, via testcontainers-node in a vitest `globalSetup`.** `vitest.spike.config.ts` gains a `globalSetup` that (when `NEON_API_KEY`+`NEON_PROJECT_ID` are present) starts ONE container (`PARENT_BRANCH_ID=<resolved test-base id>`) and hands the local DSN + mapped port to test files via **vitest `provide()`/`inject()`** (env-var fallback acceptable; the mechanism is pinned in the helper, not ad hoc per file); teardown stops it (branch auto-deleted). Container-per-file is rejected (13 serial branch creates for no isolation the TRUNCATE doesn't give).

**New `workers/catalog/test/spike-db.ts` helper:**
- **Env gate:** no `NEON_API_KEY` → `describe.skip` with "spike suite needs Neon Local — set NEON_API_KEY/NEON_PROJECT_ID". `npm test` becomes **green offline** (fixing `package.json:12`) — the spikes are Neon-coupled by driver, so offline they skip rather than fake.
- **Serverless-driver wiring, contained by construction:** sets `neonConfig.fetchEndpoint = 'http://localhost:<mapped>/sql'`, `useSecureWebSocket = false`, `poolQueryViaFetch = true` before handing out `makeDb(localConnStr)`. Containment argument, explicit: `neonConfig` is process-global, but the spike suite is a SEPARATE vitest invocation (`vitest.spike.config.ts`, Node env, forks pool) — the worker suite (`test:worker`, workerd pool) never loads `spike-db.ts`, and production `src/` never references `neonConfig` (a spike meta-assertion enforces the `src/` ban). Belt-and-braces: `spike-db.ts` SNAPSHOTS the three `neonConfig` globals before setting them and RESTORES them in teardown.
- **node-postgres TLS:** the helper's `pg.Pool` config carries `ssl: { rejectUnauthorized: false }` (documented self-signed local cert, §3a) for the two node-postgres spikes (`postgis.spike`, `resolve-api.spike`).
- **Per-file isolation (kept from v3): one explicit `TRUNCATE <FK-closed set> RESTART IDENTITY`, NO CASCADE.** Closed set = the baseline's `catalog_tables` array (`db/migrations/20260623000001_init.sql:386-390`: bangumi, points, cluster_version, route_snapshots, aliases, series_edges, leg_cache, raw_anitabi, raw_bangumi, media_assets, ingest_jobs) **plus today exactly `route_anime`** (its `bangumi_id → bangumi(id)` FK, §3b; `points.bangumi_id → bangumi` at `…:77` is already inside; `routes` exits the closure when the twin drops `routes.bangumi_id`, `…:214`). No CASCADE ⇒ any future FK into the set fails the TRUNCATE loudly → forced closure review. NEVER in the set: `locations`/`location_aliases` (`20260714000001_catalog_geocoding.sql:2,:19` — migration-seeded, 2.6 MB) and the **atlas revisions ledger** (it lives in Atlas's own schema, outside `public`, per Phase 0 §3a.11 — and truncating it would erase the migration HISTORY, desyncing Atlas from the actual schema; the schema itself would remain).
- **Scratch DDL stays idempotent** — `postgis.spike.test.ts` already does `DROP TABLE IF EXISTS spots` (:64) before its CREATE (:66); pinned by the same-file-twice AC.

All 13 files DELETE: `execSync docker run`, ready-probes, port bookkeeping, `readFileSync` DDL marker-slicing of `supabase/migrations` (`db.spike.test.ts:27-53`) and of the atlas baseline (`resolve-api.spike.test.ts:18,:65`).

### 3e. Substrate 3 — the explicit `supabase start` boundary (UNCHANGED)

`supabase start` remains ONLY for GoTrue-coupled surfaces until the Neon Auth track (`docs/ops/auth-migration-neon.md`): the e2e magic-link journey (`scripts/e2e-setup.sh`, `e2e/auth-flow-local.spec.ts`, `send-auth-email` + Mailpit), the auth half of `make dev-local` (Makefile:141-180), and the Supabase-side migration tooling (`make db-*` Makefile:121-137, ci.yml `db-validate` :151-171, deploy.yml `db push`) while auth/legacy data lives on Supabase. After this ships, **`supabase start` is an auth appliance, not a test database** (sentence goes into `docs/testing-strategy.md`).

### 3f. CI — the same testcontainers pattern, minimal YAML

**The v3 lifecycle layer stays evaporated:** no create-branch-action, no `expires_at`, no teardown steps, no guard library. CI jobs run the SAME commands as local; the container manages the branch. **One piece returns for its QUOTA function (not its lifecycle function): a cheap `concurrency:` group.**

**Job 1 — `python-integration`:** PR-triggered, `if: needs.changes.outputs.agent == 'true' || needs.changes.outputs.migrations == 'true'` (filters exist on the base: `agent: ['apps/agent/**', 'packages/contract/**']`, `migrations: ['supabase/migrations/**', 'db/**']`), **fork-gated** (`github.event.pull_request.head.repo.full_name == github.repository`, as `preview.yml:32`). Steps: checkout → uv setup (mirroring `_python-ci.yml`) → install the pinned Atlas CLI → `NEON_API_KEY`/`NEON_PROJECT_ID` into the job env → `pytest agent/tests/integration/ --no-cov` (mirroring Makefile:66) — the conftest starts Neon Local, the preflight atlas-applies + seeds, teardown deletes the branch. ~59 tests run (the two remote-API-gated files skip).

**Job 2 (optional) — `catalog-spikes`:** same shape, `pnpm --filter catalog run test:spike`; **`needs: python-integration`** so the two jobs serialize per PR (per-PR peak branch cost stays 1, not 2). Ships only after Phase B is green locally.

**Quota controls:** `concurrency: group: neon-tests-${{ github.ref }}`, `cancel-in-progress: true` on both jobs — a superseded push frees its session promptly; per-ref, so unrelated PRs still run in parallel by design.

**Quota math, honest worst case.** Standing: main(1) + staging(1) + `test-base`(1) + `preview/pr-*`(= labeled P, label-gated) + optional standing dev branch(0–1). Ephemeral: one branch per LIVE test session. **Without the mitigations, once the spike job ships: 2 concurrent PR runs × 2 jobs + 1 local session + 3 previews + 3–4 standing = 10–12 → OVER the 10-branch cap.** With `needs:` serialization (per-PR cost 1) + the per-ref group: 2 concurrent PRs + 1 local + 3 previews + 4 standing = **10 — at the cap in the pathological case, 6–8 typical**. The failure mode depends on plan semantics Phase 0 §3a.14 pins (https://neon.com/pricing): free tier rejects (a clear container-start error naming the cause); **Launch tier may BILL overage instead of rejecting** — if so, the risk is silent cost, not red CI, and the runbook documents the branch-count check. Strays: only from unclean kills — Phase 0 §3a.5 decides whether a tiny cleanup note/cron (matching the recorded ephemeral-name pattern) survives.

**Non-gating initially (measure-then-enforce, unchanged).** Out of the deploy `needs:` chain (`ci.yml:214`) and branch protection, agnix-precedent placement (`ci.yml:129-147`); NO `continue-on-error`. **Promotion: 10 consecutive greens on main-bound PRs — quota-caused failures (identified by the container-start error class) are EXCLUDED from the streak count but tracked separately**; the owner flips it into `needs:` and re-checks the quota posture then. Workflow-compile validation on a test branch before merge (standing lesson).

### 3g. Local dev UX

- **Test runs need no provisioning target:** `make test-integration` / `make test-all` / `make check` just run pytest; the conftest owns the container per the §3c truth table, with hard-fail-with-instructions when no arm is configured.
- **Workers dev — cloud DSN, NOT Neon Local:** the serverless driver would need `neonConfig.fetchEndpoint` in `src/` to speak to a local proxy, which this spec bans. Instead, **`.dev.vars.example` for catalog (:6) and users (:2) point at a standing dev branch's REAL CLOUD connection string** (recipe comment: create once — `neonctl branches create --name dev/<name> --parent test-base` — then `neonctl connection-string dev/<name>`); neon-http works natively against the cloud endpoint. This is the first working local `wrangler dev` DB path since the driver switch.
- **`make dev-db` (small new target, AGENT-only, postgres-wire):** starts a long-lived Neon Local container for the Python backend's local dev DB — persistent mode (`BRANCH_ID=<standing dev branch>`) or ephemeral (`PARENT_BRANCH_ID=test-base`), documented choice. Workers do not use it.
- **Secrets posture:** the Neon Local DSN is static and non-secret; `NEON_API_KEY` lives in `.env`, passed to container env, never echoed; BYO `TEST_DATABASE_URL` is a secret (§3c).
- **Tools:** docker + the test runners; the **pinned Atlas CLI** (§3c — Makefile/conftest check with install instructions); `neonctl` optional (runbook convenience + the dev-branch recipe).

### 3h. Offline story — hermeticity, honestly stated

The Neon Local arm requires network + `NEON_API_KEY` — inherent to "the test database is Neon." The **offline arm** (`TEST_DB=docker`) preserves testcontainers hermeticity with a small in-repo derived image (`apps/agent/agent/tests/docker/pg-test.Dockerfile`): `FROM postgis/postgis:16-3.4@sha256:<PINNED DIGEST>` + `RUN apt-get install -y postgresql-16-pgvector=<PINNED VERSION>` — **digest- and package-version-pinned** so the image is immutable and the arm is reproducible. Honesty: (a) it is "offline AFTER the image is built/cached" (the one-time build needs network); (b) `TEST_DB=docker` with the image missing → a **hard actionable error** printing the exact `docker build` command (never a silent fallback to another arm); (c) each offline session pays the full `atlas migrate apply` from empty — **~1–3 min, dominated by the 2.6 MB gazetteer migration** — the price of hermetic determinism. What offline does NOT cover: the spikes (neon-http needs the proxy; they skip) and true Neon behavior. Unit tests — the pre-push/CI-required tier — never touch a DB and are always offline-safe.

## 4. Phasing + acceptance criteria

Dependency graph: **0 → A → C → D; 0 → B → C(spike job)**; A ∥ B after 0; **0 delivers `test-base` + `neon-test-base.sh`**; B additionally consumes A nothing (spike helper is self-contained once `test-base` exists). Test-type legend: `unit | integration | eval | api`. Every AC carries one or an explicit **OPERATIONAL (Coordinator)** flag.

### Phase 0 — validation spike (GATING; scratch branch + ONE production deliverable)

**Deliverables:** `scripts/neon-test-base.sh` + the provisioned `test-base` branch (production-grade — A/B consume it); throwaway spike scripts; a findings write-up (metrics table + go/no-go per piece + the three §3a gap answers + the arm-default and pool-scoping decisions).

- [ ] `GenericContainer(neon_local)` starts with `PARENT_BRANCH_ID=<resolved test-base id>`; readiness strategy identified; start→ready time recorded. -> integration
- [ ] asyncpg connects (self-signed-cert handling pinned); PostGIS query + `vector(1024)` round-trip + HNSW present. -> integration
- [ ] `pg.Pool` connects with `ssl: { rejectUnauthorized: false }` / `sslmode=no-verify` and round-trips. -> integration
- [ ] Branch parent verified = `test-base` (API); ephemeral branch NAME format recorded. -> integration
- [ ] Clean stop deletes the branch; `docker kill` + Ryuk paths checked for orphaning; TTL alternatives noted. -> integration
- [ ] `neonConfig` + `makeDb` Drizzle query AND a `db.transaction()` batch round-trip succeed through the container (`enrich.ts:48` / `versioning.ts` semantics). -> integration
- [ ] Upstream-path probe: `pg_backend_pid()` stability, prepared statements, session `SET` — pooled-vs-direct semantics pinned. -> integration
- [ ] `SET LOCAL ROLE agent_svc` works through the proxy (or the grant gap is characterized). -> integration
- [ ] Seed apply + closed-set TRUNCATE cycle works through the serverless driver. -> integration
- [ ] Negative auth: wrong project id / revoked key / insufficient scope → actionable startup errors, no hangs. -> integration
- [ ] Pinned `atlas migrate apply` runs against a scratch branch; the fully-qualified revisions table name recorded. -> integration
- [ ] Latency table + the ≤2× decision rule applied (arm default + pool-scoping decisions recorded). -> OPERATIONAL (Coordinator — measurement)
- [ ] Two simultaneous containers → two independent branches. -> integration
- [ ] Plan/quota semantics pinned (reject vs overage-bill at the cap; https://neon.com/pricing). -> OPERATIONAL (Coordinator — account-level observation)
- [ ] Minimal GH Actions job runs the container with repo secrets + one query. -> integration
- [ ] `neon-test-base.sh` rails: name ≠ `test-base`, name-on-id mismatch, or project id ≠ `NEON_PROJECT_ID` → refuses before any DDL; rail logic table-tested. -> unit

### Phase A — agent integration on Neon Local + atlas twin + eval fix (own PR; consumes Phase 0's `test-base`)

**Deliverables:** arm-selected `pg_container` + truth-table selector + per-arm preflight (wake / capabilities / pinned-atlas apply / seed) in `conftest_db.py`; the shared container/DSN helper module; `_db_url()` fullstack-mode change in `run_agent_eval.py`; the `route_anime` atlas twin + `db/migrations/atlas.sum`; the `ATLAS_VERSION` pin wiring (Makefile/conftest/CI); the offline derived image Dockerfile (digest+package pinned); the pgvector coverage test; BYO mutation gate + identity check; pool/loop-scope decision applied per Phase 0.

- [ ] Happy: `make test-integration` passes the full suite on the Neon Local arm (~59 DB-bound tests; 2 remote-gated files skip). -> integration
- [ ] Happy: the same suite passes on the offline arm (`TEST_DB=docker`, atlas-applied verbatim from empty — zero filtered/swallowed statements). -> integration
- [ ] Happy: BYO with `TEST_DB_ALLOW_MUTATION=1` against a disposable branch runs the suite; identity check passes. -> integration
- [ ] Happy (schema parity): `to_regclass('public.route_anime')` non-null on a fresh ephemeral branch; `test_route_anime_persistence_contract.py` passes unmodified. -> integration
- [ ] Happy (eval): `EVAL_FULLSTACK=1 make test-eval-fullstack` runs via the shared helper; log shows endpoint host only; `NEON_API_KEY` absent from logs. -> eval
- [ ] Happy: the truth-table selector + preflight decision logic are pure functions with direct tests covering every row of the §3c table. -> unit
- [ ] Null/empty: seed re-apply on an already-seeded branch is a no-op (row counts stable; pins seed.sql:24/:88 end-to-end). -> integration
- [ ] Null/empty: atlas apply with zero pending migrations is a no-op; with one PR-added migration, exactly it is applied before tests (Neon Local arm). -> integration
- [ ] Error: a two-statement migration failing at statement 2 → transactional rollback, revision state unchanged, and a rerun after fixing succeeds (pinned-Atlas failure semantics). -> integration
- [ ] Error: conflicting config (`TEST_DATABASE_URL` + `TEST_DB`) → hard error; unknown `TEST_DB` value → hard error; partial Neon config → hard error naming the missing var; no arm configured → hard error listing the three options. -> unit
- [ ] Error: BYO WITHOUT `TEST_DB_ALLOW_MUTATION=1` → read-verify then refuse before any write, with instructions; BYO DSN resolving to `main`/`staging`/`test-base`/`preview/*` lineage → REFUSED even with the flag. -> integration
- [ ] Error: BYO behind on migrations → fail-on-behind (no auto-apply), actionable message. -> integration
- [ ] Error: `EVAL_FULLSTACK=1` with no resolvable arm → runner fail-fast (localhost fallback removed in that mode). -> unit
- [ ] Error: unreachable DSN → bounded backoff (6 attempts, ≤91 s worst case) then an actionable error; no `TEST_DATABASE_URL` fragment in the message when BYO. -> integration
- [ ] Restored pgvector: embedding type + round-trip + HNSW test passes on BOTH container arms. -> integration
- [ ] Neon roles: `pg_has_role(current_user, 'agent_svc', 'SET')` true and `SET LOCAL ROLE agent_svc` succeeds through Neon Local; `test_service_roles.py` passes. -> integration
- [ ] If the pool/loop rescope is adopted (per Phase 0): zero loop-affinity errors + cross-module pool-reuse regression + unit-suite function-loop spot-check (`append=False` mechanics). -> integration

### Phase B — spike suite rewrite (own PR; after 0)

**Deliverables:** vitest `globalSetup` (testcontainers-node, one container per suite run, `provide()`/`inject()` DSN handoff); `workers/catalog/test/spike-db.ts` (env gate, `neonConfig` set/snapshot/restore, `pg.Pool` with self-signed-cert ssl config, closed-set TRUNCATE helper); 13 files converted; testcontainers dev-dep added to catalog.

- [ ] Happy: all 8 previously-broken `makeDb` spikes pass through serverless mode — including their `db.transaction()` paths. -> integration
- [ ] Happy: the 2 node-postgres spikes pass with the helper's `ssl: { rejectUnauthorized: false }` pool config; the 3 no-DB spikes unchanged. -> integration
- [ ] Happy: zero remaining `execSync docker`/probe/`readFileSync`-DDL-slicing in any spike file, and zero `neonConfig` references under `src/` (vitest meta-assertion; Coordinator may downgrade to review-checklist). -> unit
- [ ] Happy: `spike-db.ts` snapshots the three `neonConfig` globals and teardown restores them (asserted). -> unit
- [ ] Null/empty: no `NEON_API_KEY` → all DB spikes skip with the actionable message; `npm test` green offline (fixes `package.json:12`). -> integration
- [ ] Isolation (repeat): the same DB spike file passes twice consecutively on one branch (pins idempotent scratch DDL, `postgis.spike.test.ts:64-66`). -> integration
- [ ] Isolation (order): all DB spikes pass in two different file orders; after each pass `locations`/`location_aliases` row counts unchanged and the atlas revisions ledger untouched; sequences restarted. -> integration
- [ ] Error: the TRUNCATE statement is built only from the pinned FK-closed set, no CASCADE keyword (asserted on constructed SQL); a scratch table with a new FK into the set makes it fail loudly. -> unit (construction) + integration (drift)
- [ ] Error: helper against a branch missing a closed-set table → one actionable failure, not per-test noise. -> integration

### Phase C — CI jobs (own PR; after A; spike job after B)

**Deliverables:** `python-integration` job (+ optional `catalog-spikes` with `needs: python-integration`); the per-ref `neon-tests` concurrency group; the pinned-Atlas install step; the push-main `test-base` refresh job. Secrets: existing `NEON_API_KEY`/`NEON_PROJECT_ID` only.

- [ ] Happy: on a same-repo PR touching `apps/agent/**`, the job runs green; the log shows the ephemeral branch created and the Neon API shows it gone afterward. -> integration
- [ ] Happy: a PR adding a `db/migrations` file passes via the preflight's pinned-atlas apply (no workflow change). -> integration
- [ ] Happy: `test-base` refresh fires on push-main touching `db/migrations/**` (apply + seed, never the wipe). -> integration
- [ ] Null/empty: unrelated-diff PRs do not trigger the job (`agent || migrations` filter). -> integration
- [ ] Error: fork PR → job skips cleanly; `NEON_API_KEY` never in logs. -> integration
- [ ] Error: branch-create failure at container start surfaces as ONE clear job failure naming the cause (per the Phase-0-pinned plan semantics). -> integration
- [ ] Concurrency: the spike job waits on the integration job (per-PR branch cost peaks at 1); a superseded push on the same ref is cancelled by the `neon-tests-${{ github.ref }}` group; two DIFFERENT PRs run in parallel, each with its own branch, both green. -> integration
- [ ] Per Phase 0 findings: IF unclean exits orphan branches → the tiny cleanup (runbook one-liner + optional cron on the recorded name pattern) exists and leaves all standing branches (`main`/`staging`/`test-base`/`preview/*`/dev) untouched. -> integration (only if built)
- [ ] OPERATIONAL (Coordinator): job absent from deploy `needs:` lists and required checks; promotion criterion in the workflow header (10 consecutive greens, **quota-class failures excluded from the streak but tracked**), agnix-precedent (`ci.yml:129-133`); workflow-compile validated on a test branch (green run link in the PR).

### Phase D — cleanups, deletion, docs (own PR; terminal)

**Deliverables:** delete the legacy raw-PG machinery EXCEPT the offline arm (the neutralization/swallow helpers, the old image pin); `.dev.vars.example` ×2 → the standing dev-branch CLOUD DSN recipe; `make dev-db` (agent-only); `e2e-setup.sh` path fix; pre-commit DSN placeholder; docs sweep.

- [ ] Deletion: `_apply_migrations_sync`/`_filter_migration_lines`/`_skip_vector_statements`/`_split_sql_statements` gone from `conftest_db.py`; `psycopg2` dropped if reference-free (testcontainers STAYS); unit suite + coverage floor (≥82%, pytest.ini `--cov-fail-under=82`) unaffected. -> unit
- [ ] No `skipif` referencing the old docker path remains; the pgvector test runs unconditionally on both container arms. -> unit
- [ ] Config: `.dev.vars.example` (catalog `:6`, users `:2`) carry the cloud dev-branch DSN recipe; `wrangler dev` against a real dev branch answers a catalog health/search request via neon-http natively. -> integration
- [ ] Config: `make dev-db` starts Neon Local (persistent or ephemeral mode) and the agent backend connects postgres-wire. -> integration
- [ ] Config: `scripts/e2e-setup.sh:23` seed path fixed to `apps/agent/agent/tests/fixtures/seed.sql`; `make e2e-setup` seeds successfully. -> integration
- [ ] Config: `.pre-commit-config.yaml:76` DSN → inert placeholder satisfying `settings.py:219-220`; pre-push unit hook passes with no network. -> unit
- [ ] Docs (in-repo sweep): `docs/testing-strategy.md` (the truth table, three arms, the §3e boundary sentence, the offline recipe + costs); `apps/agent/AGENTS.md:84-88`; `.claude/agents/executor.md:96`; root `AGENTS.md:34`; `.claude/skills/e2e/SKILL.md:62`; a `docs/ops/` runbook (Neon Local usage, `test-base` refresh, quota math + plan semantics, the twin-migration rule, BYO mutation gate, stray cleanup per Phase 0). Closing grep for `postgis/postgis:16-3.4|54322|supabase start` over LIVE doc surfaces (historical `docs/superpowers/specs/**` + `plans/**` exempt) returns only sanctioned references (the offline Dockerfile + §3e auth surfaces). -> OPERATIONAL (Coordinator; scriptable, may become a lint)
- [ ] OPERATIONAL (Coordinator): the outer-repo CLAUDE.md "Test Environment" section (`/Users/lumimamini/Documents/Seichijunrei-agent/CLAUDE.md`) is outside this worktree/PR — updated by Coordinator/owner alongside the Phase D merge.

## 5. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Per-query cloud RTT makes the suite slow** (the defining v4 risk) | Phase 0 measures before implementation; explicit ≤~2× decision rule; offline arm for fast iteration; CI stays Neon Local either way. |
| **Quota: per-PR cost 2 once the spike job ships → 10–12 worst case unmitigated** | `needs:` serialization (per-PR peak 1) + per-ref `neon-tests` group with cancel-in-progress; honest at-the-cap statement (10 pathological / 6–8 typical); Phase 0 pins reject-vs-overage-bill plan semantics (pricing cited) — if billing, the risk is cost not red CI and the runbook documents the check; promotion criterion excludes quota-class flakes from the streak. |
| **Unclean container exit orphans branches** (docs silent; Ryuk may kill) | Phase 0 pins behavior + name format; if real → runbook one-liner + optional trivial cron on the name pattern, standing branches protected by the pattern. |
| **Custom migration logic diverges from Atlas** | Eliminated by design: test-time schema convergence is the PINNED Atlas CLI on all container arms; ledger location recorded in Phase 0; two-statement rollback/rerun AC pins the failure semantics. |
| **BYO destructive trust hole** (mistyped staging/main DSN) | Read-verify + fail-on-behind by default; mutation only under `TEST_DB_ALLOW_MUTATION=1` AND the Neon-API identity check rejecting protected lineage; `TEST_DATABASE_URL` classified secret (host-only logging). |
| **Self-signed local TLS breaks clients** | Documented cert fact cited (§3a); `pg.Pool` ssl config specified; asyncpg handling pinned in Phase 0 items 2–3; Phase B AC covers the node-postgres spikes. |
| **`wrangler dev` path impossible via the proxy** (`neonConfig` needed in `src/`) | Workers use a standing cloud dev-branch DSN (neon-http native); Neon Local reserved for postgres-wire consumers (`make dev-db`, tests); the `src/` `neonConfig` ban enforced by a spike meta-assertion. |
| **`neonConfig` is process-global** | Containment by construction (separate vitest invocation, forks pool, worker suite never imports the helper) + snapshot/restore + the `src/` ban assertion. |
| **`SET ROLE` service-role tests through the proxy** | Phase 0 §3a.8 checks the upstream role mapping; grant provisioning kept on `test-base` unless proven unnecessary; `pg_has_role` + `SET LOCAL ROLE` ACs. |
| **Pooled-endpoint semantics through the proxy** (prepared statements, session state) | Phase 0 §3a.7 probe (`pg_backend_pid` stability, prepared statements, session `SET`) pins it before any suite depends on it. |
| **Schema parity gaps (`supabase/migrations` vs `db/migrations`)** | The `route_anime` atlas twin (Phase A) + the standing twin-migration rule; the preflight's atlas apply covers PR-added migrations on ephemeral branches. |
| **TRUNCATE scope creep through FKs** | No CASCADE, explicit FK closure (11 catalog tables + `route_anime`; evidence `…0001_init.sql:77,:214` + twin FKs); future FKs fail loudly; excluded tables asserted to survive. |
| **Event-loop breakage IF the pool rescope is adopted** | v3 mechanics preserved verbatim (`add_marker(..., append=False)` + path filter); zero-loop-affinity AC; or not adopted (RTT dominates). |
| **Secret handling** | `NEON_API_KEY` = the one always-secret (container env, GH secret, never logged); BYO `TEST_DATABASE_URL` = secret with host-only logging; the static Neon Local DSN is non-secret by design; fork PRs gated; hookify secret-block covers PR surfaces. |
| **Destructive-op blast radius** | ONE destructive script (`neon-test-base.sh`, Phase 0) with exact-name + name-on-id + project-id rails, table-tested; everything else is container-managed self-created branches; the BYO mutation gate covers the remaining vector. |
| **`test-base` drift vs `db/migrations`/seed** | Preflight atlas apply per session; push-main refresh job; rebuild budget explicit (~1–3 min, gazetteer-dominated). |
| **Offline-arm drift / false hermeticity** | Image digest + apt package version pinned; "offline after cached image" stated; missing-image → actionable build-command error; same `db/migrations` applied by the same pinned Atlas (no filtered variant to rot). |
| **Neon Local image/API drift** | Image tag pinned in fixture/globalSetup; Phase 0 findings record the tested version; §3a doc citations anchor the contract. |

## 6. Explicitly out of scope

- **The e2e magic-link auth flow** (GoTrue/Edge-Function/Mailpit; `e2e-setup.sh` beyond the one-line path fix) — stays on `supabase start` until the Neon Auth track (`docs/ops/auth-migration-neon.md`).
- **`make dev-local` restructuring** — keeps supabase-local for now (`make dev-db` is additive).
- **Prod/staging data migration** and the `SUPABASE_DB_URL` → `DATABASE_URL` runtime rename (multi-env design §7).
- **Supabase-side migration tooling** (`make db-*`, ci.yml `db-validate`, deploy.yml `db push`) — persists while Supabase holds auth/legacy data.
- **Operator-script DSN defaults** (`backfill_city.py:18-21`, `seed_data.py:107`) — serve the retained supabase-local dev env; migrate with the Neon Auth / rename tracks.
- **ADJACENT FINDING (owner, unfixed here):** `deploy.yml:63-69` sources catalog `DATABASE_URL` from `SUPABASE_DB_URL` — stale/broken for neon-http; the live path is ci.yml's `NEON_DATABASE_URL` (`ci.yml:222-224`).
- **Eval content/baseline work** (batched to the redesign's terminal re-baseline); this spec only keeps eval DB plumbing working.
- **A dedicated Neon test project** — explicitly NOT designed in (owner: "staging 就是测试的"); a possible future escalation if quota pressure materializes.

## 7. Secrets & vars inventory

| Name | Kind | Status | Used by |
|---|---|---|---|
| `NEON_API_KEY` / `NEON_PROJECT_ID` | secret / vars (repo) + local `.env` (new for devs) | existing — now also feed the Neon Local container env | conftest fixture, spike globalSetup, CI jobs, `neon-test-base.sh` |
| `NEON_TEST_BASE_BRANCH_ID` | optional env (cache) | **resolution rule:** at container start the helper looks the id up BY NAME (`test-base`) via the Neon API with name-on-id verification; the env var, if set, short-circuits the lookup and is still name-verified | conftest fixture, spike globalSetup |
| `TEST_DATABASE_URL` | ephemeral env — **SECRET** (may be a real cloud DSN; host-only logging) | BYO bypass hook (no container; mutation-gated) | conftest, eval runner |
| `TEST_DB` | env flag | `docker` selects the offline arm; any other value = hard error | conftest |
| `TEST_DB_ALLOW_MUTATION` | env flag | `1` unlocks BYO mutation AFTER the identity check (§3c) | conftest |
| `ATLAS_VERSION` | single pin (Makefile var consumed by conftest helper, CI install step, `neon-test-base.sh`) | new | all atlas invocations |
| local Neon Local DSN | `postgres://neon:npg@localhost:<port>/<db>?sslmode=require` (self-signed cert; clients configured per §3a) | **static, NON-secret** (official design) | test-side consumers |

## Re-scope → v4 (owner-driven, 2026-07-17) — summary retained

The owner's three requirements — testcontainers everywhere, Neon as the test database, no separate test project — are jointly satisfiable only by **Neon Local**, which packages the branch-per-run lifecycle inside a container. **Evaporated from v3/v3.1:** the hand-rolled lifecycle layer (create-branch-action + `expires_at`, teardown/sweeper workflows, `neon-branch-guard.sh`, the `neon-ci` group-as-lifecycle, `make test-branch` + slot/flock/`.env.test.local` machinery, standing local test branches, the shared-vs-dedicated project debate). **Survived from v3:** `test-base` + provisioning rails; the `route_anime` atlas twin + twin-migration rule; role-membership grants (pending the proxy-role check); the eval-runner fix; seed-idempotency verification; the no-CASCADE FK-closure TRUNCATE; the restored-pgvector gating test; the loop-scope mechanics (data-gated); the `.dev.vars`/e2e-setup/pre-commit fixes; the `supabase start` = auth-appliance boundary; measure-then-enforce CI placement; the docs sweep incl. the OPERATIONAL outer-repo CLAUDE.md item.

## Review round 3 → changes (v4 → v4.1)

| # | Finding (reconciled) | Change in v4.1 |
|---|---|---|
| R3-1 | [Fable P1-1] The declared base (`main`) was wrong — seven cited surfaces exist only on the rebuild stack | Header re-declared: base = **`feat/frontend-rebuild` after PR #347 merges**, hard ordering dependency stated; #349 already merged into the stack; the "ONE declared content coupling" machinery DELETED — the `route_anime` supabase migration + persistence test are inherited base content and only the atlas twin remains as Phase A work (§3b, Phase A); counts/citations swept against that base |
| R3-2 | [Codex P1-1 + Fable P1-3] The custom delta-apply was not Atlas-compatible (ledger in Atlas's OWN schema, no sum validation/locking/per-file tx) and was undefined on offline+BYO | Delta-apply DELETED; test-time schema convergence = the **PINNED Atlas CLI on all container arms** (single `ATLAS_VERSION` pin: Makefile/conftest/CI/provisioner); per-arm preflight MATRIX added to §3c; Phase 0 gains "locate + record the fully-qualified revisions table name"; Phase A failure AC: two-statement migration fails at stmt 2 → rollback, unchanged revision state, clean rerun |
| R3-3 | [Fable P1-2] The wrangler-dev path was impossible as written (serverless driver needs `neonConfig.fetchEndpoint`, banned in `src/`) | Option (b) adopted: workers dev uses a **standing dev branch's real cloud DSN** (neon-http native; recipe in `.dev.vars.example`); `make dev-db` (Neon Local) is agent-only, postgres-wire; §2/§3g/Phase D AC updated |
| R3-4 | [Codex P1-4] BYO trust hole — a mistyped staging/main DSN would get migrated+seeded+written | BYO defaults to **read-verify + fail-on-behind, no mutation**; `TEST_DB_ALLOW_MUTATION=1` opt-in AND a Neon-API identity check rejecting `main`/`staging`/`test-base`/`preview/*` lineage; `TEST_DATABASE_URL` reclassified SECRET (host-only logging); Phase A ACs added |
| R3-5 | [Codex P1-2 + Fable P2-1] `PARENT_BRANCH_ID` takes an ID not a name; chicken-and-egg (Phase 0 needed `test-base` before Phase A delivered the provisioner) | `neon-test-base.sh` + the provisioned branch MOVED into Phase 0 deliverables (A/B consume); `NEON_TEST_BASE_BRANCH_ID` resolution defined in §7 (API lookup by name + name-on-id verification; env short-circuit still verified) |
| R3-6 | [Codex P1-3 + Fable P2-3] Quota math ignored per-PR cost 2 with the spike job; no quota control; plan semantics unpinned | §3f restated: unmitigated worst case 10–12 stated honestly; spike job `needs: python-integration` (per-PR peak 1) + per-ref `neon-tests` concurrency group (quota function, not lifecycle) restored; Phase 0 pins reject-vs-overage-bill (https://neon.com/pricing cited); promotion criterion excludes quota-class flakes from the 10-green streak |
| R3-7 | [Codex P1-5 + Fable P3-4] node-postgres TLS against the documented self-signed local cert was unhandled; doc-gap (b) overclaimed "full silence" | §3a cites the self-signed cert as documented (`rejectUnauthorized:false` / `sslmode=no-verify`); §3d helper carries the `pg.Pool` ssl config; Phase 0 gains a dedicated pg.Pool item; Phase B AC covers the two node-postgres spikes; the doc-gap list reworded (remaining gaps: orphaning/naming, ledger name, plan semantics) |
| R3-8 | [both P2] Selector semantics only lived in an AC | §3c gains the normative TRUTH TABLE (total order `TEST_DATABASE_URL` > `TEST_DB=docker` > Neon Local; unknown `TEST_DB` = hard error; conflicting/partial config = hard error); Phase A AC covers every row |
| R3-9 | [both P2] Phase-0 checklist too thin for the proxy's semantics | Added: pooled-vs-direct upstream probe (`pg_backend_pid` stability, prepared statements, session `SET`); drizzle `db.transaction()` round-trip (`enrich.ts:48`, `versioning.ts` single-tx publish); negative `NEON_API_KEY` cases; seed+TRUNCATE cycle through the serverless driver |
| R3-10 | [both P2] `neonConfig` containment under-argued; DSN handoff unspecified | §3d states the by-construction argument (separate vitest invocation, forks pool, worker suite never loads the helper) + the `src/` ban meta-assertion; globalSetup→files handoff pinned to `provide()`/`inject()` (env fallback); `spike-db.ts` snapshots + restores the three globals (Phase B AC) |
| R3-11 | [both P2] Offline-arm honesty | §3h: base image DIGEST + apt package version pinned; "offline after the cached immutable image"; `TEST_DB=docker` with image missing → hard error printing the build command; per-session atlas-apply cost (~1–3 min incl. gazetteer) stated |
| R3-12 | [P3 batch] | Arm order stated normatively in §3c (not only in ACs); the stale "self-heals after spike TRUNCATEs" rationale corrected (per-session branches — the re-apply's real justifications: offline initial seed + reused-BYO healing + no-op freshness); the atlas-ledger exclusion note reworded (truncation loses HISTORY, not schema; the ledger lives outside `public` anyway); §1 headline absolutes scoped (BYO/offline/e2e exceptions; sweeper conditional on Phase 0); the schema-source citation moved from `supabase/neon/0001_init.sql` to **`db/migrations/20260623000001_init.sql`** (diff-verified byte-identical, so all line numbers transfer) |
