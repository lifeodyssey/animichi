# Migration Executor on Cloudflare + CI Secrets Zeroing

- Status: PROPOSED — grilling complete (owner Q1–Q12 sign-offs recorded 2026-08-15/16); dual-seat spec review complete 2026-08-16 (seat 1 APPROVE with findings; seat 2 REJECT amend-and-approve). All findings folded in — see the Amendment section at the end.
- Tracking: GitHub issue #1046 (parent #1004). Absorbs and supersedes the root-level problem-mapping note ("迁移方案.md") and resolves the *decision-pending* status of the embedded-migration evaluation (#1039): option B (app-boot) is **rejected**, option C′ (platform-side migration executor) is **chosen**
- Related: #1004 (production-readiness track, parent) · #1039 (evaluation, resolved by this spec) · #855 (migrator role — delivered here) · #831 (roles matrix) · #912 (Secrets Store runtime DSNs — production half is a sibling ticket) · #1001 (staging cutover window — schema/DSN side delivered here, auth-roster side stays in #1001) · #1045 (residual deployer-credential scoping, follow-up)

## Problem Statement

Schema migrations run from GitHub Actions today: the deploy pipeline holds an **owner-level database DSN** (`NEON_DATABASE_URL`) and applies the Atlas chain during every deploy. The owner rejects this posture outright ("giving CI database credentials is dumb").

Investigation (four primary-source research passes + repo audit, 2026-08-15) established that the problem is wider than one secret:

1. **GitHub Secrets accumulated ~30 repo-level + 12 staging + 11 production entries.** Every secret in a job is readable by every third-party action in that job — a compromised action exfiltrates silently. This repo has already had an npm-typosquat incident.
2. **The owner DSN moonlights**: the same credential is the CI migration credential *and* the production runtime `DATABASE_URL` for the catalog/users workers (Secrets Store cutover #912 landed staging only).
3. **`NEON_API_KEY` is a skeleton key**: Neon API keys cannot be permission-restricted (org = Admin, project-scoped = Editor; both can read connection strings and reset role passwords — verified against Neon docs), and the test-base branch lives in the *same Neon project* as staging/production. CI can mint itself any DSN.
4. **No federation escape hatch exists**: Neon has no OIDC / workload-identity / short-lived DB credentials (absent from docs, changelog, and roadmap). Cloudflare's API likewise has no OIDC federation (open feature requests wrangler-action#402, workers-sdk#11434). Waiting is not a plan.
5. **Nine zombie secrets** have zero workflow references; two config values (`NEON_AUTH_JWKS_URL`, `CORS_ALLOWED_ORIGIN`) are managed as secrets although they are public configuration.
6. The evaluated alternative — Flyway-style **app-boot migration (option B)** — was rejected: Cloudflare Containers have no health-gated rollout and no automatic rollback, so a bad boot-time migration crash-loops the whole agent fleet; deploy success does not imply migration success; every cold start pays an Atlas no-op check; and a DDL credential enters the serving container. Atlas's own deployment guidance explicitly discourages migrate-on-startup.

## Solution

Move migration execution **into Cloudflare** and demote CI to an unprivileged trigger:

A dedicated **migrator worker** (plus a one-shot batch container carrying the pinned Atlas binary and the committed migration directory) applies the chain. Its database credential — a new dedicated **`migrator`** Postgres role — lives only in Cloudflare Secrets Store, bound only to that worker, injected only for the seconds the container runs. CI triggers it at the **top of the deploy pipeline** using its **GitHub OIDC identity** (short-lived, per-run, unforgeable) instead of any stored secret; components deploy only after the schema step is green ("schema before app"). A failed migration fails the CI step loudly while the running services keep serving the old schema.

The migrator is **structurally harmless to invoke**: its only capability is "apply the committed chain to the requested head". The destructive one-time staging reset stays in the break-glass cutover path, executed once with the new role so that every table is owned by `migrator` from birth, after which the cutover machinery and every `NEON_DATABASE_URL` reference are deleted from CI.

Around this core, the **CI secrets zeroing program**: runtime credentials move to Secrets Store; public config moves to wrangler vars; Neon-backed test lanes are replaced by hermetic Docker Postgres so `NEON_API_KEY` leaves CI; the CI channel of the staging gate switches to OIDC so the shared gate token leaves CI; zombie secrets are deleted. End state: GitHub Secrets holds **only ~7 deployer-identity credentials** (Cloudflare + Pulumi/R2), each with a one-line justification, scoped least-privilege under #1045.

## User Stories

1. As the maintainer, I want schema migrations executed inside Cloudflare rather than from CI, so that no database credential of any kind lives in GitHub Secrets.
2. As the maintainer, I want "merge to main" to remain "deploy + migrate" with zero manual steps, so that the operational model I liked about Flyway (deploy = migrate) survives the move.
3. As the CI pipeline, I want to trigger the migrator with my per-run GitHub OIDC identity, so that there is no stored trigger secret to steal or rotate.
4. As the maintainer, I want the migration step to run at the top of the pipeline and gate all component deploys, so that schema always precedes the code that depends on it.
5. As the maintainer, I want a failed migration to fail the CI run loudly while live services keep serving the old schema, so that a bad migration pauses the release instead of taking the site down.
6. As the maintainer, I want the migrator's only capability to be "apply the committed chain to head", so that a stolen trigger credential is a doorbell, not a weapon.
7. As the maintainer, I want production triggers to carry the production-environment OIDC claim, so that they inherit the existing manual approval gate automatically.
8. As the maintainer, I want a dedicated `migrator` Postgres role that owns every table from birth, so that future `ALTER TABLE` never hits an ownership wall.
9. As the maintainer, I want the staging cutover's rebuild phase executed by the `migrator` role, so that ownership is correct without ever needing a REASSIGN migration.
10. As the maintainer, I want the cutover workflow and its DSN secret deleted once the cutover has actually run, so that "CI holds no DSN" is true without footnotes.
11. As the maintainer, I want the migrator's DSN stored only in Cloudflare Secrets Store and bound only to the migrator worker, so that no other worker — and no CI job — can read it.
12. As the maintainer, I want the migrator container image to be small and separate from the agent image, so that agent cold-start latency and image size are untouched.
13. As the maintainer, I want the trigger request to carry the expected target version and the response to carry the applied head, so that "the wrong image migrated" is detectable in CI.
14. As the maintainer, I want retries to be plain GitHub "re-run failed jobs", so that no bespoke manual-trigger channel (and no extra credential for it) exists.
15. As the maintainer, I want all runtime credentials (agent DSN, model keys, maps key, observability token, Turnstile, anon-ID secret) consumed from Secrets Store instead of being ferried by CI, so that a compromised CI action can no longer silently read them. *(Seat 1 finding a: these non-DSN runtime secrets have no dedicated card; they are exercised by the Secrets Store migration wave below and counted as **#1057 endgame acceptance items** in the goal — the one-table verdict only holds once every one of them is Store-bound.)*
16. As the maintainer, I want non-secret configuration (`NEON_AUTH_JWKS_URL`, `CORS_ALLOWED_ORIGIN`) in wrangler vars, so that config changes are reviewable diffs instead of invisible secret edits.
17. As the maintainer, I want Python integration tests to run only against the hermetic Docker Postgres arm in CI, so that no Neon credential is needed to test.
18. As the maintainer, I want the catalog spike suite migrated to the same Docker Postgres arm, so that real-SQL coverage (PostGIS, atomic publish flips, schema contract) survives while `NEON_API_KEY` leaves CI.
19. As the maintainer, I want the spike suite to run on every main push once it is hermetic, so that its current half-enabled state (same-repo PRs only, skipped without cloud keys) is cured.
20. As the maintainer, I want the Neon test-base workflow and script retired together with the Neon lanes, so that nothing in CI can mint DSNs anymore.
21. As the maintainer, I want the pipeline-db live dry-run dropped and the hermetic validate/lint kept, so that migration-chain hygiene is still enforced without a database credential.
22. As the maintainer, I want the CI channel of the staging gate to accept my pipeline's OIDC identity (second phase), so that `STAGING_GATE_TOKEN` leaves GitHub Secrets while the human browser channel keeps working.
23. As the maintainer, I want the nine zombie secrets deleted outright, so that the secret inventory contains only things that are actually used.
24. As a security reviewer, I want machine-checkable contract tests asserting that deploy workflows contain no Atlas invocation and no database-credential references, so that the credential-free posture cannot silently regress.
25. As a future contributor, I want the expand-contract discipline written into the migrations contract docs, so that deploy-order windows (new code on old schema and vice versa) stay safe by rule rather than by luck.
26. As the maintainer, I want staging switched first and production switched only after several real migration deploys have run through the new path, so that the cutover of the mechanism itself is de-risked.
27. As the operator, I want migration outcomes (trigger source, applied head, duration, exit code) visible in existing observability, so that every migration has an audit trail.
28. As the maintainer, I want the remaining ~7 deployer credentials scoped to least privilege with a rotation cadence (#1045), so that even the irreducible secrets have bounded blast radius.

## Implementation Decisions

### Migration executor (core)

- **New dedicated migrator worker** in the workers workspace, plus a **one-shot batch container** (no ports; runs the Atlas apply command and exits). The worker orchestrates: verify trigger identity → start container with the DSN injected as env → wait for exit → report result. Rationale: Workers cannot execute binaries; containers are Cloudflare's only real-OS primitive; the batch-job container mode is officially supported.
- **Separate small image**: official Atlas image as base plus the committed migration directory. The agent image is untouched (owner decision Q2). Version alignment between code and migrations is guaranteed by same-pipeline deployment plus the expected-target check, not by image identity.
- **Pipeline placement**: migrator deploy + trigger becomes the first post-build stage; all component deploys (`catalog`, `users`, `web`, root/agent, maintenance) depend on it. The per-component "Atlas migrate" step is deleted everywhere — this also removes today's duplicate applies (catalog and users each ran one) and a latent production fail-closed bug in the components that receive no DSN.
- **Trigger contract** (spec defaults, reviewable): synchronous HTTP call with a generous timeout; request carries the expected migration head (successor of the pinned `ATLAS_TARGET` mechanism — production keeps a pinned target, staging targets head); response carries exit code and applied head; CI step fails unless applied head equals expected. Idempotent by construction: `atlas migrate apply` on an up-to-date ledger is a no-op, and Atlas's advisory lock (`atlas_migrate_execute`) serializes concurrent runs; the lock timeout is raised above the longest expected migration.
- **Production pin advancement** (Seat 1 finding e): the production deploy brings the pinned target forward — the deploy job (or its human approver) sets the successor pin in the release manifest, and CI ships the expected head equal to that successor. Advancement is therefore an **owner/approver action at the production approval gate** (same step that approves the environment), never a silent CI self-advance — mirroring today's `ATLAS_TARGET` bump that accompanies a manual production release. Staging always targets head and needs no pin.
- **No manual trigger channel** (owner decision Q7): retry = GitHub re-run of the failed job. Production re-runs pass the environment approval gate again by construction.
- **Capability boundary**: the migrator has no destructive code path — no schema drop, no arbitrary SQL, no down-migration. The destructive one-time reset lives exclusively in the break-glass cutover script.

### Recovery: applied-but-bad migrations (Seat 1 finding d)

The migrator has **no down-migration by design** (forward-only Atlas chain), so a bad migration that already applied is recovered by roll-forward, never by an automated undo. A recovery runbook is part of this program's output:

- **Trigger-in-time**: the migrator never auto-advances or self-fixes on a failure; a non-zero exit or checksum mismatch fails CI loudly and leaves the production pin **unadvanced** — the running services keep serving the old schema.
- **Detect**: migration outcomes (trigger source, applied head, duration, exit code) land in existing observability (US27); a bad-but-applied migration is caught by the staging smoke (ledger head vs expected) and by the expand-contract rule one version back.
- **Contain + fix forward**: the repair path is **Neon Point-in-Time-Recovery (PITR) to a pre-bad-apply snapshot + forward-fix** (a corrective forward migration), invoked and owned by a human, not the migrator.
- **Emergency flag**: the migrator carries a deploy-time emergency escape that makes it **refuse to apply future heads until a human clears it** — the release pin stays put and CI goes red until the operator intervenes. This is a safety latch, not a bypass: it adds no DROP/arbitrary-SQL capability.
- The runbook lives in `docs/ops/` and is exercised (dry-run) in the staged cutover, so the procedure is proven before it is ever needed in anger.

### Trigger authentication (GitHub OIDC)

- CI jobs request the built-in GitHub OIDC token (`id-token: write`); the migrator verifier validates it with the jose library against GitHub's JWKS, then enforces **per-environment anchored claims** — equivalent claims must NOT be satisfied by a broad OR. Anchoring is environment-specific, not a union:
  - *Staging path (migrator #1051)*: the token's `aud` equals the **migrator staging audience** (see DISTINCT audiences below) AND `sub` is an explicit service identity (`repo:lifeodyssey/animichi:ref:refs/heads/main:environment:staging`-anchored form) AND `environment == staging`. Production triggers never satisfy this.
  - *Production path*: `sub == repo:lifeodyssey/animichi:environment:production` (or `ref:refs/heads/main` AND `environment == production`) AND the production audit audience matches. A staging pipeline with `environment: staging, ref: refs/heads/main` must be rejected by the production path and by staging if `environment` is absent or not staging — the old `(ref==main) OR (environment==production)` union is replaced entirely.
  - **workflow_ref / job_workflow_ref are constrained too** (Seat 1 finding c): the allowlist matches the trusted deploy workflows (`staging-deploy`, `ci.yml` deployment job, `deploy.yml` production job) — a token minted by any other workflow ref (e.g. a compromised or renamed workflow) is rejected regardless of the remaining claims.
  - **Audience request is explicit**: CI requests the token with `ACTIONS_ID_TOKEN_REQUEST_URL` + `?audience=<fixed-project-specific-value>`, and the migrator requires that exact `aud` claim. The audience is part of the trigger contract, not a free-form CI-supplied string.
- **DISTINCT per-service audiences** (Seat 1 finding c): the migrator (#1051) and the staging-gate verifier (#1054) each get their own dedicated audience value, so a token issued for one door cannot be replayed against the other. Within the migrator, staging and production use **separate migrator workers/DSNs** so a staging token physically cannot reach a production migrator (MED-2). Prior art: the **edge worker** already verifies Neon Auth JWTs with jose in `workers/edge/src/identity/auth.ts` — same pattern, different issuer (Seat 2 LOW-2: the citation points at the edge worker, not the users worker).
- The JWKS source is a constructor-injected dependency (tests sign with a local key pair; production points at GitHub). This is the only new test seam in the design.
- **Two-phase rollout of OIDC** (owner decision Q4): phase 1 = migrator trigger (new door). Phase 2 = a CI channel on the staging gate, after which `STAGING_GATE_TOKEN` is removed from GitHub Secrets; the human browser token channel remains. The verifier ships as a reusable module.

### Database identity: the `migrator` role

- A new **`migrator`** role (named to match the existing #831/#855 vocabulary; the earlier working name "job_migrator" collided with `jobs_svc` and is dropped), created via the same IaC path as the runtime roles (Neon-API-created LOGIN role).
- **Ceiling disclosed**: the chain requires CREATE EXTENSION, CREATE ROLE, and blanket GRANTs, so on Neon this role is necessarily `neon_superuser`-grade — numeric privilege narrowing is limited. The enforced minimization is therefore behavioral, three hard rules: (1) single-purpose — never used as any runtime DSN; (2) non-resident — injected only into the batch container for the seconds it runs, present in no worker's standing environment; (3) independently rotatable, unentangled with runtime credentials.
- **Ownership-from-birth**: production currently has zero tables and staging is about to be rebuilt, so if the cutover rebuild and the production first apply both run as `migrator`, every table is owned by it from creation — the Postgres owner-only ALTER rule never bites, and no REASSIGN OWNED remediation is ever needed. (Owner decision Q12.)

### Cutover wave (absorbed into this spec — owner decision Q11)

- Scope: **#1056 is verify + remaining items, not a rebuild** (Seat 2 LOW-1): the pulumi-cwd cutover launcher defect is **already fixed on main** (67e53dba), so the remaining #1056 work is to *verify* that fix holds and close the two outstanding items recorded on #1001 (the neon-secrets deploy failures and the two-key reset script shape). Then → create the `migrator` role → convert the reset script to **two keys** (the destructive DROP runs under the old owner break-glass DSN — semantically correct, only break-glass may destroy; the rebuild apply runs as `migrator`) → execute phases C–F once in the owner's window (jointly with #1001's auth-roster rebuild, which remains #1001's scope) → then **delete the cutover workflow and every `NEON_DATABASE_URL` reference in CI**, including the environment secrets.
- Until the cutover executes, `NEON_DATABASE_URL` survives only as the cutover workflow's break-glass input; the routine deploy path stops referencing it as soon as the migrator path is live.

### Rollout of the mechanism itself

- Staging switches first; production switches only after several real migration deploys have exercised the new path (owner decision Q6). **No env-gated CI fallback apply is kept** — it would require CI to keep the DSN, defeating the goal; the failure mode of the new path is benign (CI red, services untouched).

### Secrets zeroing (companion waves, each independently landable)

- **Production runtime DSN cutover** (sibling ticket, highest priority, no dependency on this spec): replicate the staging Secrets Store pattern to production catalog/users; CI stops uploading the owner DSN as a worker secret.
- **Secrets Store migration**: agent DSN, model keys (MiMo/DeepSeek), maps key, observability token, Turnstile secret, anon-ID secret all become Store bindings; the deploy-time "resolve effective worker secrets" upload machinery retires. *(Seat 1 finding a: these are US15's non-DSN runtime secrets — they have **no standalone card**, so they are named here as **#1057 endgame acceptance items**: #1057 closes only when each of these is a Store binding with CI no longer ferrying it, verified by the contract seam below. Keeping them shimmed as GH secrets past endgame fails the one-table verdict.)*
- **Vars demotion**: `NEON_AUTH_JWKS_URL` and `CORS_ALLOWED_ORIGIN` become wrangler vars (they are public values; secret handling of config caused a real 2026-08-04 staging outage). *(Seat 2 LOW-5: partial completion is acknowledged — both already exist as edge vars for some environments per #528 — so the remaining work is removing the stale GH secret entries + the upload step and aligning the users/root surfaces, not re-adding the config from scratch.)*
- **Neon test-infra retirement**: delete the Python Neon integration lane, migrate the catalog spike suite (**22 `*.spike.test.ts` files — Seat 2 LOW-3 corrects the earlier "18"**; the count is asserted by the suite glob in the retiring workflow, not restated loosely) to the same Docker Postgres arm (its value is real-SQL behavior — PostGIS, concurrent publish atomicity, schema contract — which needs real Postgres, not real Neon), delete the test-base refresh workflow and script, drop the pipeline-db live dry-run (keep hermetic validate + lint). Net: **`NEON_API_KEY` leaves CI entirely**. The Supabase secret trio is audited in the same wave (auth is Neon-Auth-only since #950) and removed if confirmed dead.
- **DB-backed integration coverage must survive the Neon lane retirement** (Seat 2 MED-3): the claim "the hermetic Docker arm is already the default" is **not accurate for CI** — `pipeline-agent.yml` runs only unit tests, and the *only* DB-backed integration lane in CI is `ci.yml` Python-integration with `TEST_DB: neon`. Deleting it would therefore lose the repo's only DB integration coverage unless a hermetic Docker Postgres Python integration lane is stood up in CI. `#1053` is executed with one of these two mandatory outcomes: **(1)** stand up (or keep) a hermetic Docker Postgres Python integration lane in CI mirroring the #1049 pattern, or **(2)** explicitly accept and document the coverage loss on #1053 before any Neon test infra is deleted.
- **Zombie deletion**: the nine unreferenced secrets are deleted outright; re-adding any one later is a paste, not an incident.
- **Residual scoping**: the ~7 surviving deployer credentials are scoped per #1045 (already filed). *(Seat 2 LOW-4: two workflow-referenced keys were missing from both the zombie list and the endgame table and their disposition is written here — `ZEN_GO_API_KEY` (eval) → Secrets Store / wrangler vars per the Secrets Store migration wave, counted as #1057 endgame items; `GITLEAKS_LICENSE` → keep (it gates scannability of secrets itself) with a one-line justification in the endgame inventory, or explicitly explain a removal. Neither is a silent zombie.)*

### End-state acceptance (the one-table verdict)

GitHub Secrets contains only: Cloudflare deploy tokens (3), Pulumi/R2 state backend entries (4), plus the built-in `GITHUB_TOKEN`. **No DSN, no runtime API key, no shared static trigger/gate token, no Neon control-plane key.** Machine-checkable contract tests enforce the posture. *(Seat 2 LOW-4: the eval key `ZEN_GO_API_KEY` and the scannability key `GITLEAKS_LICENSE` are workflow-referenced and are folded into the endgame inventory — the former migrates to Store/vars (a #1057 item, not a zero-row), the latter is kept-or-explained — so the one-table verdict is computed over a *complete* inventory, not the ~7 alone.)*

## Testing Decisions

Good tests here assert **external behavior at existing seams**; nothing tests Atlas internals or Cloudflare's platform.

1. **Worker HTTP seam** (primary, for the migrator worker): drive the worker through its HTTP interface. Valid OIDC token → container started, success + applied head returned; invalid/expired/wrong-repo/wrong-audience token → rejected; non-zero container exit → failure reported. The container binding is faked (scripted exit codes); JWTs are signed with a test key pair via the injected JWKS seam. Prior art: the **edge worker's** jose JWT-verification tests (`workers/edge/src/identity/auth.ts` — LOW-2 corrects the citation from the users worker to the edge worker); the catalog worker's workerd-pool tests with faked bindings.
2. **Workflow/config contract seam**: the existing migration-boundary contract test is inverted — deploy workflows must contain **no** Atlas invocation and **no** `NEON_DATABASE_URL`/`NEON_API_KEY` references; the migrator trigger job must exist ahead of component deploys. The cutover contract test updates to the two-key script shape. Secrets-Store/vars moves are asserted the same way (bindings present in worker config; CI no longer ferries). Prior art: the migration-boundary test and the session3-cutover contract check — this repo's established pattern of asserting workflow content.
   *(Seat 1 finding b — these two behaviors are **written into card acceptance criteria**: US24 (this seam) and US25 (expand-contract below) are named as acceptance criteria on **#1051** (trigger ahead of deploys, no Atlas/no DB-cred refs in the workflows that card ships) and **#1052** (staging pipeline reorder: schema-before-app enforced, component Atlas steps removed). A card is not green on #1051/#1052 without its corresponding contract assertion in place — per the quality ratchet, `ac_with_test` counts the mutation-checked contract test.)*
3. **Hermetic Docker Postgres seam**: the migrated spike suite's setup applies the Atlas chain to a clean Postgres before every run — continuous "the chain applies cleanly" verification for free, plus the preserved real-SQL coverage. Prior art: the agent's offline Docker integration arm.
4. **Staging smoke seam**: the post-deploy smoke asserts the migration step outcome and that the ledger head equals the expected version, alongside existing health checks.

Explicitly not tested: Atlas CLI internals; container image build (CI build is the verification); the destructive cutover execution (one-time human-windowed operation guarded by contract tests on its shape, not by rehearsal).

## Out of Scope

- **App-boot (Flyway-style) migration** — evaluated in #1039 and rejected; the evaluation doc remains as the record.
- **#1001's auth-roster rebuild** — executed in the same window as the cutover wave but owned by #1001.
- **Migrating deploys off GitHub Actions onto Workers Builds** — the only path that would eliminate the Cloudflare deploy token itself; noted as a possible future, not pursued.
- **Switching migration tools** (e.g. Drizzle's TS migrator to avoid the container) — rejected: it would discard the Atlas chain, checksums, lint, and ledger for marginal benefit and weaker locking.
- **Neon project separation for test infrastructure** — superseded by full `NEON_API_KEY` removal, which is strictly stronger.
- **Execution details of #1045** (residual credential scoping) — filed separately.
- **Any change to the runtime role matrix** (`catalog_svc`/`agent_svc`/`users_svc`/`jobs_svc`/`readonly`) beyond table ownership moving to `migrator`.

## Further Notes

- **Evidence base**: four primary-source research passes (Neon credential model & federation absence; Cloudflare Containers rollout/batch-job/Secrets Store; Atlas advisory lock & official deployment catalog; Flyway/Spring official stance) plus two repo audits and a four-fact grilling verification (cutover never actually executed — both runs died in phase C; deploy DAG order; spike coverage map; role-matrix reality: the owner DSN moonlights as production runtime credential). Key citations live in the conversation record and #1039's evaluation doc; the residual-credential table lives in #1045.
- **Sequencing**: the production runtime DSN cutover (sibling) and zombie deletion can land immediately (IaC/manifest/Store work is landable without touching the release pin). The migrator wave lands next (staging first). The cutover wave needs the owner's window and completes the DSN deletion. OIDC phase 2 (gate) and #1045 close the program.
- **SAFE-1 production-freeze precondition (Seat 2 MED-1)**: the release-manifest pin (`release-eligibility.sh`, pinned blob) blocks **all** production deploys of campaign code. Consequently the production-side execution of #1048/#1055 *cannot complete a production deployment* until SAFE-1 is re-pinned — that re-pin is an **owner action** recorded in this goal's owner-action list. The IaC/manifest/Store-side pieces of #1048/#1055 land before the re-pin; the live production cutover waits on it.
- **Security framing honesty**: CI-as-deployer retains *transitive* reach (it deploys code that can read runtime secrets) — that is inherent to being the deployer. What this program eliminates is every *silent* path: standing credentials readable by any compromised CI action. Post-change, reaching the database from a compromised CI requires shipping a visible, attributable deploy.
- **Expand-contract discipline** becomes a written rule in the migrations contract docs: every schema change must be compatible with the currently deployed consumers one version back; this was already implicitly required (migration and component deploys were never atomic) and is what makes both deploy-order windows (new code on old schema; old code on new schema) safe.

## Amendment (2026-08-16 spec review)

Dual-seat spec review completed 2026-08-16: seat 1 APPROVE-with-findings, seat 2 REJECT amend-and-approve. Both verdicts' findings are folded into the sections above; this section summarizes what changed and where.

> **Correction (PR #1059 standards review S2):** the catalog spike-suite count is corrected **21 → 22** `*.spike.test.ts` files (verified — `vitest.spike.config.ts` glob `test/**/*.spike.test.ts` matches 22 files).

**Seat 1 findings (folded into the body above):**
- **(a)** US15 and the *Secrets Store migration* bullet now name the non-DSN runtime secrets (model keys MiMo/DeepSeek, maps key, observability token, Turnstile, anon-ID secret) as **#1057 endgame acceptance items** (see User Stories §15 and Secrets Store migration bullet).
- **(b)** US24/US25 are now **written into #1051/#1052 acceptance criteria** under the Testing Decisions contract seam.
- **(c)** The OIDC allowlist now uses **per-environment anchored claims**, constrains **workflow_ref/job_workflow_ref** to the trusted deploy workflows, and uses **DISTINCT per-service audiences** for the migrator (#1051) and the staging-gate verifier (#1054) to prevent cross-service token replay — see the Trigger authentication section.
- **(d)** A **rollback/recovery runbook** for applied-but-bad migrations (Neon PITR + forward-fix + emergency flag; no down-migration by design) is specified under Migration executor (new *Recovery* subsection).
- **(e)** **Production pinned-target advancement** is specified (owner/approver action at the production gate, not silent CI self-advance) in the Trigger contract bullet.
- **(f)** The edge **#1053 → #1057** is added to the goal DAG (endgame acceptance requires `NEON_API_KEY = 0`).

**Seat 2 findings (MED + LOW, all folded in):**
- **MED-1** — SAFE-1 production-freeze precondition on #1048/#1055 written under *Sequencing*; the re-pin is recorded in the goal's owner-action list.
- **MED-2** — the OIDC claims allowlist is rewritten from the too-broad `(ref==main) OR (environment==production)` union to anchored per-environment claims; staging and production use **separate migrator workers/DSNs**; `aud` request via `ACTIONS_ID_TOKEN_REQUEST_URL?audience=<fixed>` is documented.
- **MED-3** — the "hermetic Docker arm is already the default" claim is corrected (pipeline-agent.yml runs unit only; ci.yml `TEST_DB: neon` is the sole DB-backed lane) and #1053 acceptance now mandates standing up a hermetic Docker Postgres Python integration lane (or explicitly accepting/documenting the coverage loss).
- **LOW-1** — #1056 is **verify + remaining items** (the cutover pulumi-cwd defect is already fixed on main 67e53dba), not a rebuild.
- **LOW-2** — the jose/JWKS prior-art citation is corrected from the users worker to the **edge worker** (`workers/edge/src/identity/auth.ts`).
- **LOW-3** — the catalog spike suite count is corrected to **22** `*.spike.test.ts` files (was 18).
- **LOW-4** — `ZEN_GO_API_KEY` (→ Store/vars, #1057 item) and `GITLEAKS_LICENSE` (kept-or-explained) disposition written into the endgame inventory.
- **LOW-5** — `CORS_ALLOWED_ORIGIN`/`NEON_AUTH_JWKS_URL` partial completion (#528) acknowledged; remaining work is removing GH secret entries + upload step and aligning users/root.
