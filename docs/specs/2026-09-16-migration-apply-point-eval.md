# Where the migration chain is applied from — evaluation (#1039)

- Status: **evaluation, no implementation** (the card asks for a document, not a change).
- Card: [#1039](https://github.com/lifeodyssey/animichi/issues/1039) — child of #1004.
  Owner direction under evaluation (2026-08-15): the **Flyway position** — the *application*
  applies the chain at boot with its own connection, so CI holds no staging/production database
  credential.
- Baseline: `origin/main` = `3ba3449e2` (2026-09-16). Every `path:line` below was read at that
  revision; every URL was fetched 2026-09-16.
- Predecessor: `docs/archive/specs/2026-08-15-embedded-migration-eval.md` (same question, first
  answer, archived 2026-09-15 by #1649). Its Q1 conclusion — that Atlas has no position on the
  apply point — is contradicted by Atlas's own deployment guide; see §1.4.

## Recommendation

**Reject the Flyway position. Keep the apply point where it is: a platform-side, OIDC-triggered
executor — the migrator Worker — and never give a serving process a DDL-capable connection.**

The owner's actual goal is "CI must not hold database credentials". That goal is already met for
direct credentials (`.github/test/cd-credentials.test.rb:61-64` asserts `cd.yml` contains no
`*DATABASE*` name at all), and the executor meets it *better* than app boot: app boot would move a
`neon_superuser`-grade credential out of a non-resident, single-writer, per-release executor
(`workers/migrator/AGENTS.md:98-100`) and into every serving replica of an internet-facing
container, while leaving the one credential CI really retains — the Neon control-plane key —
untouched. See §3.

## 0. The question moved under the card

Three changes landed after 2026-08-15 and each one independently removes the host the Flyway
position needs:

1. **The decision was already recorded, the other way.** `docs/specs/2026-08-16-migration-executor-spec.md:4`
   records that it "resolves the *decision-pending* status of the embedded-migration evaluation
   (#1039): option B (app-boot) is **rejected**, option C′ (platform-side migration executor) is
   **chosen**", and `:18` gives the reason (containers have no health-gated rollout or automatic
   rollback; deploy success ≠ migration success; every cold start pays a no-op check; a DDL
   credential enters the serving container). That spec's header still reads `Status: PROPOSED`
   (`:3`) — the status field never moved past proposal — yet that same line records the owner
   Q1–Q12 grilling sign-offs (2026-08-15/16), and the option the spec chose, C′, is the path that
   ships (§3.1). The predecessor evaluation is archived because that spec supersedes it (archive
   header `:3-6`: #1649; #1039 → #1046).
2. **The newest owner-signed target re-affirms the executor.** `docs/specs/2026-09-12-prisma8-database-layer-spec.md`
   (owner-signed 2026-09-13) replaces Atlas with Prisma 8 as the DDL authority and says so without
   ambiguity — §三 非目标: "ADR 0006 决策 6（CI 永不持有数据库凭据）与 migrator Worker 作为唯一迁移入口的形态
   **不变**" (`:458`). Its §4.6 rewrites the release handshake down to the Prisma half *inside
   the same Worker* (`:650-682`), and §4.1 keeps one chain and one executor (`:477-513`).
3. **The only service with a boot is being deleted.** `apps/agent` is the sole process in this repo
   with a startup lifecycle, and #1607 (`gh issue view 1607`) is "delete the python agent and its
   ci lane" — `git rm -r apps/agent`.

So this document does not re-litigate #1046. It answers the card's six questions against today's
tree, states the recommendation plainly, and records what adopting the alternative would cost, so
the owner can overrule on evidence rather than on a stale premise.

## Q1 — What Atlas officially recommends

### 1.1 The page

**https://atlasgo.io/guides/deploying/intro** ("Deploying Schema Migrations"), fetched 2026-09-16.
The section *Running migrations on server initialization* is the app-boot option, and Atlas
discourages it:

> "In our experience, this strategy may work for simple use-cases, but may cause issues in larger,
> more established projects. Some downsides of running migrations on boot are:
> - If multiple replicas of the server code are deployed concurrently to avoid dangerous race
>   conditions, some form of synchronization must be employed to make sure only one instance tries
>   to run the migration.
> - If migrations fail, the server crashes, often entering a crash-loop, which may reduce the
>   overall capacity of the system to handle traffic.
> - If migrations are driven by a dedicated tool (such as Atlas, Liquibase, Flyway, etc.) the tool
>   needs to be packaged into the same deployment artifact. This is both cumbersome to invoke and
>   goes against security best practices to reduce attack surface by including only the bare
>   minimum into runtime containers."

The same page then gives the recommended shape:

> "Instead of running migrations on server init, we suggest using a deployment strategy that
> follows these principles: Schema migrations are deployed as a discrete step in the deployment
> pipeline, preceding application version changes. If a migration fails, the whole deployment
> pipeline should halt. Measures should be taken to ensure that only one instance of the migration
> script runs concurrently."

Note the third bullet: it is *Atlas's own* security argument against putting the migration tool in
the runtime image — the same argument §3 makes about the credential.

### 1.2 Supporting pages

| Page | What it establishes |
|---|---|
| https://atlasgo.io/integrations/go-sdk | The Go SDK is `atlasexec`, "a simple wrapper SDK … around the Atlas CLI". "The public API which the project commits to support is the CLI." It is a CLI driver, not an in-process migration primitive, and it is Go-only. |
| https://atlasgo.io/guides/deploying/image | The recommended artifact is a **dedicated** image "that contains the migrations directory" and the Atlas binary (`FROM arigaio/atlas` + `COPY migrations /migrations`), built for a pipeline step — not the app image. |
| https://atlasgo.io/guides/deploying/k8s-init-container | The nearest thing to boot-time application Atlas offers, and it is **deprecated on the page itself**: "This method of running schema migrations is no longer recommended. Please use the Kubernetes Operator." Even so it keeps the migration tool and its credentials in a purpose-built image, and relies on Atlas's advisory lock for the multi-replica race. |
| https://atlasgo.io/guides/deploying/k8s-argo | The ordered-deployment shape: Atlas on sync-wave `1`, the app on `2` — i.e. "schema before app", expressed as two steps. |
| https://atlasgo.io/versioned/apply | The verb this repo already uses (`atlas migrate apply --dir … --url … --revisions-schema public`), matching `docs/ops/migrations.md:77-82`. |

### 1.3 What this means for the card's Q1

Atlas's official recommendation is **pipeline-applied, as a discrete step, ahead of the
application**. App-boot is a supported-by-construction pattern (the CLI is a process; nothing stops
you from calling it from a boot hook) but it is explicitly *not* what Atlas recommends, and the
three reasons Atlas gives apply to this repo verbatim (see §2 and §3).

### 1.4 Correction to the archived evaluation

`docs/archive/specs/2026-08-15-embedded-migration-eval.md:17` concludes: "Atlas has no single
'must run in CI vs must run in the app' position (see Q1)"; its Q1 restates it at `:41`. Its own Q1
then cites
https://atlasgo.io/guides/deploying/k8s-argo and https://atlasgo.io/integrations/go-sdk — but not
`/guides/deploying/intro`, the page that states the position. The spec that supersedes it
(`docs/specs/2026-08-16-migration-executor-spec.md:18`) already asserts "Atlas's own deployment
guidance explicitly discourages migrate-on-startup", which is the correct reading — **this
evaluation's Q1 corrects the archived one.**

**Unverified:** Flyway's own documented position. The `migrate` command reference
(https://documentation.red-gate.com/flyway/reference/commands/migrate, fetched 2026-09-16) documents
what `migrate` is and how to invoke it; it does not state where it should be invoked from. Treat
"the Flyway position" as the owner's shorthand for *the application applies the chain at boot with
its own connection*, and evaluate that, which is what this document does.

## Q2 — Feasibility here: who actually has a boot

### 2.1 The services, and what "boot" means for each

| Surface | Process model | Boot/lifecycle today | Would own the chain under app-boot? |
|---|---|---|---|
| `apps/agent` (FastAPI, Cloudflare Container) | One container, `max_instances = 3` (`workers/edge/wrangler.toml:161`) | Yes — `CMD ["python","-m","animichi.interfaces.fastapi_service"]` (`apps/agent/Dockerfile:74`) → `main()` → `uvicorn.run` (`apps/agent/src/animichi/interfaces/fastapi_service.py:287`); the natural seam is the FastAPI lifespan (`:118-160`), which already sequences `create_database_lifecycle` at `:131` | **Yes, by fiat** — and it is *only* the agent's tables + catalog + users tables that would ride along |
| `workers/catalog` | Cloudflare Worker | **None.** No init phase, no start hook | No |
| `workers/users` | Cloudflare Worker | **None** | No |
| `workers/edge` | Cloudflare Worker + Durable Objects | **None for the Worker.** A DO has a per-instance constructor and `bootstrapNativeSession` (`workers/edge/src/agent/host/native-bootstrap.ts:27-40`) runs on it — but that is one boot **per DO instance**, not one per deployment, and it connects as `agent_svc` | No |
| `workers/migrator` | Cloudflare Worker + one fixed DO lock | **None.** It is driven by an authenticated HTTP request: `POST /migrate` (`workers/migrator/AGENTS.md:62`; the caller's side is `scripts/delivery/migrate-through-worker.sh:54-73`) | It *is* the chain owner today |

### 2.2 Who applies the Workers' tables, said plainly

This is the question the card insists must not be left implied.

- **Under app-boot (option B):** the chain has no owner of its own for `workers/catalog` and
  `workers/users`. Those Workers cannot apply it — they have no boot — so the apply would happen
  because the *agent container* happens to boot. That is a coupling, not a mechanism: if the
  container never starts (bad image, OOM — `workers/edge/wrangler.toml:337` already records an OOM
  risk at the smaller instance type), catalog and users drift under the old schema with nothing
  red. The predecessor evaluation identified this and answered it with "keep an env-gated,
  idempotent CI backstop apply" — which reinstates exactly the CI database credential the exercise
  exists to remove.
- **Under the executor (option C′ / current):** the migrator Worker applies the chain for **all
  tables in one run**, for both kinds of service, independent of whether any service is up. That
  is why `migrations/AGENTS.md:9` can say "schema before app" as a deploy invariant rather than a
  hope.

After #1607 lands there is **no application with a boot left in this repository at all**: the
remaining surfaces are Workers, and Workers do not run a start phase. Option B would therefore first
have to be re-hosted on something that is not an application.

### 2.3 The card's Q2 premise is stale

The card proposes "pinned atlas 0.30.0 binary baked into the image (checksum-verified,
`install-atlas` action pattern)". At `3ba3449e2`:

- `.github/actions/` contains only `hydrate-release` and `setup-workspace`. The `install-atlas`
  composite action no longer exists.
- Atlas enters CI only as `ariga/setup-atlas@2f3c785c…` in `.github/workflows/pr-verification.yml:159,445,497` and
  `.github/workflows/release-build.yml:56`, for the static `atlas migrate validate` lane.
- `.github/workflows/cd.yml` must contain **no** Atlas invocation and **no** `ariga/setup-atlas` at
  all — machine-pinned by `workers/edge/test/migration-boundary.test.ts:75-80`.
- The container has never carried a migration tool: `apps/agent/src/animichi/interfaces/fastapi_service.py:151-152`
  states "Schema changes are never applied by the application. Neon catalog/user migrations run
  through Atlas from `migrations/neon`".

So the image-build half of option B would be new work (bake and checksum-verify a Go binary into a
Python image, then invoke it from a lifespan) against a machine-checked invariant that currently
says the opposite.

### 2.4 The rollout behaviour that makes boot-apply dangerous *here*

Cloudflare Containers have no health-gated rollout and **no automatic rollback**:
https://developers.cloudflare.com/containers/configuration/rollouts/ (fetched 2026-09-16) documents
SIGTERM → 15-minute drain → SIGKILL, per-instance scheduling ("The fleet does not restart in a
single moment"), and states outright: **"Deploy success means the rollout started, not that every
container instance has finished replacing."** It further warns: **"When the image changes, new
Worker code can still reach container instances on the previous image until the rollout finishes."**
With `max_instances = 3` and the default `rollout_step_percentage` of `[10, 100]`, the first step
puts one replica on the new image while the other two still run the old one. A boot-time migration
on that first replica runs the chain from inside a partially-rolled fleet — the exact window the
"schema before app" ordering exists to make boring, and one in which a failed apply crash-loops the
replica that Cloudflare will route traffic to.

## Q3 — The privilege question (the real one)

Three arrangements, compared on where a DDL-capable credential lives.

| | **A. Runtime role carries migration grants** | **B. Separate boot migrator connection in the app** | **C. Executor-side, non-resident (today)** |
|---|---|---|---|
| Who holds the DDL credential | Every replica of the serving container, all the time | Every replica of the serving container, at boot; ideally not after | The migrator Worker only, resolved after OIDC, used for the duration of the apply |
| Blast radius of a compromised app replica | Full DDL on the data plane | Full DDL during the boot window | No DDL — the runtime role has none |
| New secrets concentrated where | None new, but `agent_svc` widens to DDL | A second DSN (`BOOT_MIGRATOR_DATABASE_URL`) in `CONTAINER_ENV_KEYS` | None new |
| What CI keeps | Decided by Q5 | Decided by Q5 | No `*DATABASE*` name at all (`.github/test/cd-credentials.test.rb:63`) |
| Machine guard it must defeat | — | `workers/edge/test/migrator-role-isolation.test.ts:33-40` (the migrator DSN must not appear in the container allowlists) and `migrations/AGENTS.md:83` ("**Never** app runtime") | None to defeat; the guards *are* the design |

Elaboration:

- **A is not available.** `agent_svc` has no DDL rights by design (`migrations/AGENTS.md:83-88`), and
  widening it would collapse the roles matrix #831/#855 is built on. The predecessor evaluation
  reached the same conclusion.
- **B is the honest form of the Flyway position** — and it is a worse trade than it looks. The
  migrator role is not narrowly scoped: "the chain requires CREATE EXTENSION, CREATE ROLE, and
  blanket GRANTs, so on Neon this role is necessarily `neon_superuser`-grade"
  (`docs/specs/2026-08-16-migration-executor-spec.md:97`); minimization is *behavioral* by three
  rules, the second of which is non-resident — "The migrator DSN is Secrets Store only"
  (`workers/migrator/AGENTS.md:99`). B reverses rule 2 for the one workload in the repo that serves
  anonymous internet traffic. `workers/edge/test/migrator-role-isolation.test.ts:10-13`
  calls the property out by name and asserts it over `CONTAINER_ENV_KEYS`,
  `CONTAINER_REQUIRED_KEYS` and every runtime `wrangler.toml`; `workers/edge/test/migrator-role-isolation.test.ts:50-59`
  adds that each deployed migrator environment binds **its own** Secrets Store DSN, so staging and
  production cannot be confused for one another. Env-gating the boot DSN (`RUN_MIGRATIONS_ON_START`)
  does not restore the property: the value is still in the container's secret surface and in the
  crash-dump/log surface of a process that has one.
- **C is what ships**, and it is a *stronger* version of what the Flyway position was reaching for.

### 3.1 What the shipped path actually is

`scripts/delivery/migrate-through-worker.sh` — the script the whole argument is about:

| Property | Evidence |
|---|---|
| CI proves identity, holds no credential | `:47-52` mints a GitHub OIDC token with `audience=animichi:github-actions:migrator`, over TLS only (`:34-38`) |
| The Worker holds the DSN | `workers/migrator/AGENTS.md:98-100`; `MIGRATOR_DATABASE_URL` from Secrets Store, rejected by every runtime `wrangler.toml` (`workers/edge/test/migrator-role-isolation.test.ts:40-48`) |
| Exactly what the release packaged is applied | `:40-43` derives the sealed head from the release's own filenames; the Worker answers `409 stale_bundle` to a head its carried chain cannot reach (`workers/migrator/AGENTS.md:59-74`) |
| One writer | A fixed-name Durable Object mutex serializes apply (`workers/migrator/AGENTS.md:40-42`) |
| No destructive path | `workers/migrator/AGENTS.md:98-100` — "NO destructive path — no schema drop, no arbitrary SQL, no down-migration" |
| The chain is applied before the consumers | `.github/workflows/cd.yml:140-153`: apply → verify the catalog schema → publish services |

Note the last row's second step: `verify-catalog-schema.sh` exists because "the chain applied" and
"the catalog exists" are different claims (`workers/migrator/AGENTS.md:92-96`). Under option B that
verification gets *harder*, not easier: the apply's success is reported by an anonymous replica's
boot log rather than by an authenticated response, and there is no `expectedHead` to compare against.

### 3.2 What CI retains afterwards, honestly

- Direct database credentials: **none.** `.github/test/cd-credentials.test.rb:61-64` asserts `.github/workflows/cd.yml`
  contains no name matching `\b[A-Z][A-Z0-9_]*DATABASE[A-Z0-9_]*\b`, no `secret bulk` / `secrets:`,
  and none of the retired or runtime credential names; `docs/ops/secrets.md:38-39` records
  "`grep -c 'secrets\.' .github/workflows/*.yml` is 0".
- The Neon **control-plane** key (`NEON_API_KEY`) is still defined in the two ESC environments
  (`docs/ops/secrets.md:49`) even though no `.github/workflows/cd.yml` job exports it any more
  (`.github/workflows/cd.yml:101,256` export exactly three and one name respectively;
  `.github/test/cd-credentials.test.rb:8` lists
  `NEON_API_KEY` under `RETIRED`). **CD still spends it**, through Pulumi config rather than the env
  name: the `Apply database access` step runs `pulumi up` on
  `release/foundation/infra/database-access` in both jobs (`.github/workflows/cd.yml:128-133`,
  `:283-288`), and that program builds `new neon.Provider("neon", { apiKey:
  config.requireSecret("neonApiKey") })` (`infra/database-access/index.ts:75`) from the
  stack-bound ciphertext committed at `infra/database-access/Pulumi.staging.yaml:10` and
  `infra/database-access/Pulumi.prod.yaml:36`. The remaining consumers are operator-side: `make
  dev-db` (`Makefile:205,217`) and `infra/database-access/reset-staging-baseline.sh:80`. Per #1046
  fact 3, a Neon API key can read connection strings and reset role passwords — so it is a
  database-credential-*minting* capability, and **app-boot migration does not remove it**: the
  destructive reset (Q5) and any branch provisioning still need it. Option B's headline benefit is
  therefore already banked, and the residue it leaves is untouched.

> Drift worth noting: `docs/ops/secrets.md:183` still describes `NEON_API_KEY` as exported into
> `cd.yml`'s `stage` job "where `neonctl` spends it on the staging baseline reset". At `3ba3449e2`
> that is false twice over — `stage` exports only `CLOUDFLARE_API_TOKEN,CF_ACCESS_CLIENT_ID,CF_ACCESS_CLIENT_SECRET`
> (`.github/workflows/cd.yml:101`) and `.github/test/cd-credentials.test.rb:61-64` would fail if the
> name appeared. The reset is not
> wired to any workflow (`.github/test/cd-stage.test.rb:36` refutes `reset-staging` in `cd.yml`).
> The sentence is stale; the workflow and its contract test are right.

## Q4 — The fixture data plane (`test-base`)

- **Today:** CI holds no DSN for it. Every DB-backed test builds its database in a disposable
  container — `packages/test-postgres/src/test-postgres.ts` creates a pristine database from
  `template1` and applies the chain (`:119`), with the nine consumers listed at
  `docs/specs/2026-09-12-prisma8-database-layer-spec.md:332-341`. The Neon `test-base` branch is
  "refreshed manually with a personal `NEON_API_KEY`" and "no DB-backed CI lane connects to it"
  (`docs/ops/neon-env-topology.md:12`). The control-plane key is not a database credential; the
  scripted refresh stays scripted.
- **Under the Flyway position:** nothing improves. `test-base` is not a deployed application and has
  no boot to hook; making the chain apply "at app boot" would mean running a fixture-only app to
  migrate a fixture. The predecessor evaluation reached the same answer
  (`docs/archive/specs/2026-08-15-embedded-migration-eval.md:75-79`).
- **Decision:** keep the fixture chain **scripted/in-process**. The only change already scheduled is
  a host swap — the Prisma 8 spec replaces `applyAtlasChain` with a Prisma apply and moves extension
  DDL into the chain's first migration (`docs/specs/2026-09-12-prisma8-database-layer-spec.md:683-690`).

## Q5 — The one-time destructive reset

The card names `atlas schema clean` as the primitive. It is not the one in the tree, and that is
load-bearing.

**Where it runs today:** `infra/database-access/reset-staging-baseline.sh` — an operator script, not
a workflow step. It is fail-closed in three independent ways, and idempotent besides; those three
are the answers to "which option stays safe":

1. **Target identity is asserted before any DDL**: it reads the staging and production branch ids
   from the Pulumi stack configs and refuses unless they resolve and differ
   (`infra/database-access/reset-staging-baseline.sh:24-31`).
2. **"Cannot confirm" is not "not applied"**: `query_bool` captures the exit status of the query, so
   a failed connection refuses the reset instead of falling through to the `DROP`
   (`:40-51`; the fail-open version of this is a fixed incident, `docs/specs/2026-09-05-repo-smell-audit.md:283`).
3. **A backup branch exists before the drop** (`:62-71`).
4. **It is idempotent and self-terminating** — a no-op once the baseline version is applied (`:79-82`),
   and the reset SQL runs in one transaction under `neondb_owner` (`:73-77`,
   `infra/database-access/reset-staging-baseline.sql:1-3`).

Options, and the verdict on each:

| Option | Verdict |
|---|---|
| Operator script holding only the control-plane `NEON_API_KEY` (today, `reset-staging-baseline.sh`) | **Keep.** Only the operator path destroys; the routine path cannot reach it; it authenticates through `neonctl psql` and holds no DSN; the guard tests are test-pinned (`workers/edge/test/staging-baseline-reset.test.ts`). |
| One-shot CI job with a break-glass DSN | **Rejected.** It re-introduces a database credential into CI and spends a `neon_superuser`-grade one — for a once-ever action. |
| Neon console owner action | **Viable fallback** for the physical DROP (branch reset / restore), but it loses the in-repo identity rails and the audit trail in the script. Use only if the script cannot reach the branch. |
| Env-gated app-boot clean (`RUN_MIGRATIONS_ON_START=clean`) | **Rejected outright.** A destructive verb inside a serving process that any future deploy can trigger is the worst possible placement (`docs/archive/specs/2026-08-15-embedded-migration-eval.md:85` reached this first). |
| `atlas schema clean -u <DSN>` as the primitive | **Rejected as a replacement.** `DROP SCHEMA … CASCADE` + recreate inside one transaction under a named role with an explicit target assertion is strictly stronger than a raw clean against whatever URL is in the environment. |

Under the current target this question partially dissolves: the one-time reset **already happened**
for staging (`docs/specs/2026-09-12-prisma8-database-layer-spec.md:275-289` records the reset and
that production has never been migrated at all — 0 tables), so what remains is a *rebuild* on an
empty database. The marker `migrations/neon/STAGING_ONLY_BASELINE` and its guard
`infra/database-access/production-baseline-guard.sh` are slated for deletion by #1621, not
repurposed (`docs/specs/2026-09-12-prisma8-database-layer-spec.md:805-822`). Note the guard is what
makes "cannot touch production" true *today*: `.github/workflows/cd.yml:216` refuses a production
promotion whose payload carries the marker.

## Q6 — Ordered path, risks, rollback

### 6.1 The recommended path (accept the executor; do not add a boot apply)

Ordered, with what each step is and is not:

1. **Image build — no change.** Do not add Atlas (or any migration tool) to `apps/agent/Dockerfile`.
   #1607 deletes the image entirely; adding a binary to it now is work that gets deleted.
2. **Deploy flow — keep the order, shorten the handshake.** `.github/workflows/cd.yml:111-166` stays
   `preflight → publish migrator → preflight(native) → apply → verify catalog schema → publish
   services`. When Prisma 8 lands, `.github/workflows/cd.yml:114` and `:269` (the `--atlas-only`
   steps; the Prisma spec cites the same two as `cd.yml:114` / `:246` on its older baseline) are
   deleted per `docs/specs/2026-09-12-prisma8-database-layer-spec.md:669-682` — the ordering property survives,
   the Atlas half does not.
3. **CI workflows — keep the OIDC handshake.** `scripts/delivery/migrate-through-worker.sh` remains
   the only apply trigger; `workers/edge/test/migration-boundary.test.ts:54-73` keeps every
   environment on its own `id-token: write` job and keeps `NEON_DATABASE_URL` out of `cd.yml`.
4. **Roles and grants — one direction only.** No new boot role. `migrator` stays non-resident and
   single-purpose (`workers/migrator/AGENTS.md:98-100`); `agent_svc`/`catalog_svc`/`users_svc`
   never gain DDL. The scheduled move of role DDL into Pulumi
   (`docs/specs/2026-09-12-prisma8-database-layer-spec.md:781-797`) narrows who creates roles; it
   does not change who applies the chain.
5. **Docs — one pass, in the same change as the code it describes.** `docs/ops/migrations.md:22`
   ("The application never runs migrations at startup") restates the decision, and
   `migrations/AGENTS.md:79-88` carries the role rules. **Three ops-doc locations are stale at
   `3ba3449e2`** and need correcting in that pass rather than citing as current:
   `docs/ops/migrations.md:69-95` (still names the "one-shot Atlas batch container" and a
   production `NEON_DATABASE_URL` apply), `docs/ops/neon-env-topology.md:23` ("Who may hold migrator
   DSN | CI + break-glass owners only" — CI holds none since #1365), and `docs/ops/secrets.md:183`
   (§3.2 above). `.claude/rules/migrations.md` is **already wrong today** — it names
   `db/migrations`, `reusable-deploy-component.yml` and a `NEON_DATABASE_URL`-gated CI apply, none
   of which exist — and its `paths: db/**` frontmatter does not even match `migrations/neon/**`.
   The Prisma 8 spec records it as superseded (`.claude/rules/migrations.md` whole-file), so it
   should be rewritten with that change rather than patched here.
6. **Rejected alternative, for the record.** Adopting option B would require, in order: a
   boot-time migrator role and DSN (roles/grants); an Atlas binary checksum-verified into the agent
   image; a fail-closed lifespan hook gated on a literal env flag; a second, non-transactional
   readiness story for the three-replica rollout; a documented answer for catalog/users tables when
   the container does not boot; and a rollback for `migrator-role-isolation.test.ts` and
   `migration-boundary.test.ts`. Each step is a cost paid to move the apply host, with no change to
   the chain, the ledger, the ordering or the CI secret inventory (Q3.2).

### 6.2 Risks of the recommendation

| Risk | Why it is tolerable | What watches it |
|---|---|---|
| The executor is a single point of failure for schema delivery | It fails benignly: CI red, services untouched, old schema still serving (`docs/specs/2026-08-16-migration-executor-spec.md:107`) | `.github/workflows/cd.yml:140-143`; the failure-alert job (`.github/workflows/cd.yml:354-358`) |
| A stale migrator bundle could apply a chain the release did not package | `409 stale_bundle` + head-bounded apply + `bundleHead` polling (`workers/migrator/AGENTS.md:59-74`) | `workers/migrator/test/migrate.worker.handshake.test.ts`, `workers/migrator/test/migrate.worker.bound.test.ts` |
| "The chain applied" is mistaken for "the schema is right" | Already materialised once; `verify-catalog-schema.sh` exists for it (`workers/migrator/AGENTS.md:92-96`) | `.github/workflows/cd.yml:147-149` |
| Forward-only means a bad migration is a forward fix | Unchanged by either option; PITR/HITL path is `docs/ops/neon-backup-rpo.md` | — |
| The role matrix's migrator role is `neon_superuser`-grade | Disclosed, and minimization is behavioral: single-purpose, non-resident, rotatable (`docs/specs/2026-08-16-migration-executor-spec.md:97`) | `workers/edge/test/migrator-role-isolation.test.ts` |
| Docs drift around the reset (`docs/ops/secrets.md:183`) | Stale doc, correct workflow | `.github/test/cd-credentials.test.rb`, `.github/test/cd-stage.test.rb` |

### 6.3 Rollback story

Unchanged from today, and it is the reason option B is not obviously *safer*: a Worker rollback never
rolls back a database migration (`docs/ops/migrations.md:118-136`), so expand/contract is the rule
either way. If the executor itself regresses, the release is redeployed with the previous migrator
bundle; the chain is append-only and the ledger records what was applied. The one irreversible verb
is the destructive reset, which stays operator-only (§Q5).

### 6.4 Tripwires that would reopen this decision

Reopen only if one of these becomes true, and record which one:

1. Cloudflare Containers gain a **health-gated** rollout and automatic rollback, so that
   `deploy success ⇒ migration success` for every replica.
2. A **platform-native** migration primitive with workload identity arrives (a Neon-side
   equivalent of an OIDC-scoped DDL credential), which would make the *privilege* argument moot
   rather than merely expensive.
3. The executor is retired for an unrelated reason and the chain would otherwise have no owner.
   (Deleting `apps/agent` is *not* that: the executor is `workers/migrator`, and it does not depend
   on the container.)

## Verdict

| Card question | Answer |
|---|---|
| Q1 Atlas recommendation | Pipeline, discrete step, before the app — https://atlasgo.io/guides/deploying/intro. App-boot is explicitly discouraged. |
| Q2 Feasibility here | Only `apps/agent` has a boot, and it is being deleted (#1607). Catalog/users Workers have none; under app-boot their tables would be migrated by an unrelated process's startup. |
| Q3 Privilege | App-boot needs a `neon_superuser`-grade credential in the serving container, reversing two machine-checked invariants. The executor keeps it non-resident. CI already holds no DB credential. |
| Q4 test-base | Unchanged — scripted/in-process against disposable Postgres. App-boot has nothing to hook. |
| Q5 Destructive reset | Operator script, target-asserted and backup-first (`infra/database-access/reset-staging-baseline.sh`). Never in the app, never in the routine CI path. |
| Q6 Migration path | §6.1: no image change, keep the deploy order, keep the OIDC handshake, no new role, one docs pass. |

**Recommendation: reject app-boot; keep the OIDC-triggered migrator Worker as the single apply
point.** The owner's premise — that CI must not hold database credentials — is already satisfied and
is satisfied more completely by the shipped executor than by the position that prompted the card.
