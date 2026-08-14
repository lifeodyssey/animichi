# Embedded Migrations on App Boot (Flyway-style Atlas) — Evaluation

- Status: DESIGN EVALUATION — research only; no code change; decisions below are open choices for the owner
- Tracking: GitHub Issue #1039 "Flyway-style embedded migrations / app-boot Atlas — CI holds no DB credentials" (child of #1004)
- Context: owner decision 2026-08-15 to move the schema-migrate point from "CI deploy job uses a migrator DSN" to "the agent container applies the chain at boot with its own runtime-scoped DSN"
- Related security work: #831 (roles matrix), #855 (production least-privilege cutover), #1001 (#1004's staging cutover Phase D)
- Authority: evaluation only — it does not change any accepted ADR or spec, and supersedes nothing until the owner resolves the Open Decisions below

## Executive Verdict

Moving the schema-apply point from the CI deploy job to the agent container boot is **feasible** and materially improves the security posture the issue asks for, but it requires a **second, dedicated boot-time migrator connection** (a separate DSN), **not** reuse of the app's runtime agent_svc role. The boot hook must be a fail-closed, env-gated step; CI must be kept entirely off any staging/prod database credential; and the one-time destructive reset in cutover Phase D must remain an env-gated one-shot CI job with a break-glass DSN — never run from inside the running app and never against production.

This is a deliberate architecture choice, not something Atlas mandates. Atlas has no single "must run in CI vs must run in the app" position (see Q1); its blessed pattern for app-side execution is driving the CLI from start-up code, which is exactly what the boot hook does.

## Ticket References

- **#1039** — this issue: Flyway-style embedded migrations / app-boot Atlas so CI holds no DB credentials.
- **#1004** — parent: production-readiness refactor program (tracked in docs/specs/2026-08-13-production-readiness-refactor-spec.md).
- **#831** — schema roles matrix (runtime role != migrator).
- **#855** — production least-privilege cutover (role-scoped DSNs; migrator role only for Atlas apply).
- **#1001 / Phase D** — one-time destructive staging cutover reset (.github/scripts/cutover-reset-schema.sh).

## Q1 — Where does Atlas officially recommend migrations run? (URLs + patterns)

Primary sources were fetched live from atlasgo.io for this evaluation:

- **Versioned apply family:** atlas migrate apply --dir <dir> --url <DSN> with --baseline, --dry-run, --allow-dirty, plus atlas migrate status and multi-tenant search_path/revisions-schema scoping — https://atlasgo.io/versioned/apply. This is the exact flag family the repo already uses.
- **CI/CD for versioned migrations:** the setup-CI/CD doc recommends automating validate/test/review/deploy; it uses the Atlas Cloud Schema Registry for state but explicitly allows alternatives: *"If you prefer not to use the Schema Registry, you can use alternative storage options such as S3-compatible object storage, or any other storage solution accessible from your CI/CD pipeline."* — https://atlasgo.io/versioned/setup-cicd.
- **Container usage:** docker pull arigaio/atlas / docker run --rm -v $(pwd)/migrations:/migrations arigaio/atlas migrate apply --url <DSN> — the direct enabler for baking Atlas into the agent image — https://atlasgo.io/versioned/setup-cicd and https://atlasgo.io/versioned/apply.
- **Migrations from application code:** the supported path is the Go SDK wrapper ariga.io/atlas/.../atlasexec (client.MigrateApply(...)). Atlas states its public API commitment is the CLI, and this SDK is a "wrapper" used by its own GitHub Actions / K8s Operator / Terraform integrations — the blessed pattern is driving the CLI from deploy or start-up code, not a first-class in-app primitive — https://atlasgo.io/integrations/go-sdk.
- **Canonical shape is "schema before app":** the K8s/ArgoCD guide puts an AtlasMigration CR on sync-wave "1" and the app on sync-wave "2", so schema applies before the app scales up — https://atlasgo.io/guides/deploying/k8s-argo. The agent boot hook reproduces this ordering in a single container.
- **On CI credentials / prod access:** the "From Manual to Automated" post calls "manual migrations often require developers to have direct access to production databases" a security risk and the reason to automate — https://atlasgo.io/blog/2025/05/11/auto-vs-manual.
- **Destructive reset:** atlas schema clean -u "<DSN>" resets an entire database or schema (including the atlas_schema_revisions table), vs atlas migrate down which only reverts ledger-tracked changes — https://atlasgo.io/versioned/down.
- **Rollback model:** Atlas migrations are linear roll-forward; atlas migrate down exists but needs Pro + Schema Registry for --to-tag and is not a routine production path — https://atlasgo.io/versioned/down and https://atlasgo.io/versioned/apply.
- **Preconditions / lint:** --atlas:txtar checks can assert preconditions before a destructive migration (e.g. table-empty assertions; Pro); destructive/lint analyzers exist in atlas migrate lint or the GitHub Action — https://atlasgo.io/versioned/checks and https://atlasgo.io/versioned/lint.

**Net Atlas guidance.** Atlas insists on: forward-only, versioned migrations, ledgered in a revisions table (atlas_schema_revisions, scoped via --revisions-schema), linted, and applied in order before the readers/writers that depend on them. Its security posture: don't give humans (or unnecessary CI jobs) privileged DB access; automate. The Flyway position (app applies at boot) is **not** an Atlas default — moving to it is the architecture choice the owner made on 2026-08-15, and Atlas supports it via the container/startup-code path above.

## Q2 — Feasibility in this repo

**What exists today (verified in main).**
- migrations/neon/ = 37 versioned SQL files + atlas.sum; head = 20260814191301_turn_idempotency_outbox.sql (adds turn_reservations.request_digest/outcome_payload, public.turn_outbox_events, grants to agent_svc+readonly).
- Atlas is pinned to **0.30.0 with checksums in 4 places**: .github/actions/install-atlas/action.yml, apps/agent/src/animichi/tests/atlas_helper.py (ATLAS_LINUX_AMD64_SHA256/ATLAS_MACOS_ARM64_SHA256 + a checksum-verified cached binary), .github/workflows/reusable-deploy-component.yml "Atlas migrate" step (curl + sha256sum --check --strict), and scripts/neon-test-base.sh (env ATLAS_VERSION + version check).
- The app today explicitly does **not** migrate: apps/agent/src/animichi/interfaces/fastapi_service.py lines 156-157 ("Schema changes are never applied by the application..."), docs/ops/migrations.md:22, and docs/specs/2026-08-06-neon-dba-capability-map.md:27. A boundary test (workers/edge/test/migration-boundary.test.ts) asserts workflows carry the Atlas command and Drizzle schemas never become migration runners.

**Where an app-boot hook fits (apps/agent).**
- Entrypoint is CMD ["python","-m","animichi.interfaces.fastapi_service"] -> main() -> uvicorn.run (apps/agent/Dockerfile:74, fastapi_service.py:292-299). Seams:
  - (a) FastAPI **lifespan startup** — the natural, testable place that runs after settings resolve and before serving;
  - (b) a thin wrapper in main() before uvicorn.run.
  - Prefer (a) the lifespan (_lifespan_build_runtime in fastapi_service.py): it already sequences DB engine creation, outbox drain, and startup sweep, so a fail-closed migration step can sit at the top, before create_database_lifecycle.
- Guard the hook with an explicit RUN_MIGRATIONS_ON_START=true literal-string env so APP_ENV=production alone never triggers it. The repo already has fail-closed precedent for this: container-env CONTAINER_REQUIRED_KEYS, and no hardcoded-APP_ENV default.
- Bake the pinned Atlas 0.30.0 binary into the image and invoke atlas migrate apply --dir <embedded> --url <boot DSN> --revisions-schema public in the lifespan. Python is not Go, so the atlasexec path does **not** apply; the supported pattern is shelling out to the pinned CLI, which atlas_helper.apply* already does. Reproduce --revisions-schema public + search_path=public scoping so Atlas ignores neon_auth (see reusable-deploy-component.yml:587-609).

**The serverless-workers problem (the crux).**
- workers/catalog and workers/users are Cloudflare Workers: no boot/lifecycle phase, no startup migration. Their Drizzle schemas are query-only metadata, never DDL authority; they reach Neon via Drizzle neon-http at runtime.
- Therefore the **agent container becomes the single migration owner** for the shared public schema, and its deploy must precede catalog/users rollouts. Today's deploy DAG already orders this — the Atlas step runs at the top of every reusable-deploy-component.yml deploy.
- **Risk:** if the agent container never boots, migrations never run and catalog/users drift. Keep an env-gated, idempotent CI apply as a staging backstop and/or gate catalog/users deploys on agent health.
- Web app has no direct data-plane DSN (only Neon Auth / Better Auth client and session code under apps/web/src/lib/auth) — non-issue.

## Q3 — Security / minimum-privilege interplay (#831 roles, #855 cutover)

Roles today (migrations/neon/20260809000001_roles.sql, _grants, head): catalog_svc/agent_svc/users_svc/jobs_svc/readonly are NOLOGIN in Atlas; LOGIN + password come from Neon project-scoped neon.Role via Pulumi; GRANTs are branch/schema-scoped. Migrator/owner DSN policy: docs/ops/neon-env-topology.md:23 — "CI + break-glass owners only; never Worker/container runtime secrets." #831 allows the owner DSN until DB-3; #855 is the prod least-privilege cutover (role-scoped DSNs, migrator only for Atlas apply).

- **Do NOT reuse agent_svc (the app's runtime role) as the boot migrator.** It has no DDL rights, and #831/#855 are built on "runtime role != migrator". Applying DDL as agent_svc contradicts the matrix.
- **Needed: a dedicated boot-time migrator connection/role** — the existing migrator or a new boot_migrator — exposed to the container as a second, separate DSN (e.g. BOOT_MIGRATOR_DATABASE_URL), distinct from AGENT_SVC_DATABASE_URL. The migration step uses it; everything else in runtime uses agent_svc.
- **Container secret concentration — the main new risk.** Adding a migrator DSN to the same container raises blast radius from one table-owner CRUD to full DDL. Mitigations: env-gate so the DSN is not materialized/loaded when RUN_MIGRATIONS_ON_START != true; put the boot migrator in the Neon Secrets Store / CONTAINER_ENV_KEYS forwarding like AGENT_SVC_DATABASE_URL (workers/edge/wrangler.toml:396-399), not a plain wrangler secret put; keep the boot DSN out of the image (injected at runtime).
- **What CI keeps afterwards (the payoff of #1039):** CI no longer needs NEON_DATABASE_URL (the owner/migrator DSN), which today is passed into every deploy job (ci.yml 318/378/483/526, deploy.yml 61/105, staging-cutover.yml 106/116/152/185/219). After the move, CI keeps only build/deploy tokens (CLOUDFLARE_*, PULUMI_*, R2) plus the control-plane NEON_API_KEY for test-base infra (not a DB credential). CI thus holds **no staging/prod database credential** — exactly the issue's goal. The pipeline-db atlas migrate validate + --dry-run static lane stays (validate needs no DSN); gate the dry-run on the test-branch DSN or drop it.

## Q4 — test-base (scripts/neon-test-base.sh)

Current: CI-run (neon-test-base.yml; NEON_API_KEY + NEON_PROJECT_ID + ATLAS_VERSION). scripts/neon-test-base.sh {provision|refresh} test-base: guarded DROP DATABASE + CREATE DATABASE (provision) -> atlas_helper apply (pinned 0.30.0) -> gazetteer seed -> fixture seed -> GRANT catalog_svc, agent_svc. Heavy identity rails on branch/project/id/name; DSNs hidden via pg_service/pgpass.

- test-base is a **fixture parent** (docs/ops/neon-test-infra.md: TEST_DB=neon creates a child; the offline Docker arm uses animichi-test-postgres) — an ephemeral branch, not user data.
- Atlas has no "CI-applied on fixture branches" doctrine, but the Q1 CI/CD doc fully permits CI-applying to an ephemeral target.
- Because test-base is wipe-and-reseed-by-design and CI provisions it with only the control-plane NEON_API_KEY (never a standing staging/prod DB password), **keep test-base provisioning/refresh CI-run and scripted**. The fixture chain does not need app-boot — it is not a deployed app. It builds the branch DSN on the fly from the control-plane key, consistent with "CI holds no standing prod/staging DB credential". No NEON_DATABASE_URL secret is needed here.

## Q5 — Cutover Phase D: where the one-time destructive reset runs

Current: staging-cutover.yml Phase D runs .github/scripts/cutover-reset-schema.sh <source_revision>: evidence inventory -> assert no auth|neon schema -> DROP SCHEMA public CASCADE; CREATE SCHEMA public; -> atlas migrate apply --revisions-schema public -> verify applied head == source head. Identity rails, state recorder, staging environment. One-time destructive staging reset, never production (SAFE-1).

**Recommendation:** keep it as a **one-shot, env-gated CI job with a break-glass DSN** — the existing staging-cutover workflow_dispatch job invoking cutover-reset-schema.sh, but sourcing a break-glass migrator DSN (job-only secret) instead of riding the ordinary deploy NEON_DATABASE_URL. **Do NOT put the destructive reset inside the app boot hook** — a DROP SCHEMA belongs in a human-gated, PITR-recoverable one-off, not a startup path any future deploy could trigger.

**Fail-closed requirements:**
1. Bind the environment to staging only, and cutover-reset-schema.sh re-verifies branch/project/SHA before any DDL (it already does).
2. Never production: keep it workflow_dispatch-only and never reuse the prod DSN (prod is SAFE-1 pinned).
3. Preserve Neon Auth: the no-auth-schema pre-check stays, only public is dropped, search_path/--revisions-schema public preserved.
4. Keep Atlas's clean-database check on (no --allow-dirty).

Atlas atlas schema clean (Q1) is the semantically-named primitive, but the existing DROP+CREATE with stronger identity rails is preferable; do not let a raw clean run against the wrong environment.

## Q6 — Migration path (ordered), risks, rollback, what stays

**Ordered change list.**
1. **Roles/grants** (Atlas in migrations/neon/): add a boot-time migrator grant path so the app's migrator connection can DDL public; **do not widen agent_svc**. Aligns with #831/#855; capture atlas migrate hash in the same commit.
2. **Agent image** (apps/agent/Dockerfile): bake the pinned checksum-verified Atlas 0.30.0 binary; embed migrations/neon.
3. **App-boot hook** (fastapi_service.py lifespan, before DB lifecycle): gate on RUN_MIGRATIONS_ON_START=true, run atlas migrate apply --dir ... --url $BOOT_MIGRATOR_DATABASE_URL --revisions-schema public (+ search_path=public), fail-closed. Wire the new secret + flag via CONTAINER_ENV_KEYS + wrangler.toml secrets_store_secrets / worker_secrets.
4. **Deploy flow:** remove the per-deploy "Atlas migrate" step from reusable-deploy-component.yml (or gate it to a staging backstop), rely on the agent boot apply; keep the agent-before-catalog/users ordering. Keep pipeline-db validate (no DSN).
5. **CI changes:** stop passing NEON_DATABASE_URL into staging/prod deploy jobs (ci.yml / deploy.yml / staging-cutover.yml) for routine applies; keep NEON_API_KEY for neon-test-base only. Update docs/ops/secrets.md, docs/ops/neon-env-topology.md, docs/ops/deployment.md.
6. **Docs:** flip docs/ops/migrations.md:22 ("application never runs migrations at startup") to the boot model (keep expand/contract, append-only, atlas.sum rules); update prod-dsn-cutover.md, migrations/AGENTS.md, docs/specs/2026-08-06-neon-dba-capability-map.md, and the boundary test (workers/edge/test/migration-boundary.test.ts), which currently asserts workflows contain atlas migrate apply.

**Risks.**
- **Migrator credential in the container** (largest new attack surface) — env-gating, Secrets Store + CONTAINER_ENV_KEYS, no image-embedded DSN.
- **"App down => migrations never run" coupling** for catalog/users tables — deploy-order guarantee + idempotent staging backstop apply until confidence is high.
- **Concurrent cold-start boots racing on Neon** — the idempotent forward-only chain + revisions ledger converges; consider a lock / dry-run-first guard.
- **Testing gap** — add a hermetic test booting the app against a disposable branch with RUN_MIGRATIONS_ON_START=true.
- **neon_auth co-tenancy** — keep search_path=public + --revisions-schema public on every apply path.

**Rollback story.** Forward-only like today; a worker rollback never rolls back a migration. A bad boot migration = forward-fix: env-gate migrations off + redeploy; repair via a forward migration (docs/ops/neon-backup-rpo.md HITL + Neon PITR). atlas migrate down exists but is not routine for prod. The RUN_MIGRATIONS_ON_START gate is the emergency kill-switch. CI break-glass + PITR path unchanged.

**What stays unchanged.** The migrations/neon/ chain + atlas.sum (single authority, 37 files + future); pinned Atlas 0.30.0 + checksums (now shared with the image); Drizzle as query-only runtime metadata (boundary test); the roles-matrix intent (#831), prod min-privilege cutover (#855), search_path=public + neon_auth isolation; test-base CI provisioning via control-plane NEON_API_KEY (Q4); SAFE-1 production freeze + no-wipe production policy.

## Decision (open choices for the owner)

1. **Run the boot migration in (a) the FastAPI lifespan** (recommended; testable, sequences with existing DB lifecycle) **or (b) a wrapper in main() before uvicorn.run.**
2. **New dedicated boot_migrator role vs. reuse of the existing migrator role** for the boot connection — both must remain distinct from agent_svc (recommended: new boot_migrator with DDL-on-public only).
3. **Fate of the per-deploy "Atlas migrate" step in reusable-deploy-component.yml:** remove it entirely, or gate it to an idempotent staging backstop (recommended: staging backstop until confidence is high).
4. **Dry-run DSN for the static pipeline lane:** keep on a test-branch DSN, or drop --dry-run once app-boot is the sole apply path.
5. **Whether catalog/users deploys should hard-gate on agent health** vs. rely on deploy-order ordering alone.
6. **Concurrent cold-start protection:** accept the ledger's convergence, add a lock, or a dry-run-first guard.
7. **Timing relative to #855:** land the boot migrator before or as part of the production least-privilege cutover (recommended: as part of #855's role-scoped DSN cutover).

## Sources

Atlas primary docs fetched live for this evaluation (see each finding above): atlasgo.io/versioned/apply, /versioned/setup-cicd, /versioned/down, /versioned/checks, /versioned/lint, /integrations/go-sdk, /guides/deploying/k8s-argo, /blog/2025/05/11/auto-vs-manual, /blog/2026/07/30/atlas-v1-3. Repo files cited inline above are on the current main layout.
