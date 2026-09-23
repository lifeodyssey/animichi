# Deployment

This is the canonical deployment runbook for the current runtime.
The old root `DEPLOYMENT.md` compatibility pointer was removed in iter6 A6 (#640); this file is the only deployment runbook.

This file covers non-secret runtime config. For what each GitHub secret is, who consumes it,
and rotation impact, see [`secrets.md`](./secrets.md).

## Delivery architecture

There are three workflow responsibilities:

- `pr-verification.yml` verifies pull requests and merge groups, and — on a `push` to `main` — the
  merged commit itself (#1715). A normal squash merge already produces the tree its pull-request run
  gated, because the ruleset requires the branch to contain the current `main` tip first; this lane
  covers what can still diverge — an owner-bypass merge, a direct push, a verdict that changes with
  time, a run cut short — so a squash result that goes red opens a failure alert (a run the
  concurrency group supersedes while pending is cancelled without one). **A red `main` is still
  deployed:** `release-build.yml` fires on the same push, builds that commit and dispatches `cd.yml`,
  which stages it and waits for the production approval — nothing in CD reads the CI run. Check the
  failure alert, or the CI run for that SHA, before approving production. A red main is fixed by a
  reviewed revert on `main` (see [After any recovery](#after-any-recovery)); nothing reverts it for you.
- `release-build.yml` builds a complete immutable snapshot on every main push and, once the upload
  has succeeded, dispatches `cd.yml` on `main` with that snapshot's own artifact ID.
- The main-only `cd.yml` controller deploys the selected existing artifact ID to staging, then
  promotes that same release after the actual production job's environment approval. A manual
  dispatch still selects any other eligible artifact, such as an older release or a re-deploy.

There is no tag-triggered or local deploy path. The protected branch still requires `PR Verification`
and `Security`, resolved review threads and the repository's review discipline.

### Native Agent release acceptance

The owner-approved 2026-09-10 delivery amendment separates complete code Stories from observations
that require a deployed native host. Storage #1541 and the atomic service cutover #1582 may merge
once their complete code/PR gates pass. [#1583](https://github.com/lifeodyssey/animichi/issues/1583)
preserves the original deployed duration, real-tool, recovery, APAC, resource/cost and applicable
native evaluation evidence. Missing evidence must block native production promotion; code merge
alone is not acceptance. Use main CD staging, the existing production approval and the same tested
artifact. The production dependency on this evidence is still an implementation requirement of
#1583, not a claim that today's workflow already enforces it. Revalidate affected evidence when the
artifact changes. [The canonical target](../specs/2026-09-09-agent-on-pi-harness-spec.md) owns the ACs.

### Affected-only PR CI

The affected set is pnpm's, not ours. `plan` runs
`pnpm ls -r --depth -1 --json --filter "...[<merge-base>]"`, which selects every workspace project
whose files changed plus every dependent of one, and subtracts the two projects that own a job of
their own or have nothing to run: the root project (no lint/typecheck/test scripts) and
`animichi-e2e` (its `test` is the browser suite). Every selected package
becomes one `affected` matrix leg running that package's own `lint`, `typecheck`, `test` and
`test:integration`. There is no component manifest and no second router: a package's lane is its
own `package.json`, which is also what `pre-push` runs.

Three paths sit outside the package graph and are routed by `dorny/paths-filter` instead:
`apps/web/**` and `e2e/**` (the browser job), `packages/pi-session-neon/migrations/**` (the schema job), and the root dependency files, whose change
means "every package" because pnpm answers a root-lockfile change with the root project alone.
The six security jobs are never path-gated. `PR Verification` and `Security` each aggregate their
dependencies with `always()` and fail on any failed or cancelled one.

### Build once, select an immutable artifact

Each successful main push selects its own snapshot: the builder dispatches `CD` on `main` with the
artifact ID it just uploaded, so staging needs no manual action while production keeps its approval.
Manual dispatch remains for a different release.

A → B → C on main deploys each push's own snapshot; selecting B's artifact ID instead deploys B's
full snapshot, including A's catalog/schema/foundation prerequisites, and does not require C. The
trusted controller checks out its dispatch SHA. B's release SHA must be in that main history,
but it need not equal the controller SHA or the latest remote main commit.

GitHub's official artifact API and pinned `actions/download-artifact` validate the explicit ID,
repository, producer run and attempt, successful main-push builder workflow, expiry and digest.
Consumers re-resolve these properties before credentials, including after production approval.
The action downloads by ID/run/repository and treats a digest mismatch as an error. An unavailable
artifact causes refusal; the controller never rebuilds it or substitutes another release.

The immutable tar contains all five Worker deployments: web output/assets, catalog, users, edge
and migrator bundles/configurations; the complete native Atlas
chain and baseline marker; the native Prisma contract and complete migration graph; and all tracked
Pulumi sources with the generated pinned Neon SDK.
The controller validates the archive boundary, required components, file digests and exact migration
and infrastructure source closure. Wrangler's pinned native parser seals and verifies configurations.
Artifact files cannot replace controller scripts or actions, and publication runs with `--no-bundle`.

The Turnstile site key is public configuration, not a sealed value. The staging `database-access`
stack adopts the account's one widget (`animichi.com (Spin)`, #1676) through its
`<account_id>/<sitekey>` import identity, so that widget's site key is committed as a `RUNTIME_CONFIG`
field in `apps/web/wrangler.jsonc` and every artifact byte stays exactly as built. The committed value
cannot drift unless the widget itself is replaced, and the CI lanes keep their own always-passing
Turnstile test keys (`e2e/playwright.config.ts`, `apps/web/tests/native-server.ts`).

One `stage` job holds `cd-staging` from preflight through foundation, migration, Worker publication,
smoke and receipt. One `promote-production` job holds `cd-production` and owns `environment:
production`. Its approval does not hold staging's lock. Both set `cancel-in-progress: false`; GitHub
retains its native single pending selection, so a pending selection may be replaced — including by
the next push's own snapshot. Active chains finish coherently. There is no workflow-wide lock,
commit-order queue or `queue: max` exception.

Before any Pulumi apply or Worker publication, both jobs verify every image a selected snapshot
names against the real remote manifest and linux/amd64 configuration with Docker, then read actual
migration compatibility from the existing migrator's authenticated `/preflight`. Production refuses a staging-only baseline
before any mutation. After the Atlas check, CD retires the legacy migrator container application when
the selected snapshot carries the class-deletion contract, publishes only the selected migrator, waits for its
Atlas and Prisma bundle identities, and runs native Prisma read-only preview. Application foundation,
DDL and service publication remain gated behind that preview. Missing, empty, partially applied,
divergent or newer database history fails closed. A Wrangler dry run or `/healthz` response does not
prove the applied database state or registry availability.

The immutable staging receipt records artifact ID/digest, release/controller SHAs, actual per-script
Worker deployment/version IDs, the container application/namespace/image identity of every unit the
snapshot still names an image for, applied schema and
successful smoke. A new snapshot names none (#1606), so its Worker observations carry no container
identity, and the convergence rule below applies only to a snapshot that does. Container identity is
read only after the application's configuration converges: an image change creates an asynchronous
rollout, so the receipt reads `configuration.image` at most
`CONTAINER_ATTEMPTS` times (12 in `cd.yml`), waiting `CONTAINER_RETRY_DELAY` seconds between reads —
the first read is immediate, so the wait budget is 11 x 15 s = 165 s, not 12 x 15 s — and caps every
read at `CONTAINER_READ_TIMEOUT` seconds (30), so one hung `wrangler containers info` is a failed
attempt the next read retries instead of a stall to the job timeout. A receipt that does not converge
fails naming the expected digest, the last observed digest, the attempt count, the wait budget and the
last read failure (#1683). It proves B was tested.
Later C staging can proceed while B waits for approval; production must still pass fresh
baseline/ledger/registry checks before promoting B. Version IDs are script-scoped and are not expected
to match between staging and production.

The same artifact carries `evidence.json`, the probe transcript the deploy lane recorded beside the
receipt ([post-deploy acceptance evidence](post-deploy-evidence.md)): a platform read-back taken at
probe time plus the HTTP answers a verification seat cannot ask for itself, since every staging origin
is behind Cloudflare Access (#1695). One artifact and one digest bind the two documents to each other,
not to a run: `verify-evidence.mjs --fetch` also holds the artifact's `staging-receipt-<run>-<attempt>`
name to the run it fetched and to the run and attempt both documents record, and refuses to report a
criterion satisfied while either binding fails.

Native Minitest tests under `.github/test/` cover admission, source closure, archives, configurations,
remote identity validation, receipt validation and workflow order. The real Wrangler bundling test
also executes in CI's unconditional contracts job. The
[assertion map](../iterations/production-readiness-2026-08/SELECTED-ARTIFACT-ASSERTION-MAP.md)
traces every replaced CD contract. See [ADR 0007](../adr/0007-selected-release-artifacts.md) for the
activation prerequisites: deployed ledger preflight, same-lock revalidation, exact builder identity,
registry access, runtime secrets, baseline cutover and production routing must be established
before this controller can deliver successfully. Local tests do not prove those platform gates.

### Container application retirement (#1589 migrator, #1605 edge)

Two Workers used to own a container, and each one's retirement is a CD step rather than a
configuration edit. The migrator applies both live migration owners in Worker code; it no longer
builds or carries a container image. Each root, staging and production Wrangler migration chain
preserves the historical `MigrationContainer` creation tag and appends the unique
`v3-retire-migration-container` `deleted_classes` tag. `MigratorApplyLock` remains bound in every
ring because it serializes and revalidates the live apply. The edge carries no container either
(#1605): every ring preserves the `v1` tag that created `RuntimeContainer` and appends a `v6`
`deleted_classes` tag in the shape `v5` used for `RunSweeper`, while `EdgeGuard` and `AgentSession`
stay bound.

The environment-scoped CD job performs retirement in this order:

1. Call the already-serving migrator's authenticated Atlas-only preflight.
2. Retire the migrator application, then the edge application
   (`scripts/delivery/retire-migrator-container.sh`, `scripts/delivery/retire-edge-container.sh`,
   both on the shared `scripts/delivery/container-application-retirement.sh`). If the selected
   environment config for that unit has no container and includes its class-deletion tag, the
   helper lists every application page and deletes only the pinned old environment application by
   ID: `migrator-{staging,production}-migrationcontainer-{staging,production}` and, as wrangler
   resolves an environment ring's name from its script name, `animichi-staging-runtimecontainer-staging`
   and `animichi-runtimecontainer-production`. Absence is an idempotent success only after the
   cursor is exhausted; API, malformed-page, repeated-cursor, page-limit or duplicate exact-name
   failures fail closed.
3. Deploy the selected migrator bundle and its `deleted_classes` migration, then wait for the native
   graph and continue the normal database and service chain.
4. Publish the selected services — the edge bundle among them — so the edge's class deletion is
   deployed only after its application is gone.

This order is deliberate. Cloudflare's
[legacy Durable Object migration guide](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/)
requires removing the binding and code and deploying a unique `deleted_classes` migration; an
environment migration array overrides the root array. The
[container deploy guide](https://developers.cloudflare.com/containers/guides/deploy/) says the
Worker becomes active before container configuration is processed and the deployment is not
transactional. The
[Wrangler container commands](https://developers.cloudflare.com/workers/wrangler/commands/containers/)
define `containers delete` as application deletion, while image deletion is a separate command.
Wrangler's `deployContainers` path — 4.114.0 when this was measured; re-check it against the
current pin, which #1703 raised to 4.132.0 — only creates or updates applications that remain
in configuration, so omission does not establish application deletion; `deleteCommand` invokes
`ApplicationsService.deleteApplication` explicitly. Its generated application-list client uses
`GET /containers/dash/applications`, sends `page_token`, and returns
`result_info.next_page_token`; the JSON CLI path consumes only one such page. The CD helper uses the
same pinned API contract with the existing account and bearer-token authority, following each
non-empty cursor to a bounded exhaustion before it can prove absence. CD therefore deletes each old
application while its class still exists, before it deploys the binding/code removal and class
deletion. It does not delete registry images or touch any other container application.

A snapshot that still declares a container skips this retirement, but no such snapshot is
selectable: #1606 removed the agent image — the edge container's image — from the release model,
and no build has named the migrator image since that container was retired (#1589), so snapshot
verification refuses any image a manifest names. What clears such an application is the
first snapshot built after #1605: its edge config declares no container and carries the deletion
tag, so the retirement runs and deletes the application the old snapshot left behind. A new snapshot
names no container image at all and requires an empty container observation for every observed
Worker. The post-merge staging receipt is the first platform proof of the final state; unit and
dry-run tests are not substitutes for it.

## Edge Topology

```text
Browser
  ├─ static paths ───────────────────────────────▶ Cloudflare ASSETS
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy/cache
  ├─ /healthz ───────────────────────────────────▶ Worker readiness answer (`{"status":"ok"}`)
  ├─ /catalog/* ─────────────────────────────────▶ Worker → CATALOG service binding → catalog Worker
  │                                                          └─ Neon Postgres/PostGIS via a per-request Prisma runtime (`DATABASE_URL`)
  └─ /v1/* ── auth at Worker edge ───────────────▶ Worker gateway → native `AgentSession` DO
                                                            ├─ Neon Postgres (`AGENT_SVC_DATABASE_URL`)
                                                            ├─ catalog read path (`CATALOG` service binding)
                                                            └─ MiMo primary (`MIMO_API_KEY`)
```

The hybrid topology runs the edge Worker plus the catalog and users Workers. The main `seichijunrei` Worker
(`workers/edge/src/entry.ts`) routes `/catalog/*` to the separate `catalog` Worker
(`workers/catalog/wrangler.toml`) via a wrangler service binding (`env.CATALOG.fetch`), and the
native agent tier reaches the catalog through that same binding
(`workers/edge/src/agent/host/native-bootstrap.ts`). Deploy order: catalog Worker first (so
`service = "catalog"` resolves), then the main Worker.

Catalog and users Workers query Neon as Prisma 8 builder plans over the contract the migration
chain generates, on a runtime acquired per request and released on scope exit. That one chain in
`packages/pi-session-neon/migrations/` is the only Neon schema authority for all three. See
[`migrations.md`](./migrations.md) before changing a table or deploy step.

The deployment target stays intentionally thin. The Worker owns routing and edge auth, and hosts
the agent tier; callers' raw credentials never leave the gateway.

## Trust Boundaries

| Layer | Responsibility | Secrets/config it should see |
|---|---|---|
| Web app (`apps/web`) | SSR browser surface, deployed as its own Worker on its own route | none of this Worker's secrets |
| Worker edge | Route match, JWT auth, identity injection, native agent turns | `NEON_AUTH_JWKS_URL`, `AGENT_SVC_DATABASE_URL`, `MIMO_API_KEY` |

Current hardening rule: the Worker strips the raw `Authorization` header before routing and the
native agent tier sees only trusted `X-User-Id` / `X-User-Type` identity. `/v1/users/*` is
forwarded to the `USERS` service binding with that same identity.

## Auth Flow

Worker auth is implemented in `workers/edge/src/identity/auth.ts`:

- JWT flow: `authenticate()` verifies the token signature locally against the branch's Neon Auth JWKS (jose `createRemoteJWKSet`, cached per isolate) — no per-request round-trip to the auth origin. AUTH-2 #950 hard cut: `NEON_AUTH_JWKS_URL` is the edge's ONLY identity source; issuer/audience are derived from it (EdDSA), and the injected `X-User-Id` is the token `sub`.
- Production JWKS is unset — the production edge Worker fails closed on any bearer until its Neon Auth branch is provisioned.
- `sk_*` API keys are gone (AUTH-1 #945): an `sk_*` Bearer token is rejected as invalid — there is no `api_keys` lookup and no "agent" identity class.
- Forwarding flow: the Worker injects `X-User-Id` and `X-User-Type`, deletes `Authorization`, and hands the request to the native agent tier; `/v1/users/*` goes to the `USERS` service binding with the same identity headers (users trusts only the edge-forwarded identity).

Auth expectations:

- `/v1/*` always requires `Authorization: Bearer ...`
- `/healthz` and static assets bypass auth
- the agent tier trusts only the Worker-injected identity headers; it is not the auth enforcement point

## Environment by Boundary

### Worker edge

Required at deploy time:

- `NEON_AUTH_JWKS_URL` (staging; production unset — fails closed until its Neon Auth branch is provisioned)
- `AGENT_SVC_DATABASE_URL` — the `agent_svc` role Neon DSN, bound from the Cloudflare Secrets
  Store (`[[env.<env>.secrets_store_secrets]]` in `workers/edge/wrangler.toml`) and resolved by
  the native agent host directly. The `SUPABASE_DB_URL` name has no consumer; see
  `docs/ops/prod-dsn-cutover.md`.
- `MIMO_API_KEY` for the primary `mimo-v2.5` model — the runtime is MiMo-only (owner decision
  2026-09-15): no DeepSeek secret is required, provisioned, bound, or forwarded

The edge JWT path verifies against the branch's public JWKS — no Supabase/anon key is involved
(AUTH-2 #950).

### Agent tier

The native `AgentSession` Durable Object runs inside the edge Worker; these are the keys it reads
besides the bindings above:

- `APP_ENV` — the deployed environment's own name, from `wrangler.toml`'s per-environment `[vars]`
  block (`development` / `staging` / `production`), NOT a GitHub secret.

- `EDGE_SHOWCASE_MODE` — edge-only `[vars]`, the worker-side half of "prod is a landing-only
  showcase" (GOAL C): `"true"` (production) makes every functional route (`/v1/*`, `/v1/users/*`,
  the public catalog read) answer 403 `showcase_denied` before any binding is touched, while
  `/healthz`, `/img/*`, `/tiles/*` stay reachable. Strict boolean like `VITE_SHOWCASE_MODE`: only
  the literal `"false"` opens the backend — unset/empty/malformed values fail closed (deny) with a
  one-per-isolate warning. Pinned by `workers/edge/test/showcase.test.ts`. CD's `smoke` job is
  automatic but does not probe this: it asks staging for `/healthz` and the SSR shell, both of which
  stay reachable in showcase mode by design. Production's 403 is the owner's own check after a
  promotion.
- `ANON_RATE_LIMIT` / `ANON_RATE_LIMIT_WINDOW_SECONDS`, `AUTH_RATE_LIMIT` /
  `AUTH_RATE_LIMIT_WINDOW_SECONDS` — the burst windows; the layered rollback procedure is
  `docs/ops/rate-limit-rollback.md`
- `ANON_DAILY_COST_BUDGET_USD` (optional — the global anonymous daily-dollar circuit breaker,
  X4/#274; `0` disables it)
- `ANON_DAILY_MESSAGE_QUOTA` (optional — the per-identity anonymous daily message quota,
  S1.10/#282, a fairness/UX mechanism rather than a defense line; `0` or unset disables it, same
  convention as the budget ceiling above)

**There is a second, unrelated `APP_ENV`** — `apps/web/wrangler.jsonc`'s per-env `vars`, read by
`apps/web/src/server/noindex-plugin.ts`. Same name, same meaning, **opposite behaviour when
absent**: the web app's is fail-**open-to-noindex** (assume non-production and send
`X-Robots-Tag`). Do not "unify" the two without deciding which cost you are choosing. Guarded by
`apps/web/tests/unit/wrangler-app-env.test.ts`, which also pins the top-level block: its `name` is
the production Worker, so a `wrangler deploy` without `--env` would otherwise publish to production
with no `APP_ENV` and silently deindex the site.

The remaining Python-era declarations in `wrangler.toml` — `CORS_ALLOWED_ORIGIN`,
`DEFAULT_AGENT_MODEL`, `FALLBACK_AGENT_MODEL`, `LOGFIRE_TOKEN`, `GOOGLE_MAPS_API_KEY`,
`ZEN_GO_API_KEY`, `OPENAI_COMPAT_*` — have no deployed consumer. The Python tree they served is
gone (#1607); retiring each declaration, with the preflight and infra checks that name it, is
separate work. Do not treat them as live configuration.

## Cloudflare Workers Path

Production runs on Cloudflare Workers. `wrangler deploy` publishes each Worker's bundle from the
sealed release snapshot; no image build or container registry handoff is part of the current
runtime.

Requirements:

- Wrangler 4+
- GitHub Actions uses `cloudflare/wrangler-action@v4` with `wranglerVersion: "4.79.0"`

Routing defined by `wrangler.toml`:

- `/healthz` is answered by the edge Worker itself (`{"status":"ok"}`) without reading a binding
- `/v1/*` runs through the Worker gateway, which authenticates and then drives the native
  `AgentSession` Durable Object in the same Worker
- `/v1/users/*` goes to the `USERS` service binding, trusting only the edge-forwarded identity headers (it no longer verifies its own JWT — AUTH-2 #950)
- `/catalog/public/*` is the one anonymous catalog surface: the edge zone route sends it to the
  edge Worker, which forwards only the two allowlisted reads — `anime-overview/:id` and `popular`
  (declared once in `packages/contract/src/public-catalog.ts`) — to the private `CATALOG` binding
- `/img/*` runs through the Worker image proxy/cache
- everything else answers a JSON `404 not_found`

<!-- historical: retired in #537 -->
Issue #537 removed the bundled legacy static frontend and with it the `[assets]` binding: this
Worker has **no** HTML surface. `apps/web` (TanStack Start) deploys as its own Worker and owns
every page. Route ownership for the apex is declared in Pulumi (`infra/index.ts`, #541): until
`webRoutesEnabled` is on, the edge Worker may have no public hostname at all
(`workers_dev = false`). `apps/web` owns HTML on its Worker hostname; the edge Worker is API +
proxy only (`/v1/*`, `/healthz`, `/img/*`, `/tiles/*`, one public catalog read).

## Deploy Sequence

There is one workflow-backed deploy path: an artifact ID dispatch to `CD` on main — automatic for
each successful main push's own snapshot, manual for any other selected artifact. The builder never
deploys and tags never trigger deployment.

### Schema change policy

Neon migrations run from the Prisma chain before the Worker rollout, but the previously published
Worker version can still serve traffic while that step is running. A destructive change can therefore briefly break
old code that still reads or writes the removed schema; the `route_anime` release, for example,
dropped `routes.bangumi_id` in the same release that changed the writer. For schema changes where
that overlap matters, use expand/contract: add the replacement first, deploy compatible readers
and writers, then remove the old column in a later release. Today’s infrequent, approval-gated
cadence keeps this window low-risk, but it does not make destructive same-release changes safe by
construction. The full authoring/apply boundary is [`migrations.md`](./migrations.md).

### Migration promotion

The selected artifact carries Prisma's unchanged `contract.json` and complete native migration
directory beside the migrator bundle. The controller checks every source byte against the
selected release commit; newer graph files cannot enter an older selected artifact.

CD publishes the selected migration executor first. An older executor cannot preview a migration
graph it does not carry, so there is nothing worth asking it beforehand: `/healthz` must report the
selected contract's own `prismaTarget`, and a request naming any other identity is refused before
any database contact. Then CD calls `/preflight` with `expectedPrismaRef` read from the selected
contract's `storageHash`. Public Prisma `executeMigrateShowPlan` reads the actual marker and graph
without applying DDL. Its configured `contractHash` is not proof of the selected or installed
target; the receipt uses the requested target, native path and live marker. Application foundation
changes and service publication occur only after this preview succeeds.

`scripts/delivery/migrate-through-worker.sh <environment>` sends the same Prisma ref to `/migrate`
using the existing `animichi:github-actions:migrator` OIDC audience. Under the fixed apply Durable
Object lock, the endpoint revalidates that identity before any DDL — a prior preview is no
authority — and then hands the selected snapshot to Prisma's public control client, which owns the
transactions, the advisory lock and the marker. One authority owns the whole data plane (#1634),
so there is no cross-owner transaction to leave half-committed.

The final read-only observation must show the exact selected Prisma target and installed marker,
with no pending migrations. Staging receipt verification compares that marker with the contract in
the same selected artifact. SQL and secret failures return stable codes, never internal exception
messages.

CD's staging job rebuilds staging once, for the Prisma flip (#1625). Before the migrator's preview,
`infra/database-access/reset-staging-baseline.sh` reads the staging branch and acts only when there
is no `prisma_contract.marker` `app` row and `public` still holds tables the retired Atlas chain
left. It prints every `public` table with its row count, refuses by name if a table other than an
extension's or the Atlas ledger holds a row and is not named in
`infra/database-access/reset-staging-baseline.approved-rows` (the owner's dated approval, #1781),
takes the `staging-before-prisma-baseline` branch, and drops and recreates `public` in one
transaction. An `app` marker beside the Atlas ledger is neither state: the script refuses it, naming
each marker row's `space` and exact `updated_at` and what the chain left. Nobody drops that marker
by hand. The owner's dated decision that it is stale is a committed record,
`infra/database-access/reset-staging-baseline.approved-marker`, naming every row exactly as the
refusal prints it. It approves the whole `prisma_contract` schema, not one row: with it the rebuild
takes the backup branch and then drops that schema's three tables (`marker`, `ledger`, `contract`)
by name and the schema itself, without `CASCADE`, in the same transaction as `public`; any other
object in or depending on the schema rolls the whole transaction back, and a reused backup older
than the schema's last write refuses. Every
later run is a named no-op. The migrator
refuses a database still carrying the Atlas ledger as `atlas_leftovers_present` on `/preflight` and
`/migrate`, before any DDL, so a rebuild that did not happen fails by name rather than with 42710
inside the apply; the preflight step's log then points back at the rebuild step's own account. Production has no such step: a missing, empty or native-baseline production
database still requires an explicit bootstrap or recovery decision. **Production promotion is protected only by the `production`
GitHub environment's approval** — the artifact-level baseline gate was deleted rather than
rehoused, and [#1621](https://github.com/lifeodyssey/animichi/issues/1621) records the residual
risk and the conditions under which an artifact-level check comes back. The migrator binding,
role and existing topology must be bootstrapped before selected
executor publication; selected-artifact deployment does not provision its own access prerequisites.
Staging and production retain separate DSN bindings and exact main-controller OIDC
policies. CI receives no database credential and does not run direct database migrations; the
staging rebuild above is the one step that reaches the database without the migrator, and it
applies no migration.

Expand/contract remains necessary: schema is applied before its consumers, and a Worker rollback
does not reverse migrations. Follow [migrations.md](migrations.md) and
[neon-backup-rpo.md](neon-backup-rpo.md) for provisioning or recovery.

### Read-only migration preflight (#1575)

The migrator exposes authenticated `POST /preflight` for the selected-artifact
controller. It sends exactly `{expectedPrismaRef}` from its
verified artifact, with a main-ref GitHub OIDC token for the existing
environment-selected migrator policy. The key set is compared by exact match, so an
added field is an invalid request rather than an ignored one. Public Prisma
`executeMigrateShowPlan` reads the live marker and the forward path without
initializing a schema, and the endpoint returns `200 {compatible:true, prisma:
{targetHash, markerHash, migrations, usedLiveMarker}}`. Unknown metadata or an
unusable database path fails closed.

An identity this bundle does not carry returns retryable `409 stale_prisma_bundle`
naming the `prismaTarget` it does carry; an unusable forward path returns a stable
`422` refusal. Missing identity is 401,
disallowed identity 403, malformed metadata 400 (oversized input 413), and
secret/driver unavailability 503. Responses are `Cache-Control: no-store` and contain
no database credentials or driver messages. `/healthz` still describes the bundle.

Bootstrap must use the previous authorized main-push CD path before activating selected-artifact CD. Record the deployed
version, artifact identity, environment, request metadata digest and sanitized
HTTP status/body for a signed read-only call plus unauthenticated and wrong-environment
refusals. A state refusal is evidence of the endpoint and that state, not permission
to reset or apply. Record production observations separately after its environment
approval. These platform observations remain pending until actually performed.
#1564 must not activate while either target returns 404/unavailable; it must repeat
the comparison inside the existing apply lock before mutation. Preflight alone does
not protect against a later apply racing this snapshot. #1575 delivered that read-only endpoint;
#1564 adds the bounded apply metadata and actual lock-held revalidation described above.
Local code and database tests do not replace the pending live bootstrap observations.


### Select and promote (`.github/workflows/cd.yml`)

1. Every successful `Release build` run on main dispatches `CD` for its own
   `release-snapshot-<sha>-<attempt>` artifact, so staging needs no manual action; the artifact ID
   and digest are still shown in that run's summary. Intermediate or old cohort artifacts are not
   eligible.
2. To deploy a different release instead — an older artifact, a re-deploy, a rollback — dispatch
   `CD` with `--ref main` and that `artifact_id`, for example
   `gh workflow run cd.yml --ref main -f artifact_id=<existing-id>`. The workflow verifies provenance
   and the complete snapshot before opening environment credentials.
3. Staging publishes the complete selected snapshot, smokes the edge and web workers.dev surfaces,
   and uploads an immutable receipt. Failure stops promotion.
4. Inspect that release's receipt before approving the actual `production` environment job, and first
   check for an open failure alert on the revision it names: `is:issue is:open in:title "Failure
   alert:"` lists them, and an alert on the receipt's `source_sha` means that revision's own CI
   failed — do not approve. After approval the job re-downloads the same ID/digest, verifies the
   receipt, and checks production's current baseline, registry and ledger before any mutation.
   Production observes its own script-scoped version/deployment IDs and smokes `https://animichi.com`
   after publication.

Rejecting production affects that run only. It does not block another staging selection. Rerunning
uses the same selected artifact; if its artifact or receipt expired, select an available eligible
release explicitly. A new main push deploys its own correction to staging and still needs its own
production approval.

### Activation evidence required for #1564

The repository candidate is not platform readiness. Before enabling the new builder/controller:

- Bootstrap #1575's read-only migrator endpoint through authorized CD on each target environment;
  observe a signed read-only response and wrong-environment refusal. Verify apply-lock revalidation.
- Provision a main-only GitHub `release-build` environment and its exact native Pulumi issuer claim
  for `lifeodyssey/animichi/.github/workflows/release-build.yml@refs/heads/main`. Keep deployment
  identities on the existing exact `cd.yml` path; never add a wildcard or reuse staging's subject.
- Provision the build registry configuration and credential; demonstrate real pushed manifest
  digests and read access from both deployment environments. #1565 owns provider-enforced principal
  separation and sibling-ESC denial; export filtering does not establish that boundary.
- Complete runtime-secret/foundation provisioning, approved production baseline cutover and
  production hostname/routing readiness. The current committed production topology leaves apex
  activation off, so the production smoke URL is an explicit readiness prerequisite.
- Run real harmless cross-run artifact/digest substitution probes, concurrent environment lock
  and approval probes, and record per-environment Worker/schema/smoke identities plus the expected
  empty container observation.

No local test or dry run substitutes for these observations, and none authorizes local deployment,
production approval, secret mutation or baseline reset.

### Pulumi state, encryption, and CI identity (#1077, #1078, #1367)

Both Pulumi projects — `seichijunrei-infra` (`infra/`) and `animichi-neon-secrets`
(`infra/database-access/`) — keep their state and their `secure:` encryption in **Pulumi Cloud**,
organization `lifeodyssey`. `backend.url` in each `Pulumi.yaml` is the source of truth for that.

CI obtains short-lived Pulumi credentials through native GitHub OIDC, then opens ESC configuration.
It does not read repository/environment GitHub secrets. The selected controller uses these mappings:

| Responsibility | GitHub environment | ESC environment | Pulumi stacks |
| --- | --- | --- | --- |
| Build | `release-build` | `lifeodyssey/animichi/release-build` | none |
| Staging chain | `staging` | `lifeodyssey/animichi/staging` | `lifeodyssey/staging` in both projects |
| Production chain | `production` | `lifeodyssey/animichi/prod` | `lifeodyssey/prod` in both projects |

`pulumi/auth-actions` retains the existing personal token type and `scope: user:lifeodyssey`.
That account model does not prove per-role authorization. #1565 requires provider-side boundaries
and actual sibling-environment denial; neither an ESC export list nor a shell wrapper supplies them.
The new build environment/issuer permission is a platform activation prerequisite, not an existing
staging credential reused under a different label.

Build exports `CLOUDFLARE_API_TOKEN` for registry publication. Deployment exports the Cloudflare
credential for native Wrangler and Pulumi. Staging additionally exports its Access service-token
pair for smoke. No job exports `NEON_API_KEY`: the staging rebuild step alone reads it, from the ESC
step's own output (`steps.esc.outputs.NEON_API_KEY`), and production never does. The Neon provider
reads its encrypted stack configuration. Runtime values belong in Secrets Store through Pulumi, subject to
#1370's required provisioning, and must not be copied into artifact or job outputs.

Each ESC opening is followed by a nonempty-value check because the action otherwise only warns.
Its Pulumi CLI version is explicitly pinned. `CLOUDFLARE_ACCOUNT_ID` is a repository variable, not
a secret. Registry login uses a private runner directory and short-lived native Wrangler credentials;
consumers request pull permission and validate real Docker manifest/configuration responses.

Applies stay organization-qualified and use the sealed foundation sources/dependencies.
`PULUMI_BACKEND_URL`, passphrase and R2 state keys are absent from the delivery lane. The old state
migration below is historical owner work and is not a step of selected-artifact deployment.

#### One-time migration (owner, once per stack)

Agents do not run this — it needs the passphrase and an interactive Pulumi Cloud login. Run it once
per stack, from the project directory, with the campaign paused (no `main` push mid-flight).

Stacks to move: `seichijunrei-infra/staging`, `seichijunrei-infra/prod`,
`animichi-neon-secrets/staging`, `animichi-neon-secrets/prod`.

```bash
cd infra                     # or: cd infra/database-access

# 1. Export from the retiring R2 backend, using the passphrase that still owns the ciphertext.
#    The explicit `pulumi login` matters: after you have done step 2 for an earlier stack, the
#    CLI's stored login points at Pulumi Cloud, and this is what re-points it at R2. It is also
#    exactly what the retired CD code did before every apply.
#    The two secret values are read with `read -r -s` instead of being typed into an `export`:
#    an inline assignment lands the value in the shell history file and, briefly, in the process
#    list. `-s` also keeps it off the terminal. Reading them from a mode-600 file works too.
export PULUMI_BACKEND_URL='<the retiring s3:// R2 backend URL>'
export AWS_ACCESS_KEY_ID='<R2 state key id>'
export AWS_DEFAULT_REGION=auto
read -r -s -p 'Pulumi config passphrase: ' PULUMI_CONFIG_PASSPHRASE && echo
read -r -s -p 'R2 state secret: ' AWS_SECRET_ACCESS_KEY && echo
export PULUMI_CONFIG_PASSPHRASE AWS_SECRET_ACCESS_KEY
pulumi login "$PULUMI_BACKEND_URL"
pulumi stack select <stack>
pulumi stack export --file "/tmp/$(basename "$PWD")-<stack>.json"   # no --show-secrets, ever

# 2. Log into Pulumi Cloud and create the destination stack under the org. PULUMI_BACKEND_URL
#    must be unset first: it takes precedence over both the stored login and Pulumi.yaml's
#    backend.url (measured on Pulumi 3.255.0, the version .pulumi.version pins).
unset PULUMI_BACKEND_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
pulumi login                                        # https://api.pulumi.com
pulumi stack init lifeodyssey/<stack>

# 3. Import the checkpoint, then re-encrypt the stack's `secure:` values under Pulumi Cloud's
#    provider. change-secrets-provider needs the OLD passphrase to read the existing ciphertext,
#    so keep PULUMI_CONFIG_PASSPHRASE exported until this command has succeeded.
pulumi stack import --file "/tmp/$(basename "$PWD")-<stack>.json" --stack lifeodyssey/<stack>
pulumi stack change-secrets-provider default --stack lifeodyssey/<stack>
unset PULUMI_CONFIG_PASSPHRASE

# 4. Verify: a clean preview against Pulumi Cloud with no passphrase in the environment.
pulumi preview --stack lifeodyssey/<stack>
```

Step 3 rewrites `Pulumi.<stack>.yaml` in the working tree — the `encryptionsalt` line disappears and
each `secure:` value is replaced by Pulumi Cloud ciphertext. Commit those four files as a normal
reviewed change. `infra/database-access/Pulumi.prod.yaml` has no encrypted material today, so its
`change-secrets-provider` is a no-op; run it anyway so all four stacks end on the same provider.

Until every stack is imported, the rollback path is the old one: re-point `PULUMI_BACKEND_URL` at
R2 and restore the export taken in step 1. After the cutover, rollback is Pulumi Cloud history.
Deleting the GitHub secrets themselves is the owner's step in #1367 (#1081), taken after one green
staging deploy and one green nightly on the ESC path — deleting `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY` is what closes this rollback window for good.

## Staging access (Cloudflare Access, D3 #1369)

Staging runs the same app as production **with anonymous access on**, so there is no login of
its own keeping strangers out. Cloudflare Access is that login: humans sign in against an
identity policy, automation presents a **service token**, and both are decided by Cloudflare
before a request reaches the Worker.

`infra/src/staging-access.ts` declares the token, the application and both policies on the
staging stack, and reads — never declares — the account's identity provider:

- one `ZeroTrustAccessApplication` (`type: "self_hosted"`, `sessionDuration: "24h"`,
  `appLauncherVisible: false`) whose `destinations` are the three hostnames staging answers on:
  `staging.animichi.com` and the `animichi-staging` / `animichi-web-staging` workers.dev
  origins. All three, because CD's smoke probe deliberately uses the workers.dev origins —
  GitHub-runner IPs get a managed challenge at the zone front door — and a staging surface CI
  can reach that Access cannot see is the hole (#539) this closes;
- a `non_identity` (**Service Auth**) policy including the service token, first in precedence.
  Service Auth is the only decision that answers a service token; under a plain `allow` the CD
  probe is redirected to an identity provider and reads the login page as a broken deploy;
- an `allow` policy with one include rule per address in the `stagingAccessAllowedEmails` stack
  config (`infra/Pulumi.staging.yaml`) — plain config, because it says who may sign in, not how.
  An empty list is refused at build time: it would be a door no human can open;
- the account's `onetimepin` identity provider, **read and named** on the application as its
  only `allowedIdps` entry — `infra/src/access-identity-provider.ts` looks it up with the
  `getZeroTrustAccessIdentityProviders` data source and refuses to build unless the account
  reports exactly one. **The human login path is therefore an emailed one-time PIN** to an
  address in the allowlist — no password, no third-party app registration. It is named rather
  than defaulted because `allowedIdps` left out means "all IdPs configured in your account",
  which would widen who is offered a login box the day the account grows a provider.
  **It is an ACCOUNT-level object that this stack references and does not own.** Cloudflare
  allows exactly one One-time PIN provider per account and this account already had one, made
  for another project's Access application: the earlier revision that declared it here was
  answered `POST /accounts/{id}/access/identity_providers 409 Conflict` in `stage-foundation`.
  What justified that declaration was a read answering `[]` on 2026-09-08 — the response
  Cloudflare gives (`200`, never `403`) to a token lacking *Access: Organizations, Identity
  Providers, and Groups Read*, indistinguishable from an account with no login methods. **If the
  apply now fails saying the account reports no `onetimepin` provider, check that permission on
  the Cloudflare API token before creating anything**; if it genuinely has none, create the
  One-time PIN login method once under Zero Trust → Settings → Authentication;
- the `animichi-staging-ci` `ZeroTrustAccessServiceToken` (duration `8760h`) and two stack
  outputs:

| Stack output | ESC key in `lifeodyssey/animichi/staging` | Request header |
|---|---|---|
| `stagingAccessClientId` | `CF_ACCESS_CLIENT_ID` (`environmentVariables`) | `CF-Access-Client-Id` |
| `stagingAccessClientSecret` | `CF_ACCESS_CLIENT_SECRET` (`environmentVariables`) | `CF-Access-Client-Secret` |

**That token expires after one year** and nothing alerts on it — the deadline, the two renewal
paths and who is (not) warned are in `secrets.md`, "It expires. Nothing tells you."

The ESC environment imports the two outputs through its `pulumi-stacks` provider, so no value is
copied by hand. Renaming either output empties the ESC key silently —
`infra/topology-staging-access.test.ts` pins both names for exactly that reason. Production has
none of this: it has a real login, and `infra/topology-prod.test.ts` pins that no application,
policy or token is built there.

Every automated caller sends the pair when both variables are set, and refuses when exactly one
is: the CD smoke probe (`.github/scripts/staging-smoke-check.sh`), the Playwright suite
(`e2e/playwright.config.ts`, `use.extraHTTPHeaders`), the staging lanes
(`workers/edge/api-test/lane-origin.ts`). The retired HTTP Eval launcher no longer uses this door;
the native Eval task runs in process. The names and the refusal live once, in
`packages/contract/src/access-service-token.ts`. Access answers a
request carrying one header exactly as it answers one carrying neither — a 302 to the login page
— so a half-declared token would surface as "the app is broken", which is why it fails closed by
name instead.

**Enforcement is eventually consistent.** An Access application starts refusing traffic a minute
or two after the apply, not at the apply. On the run that first creates it, the foundation apply
and `staging smoke` are minutes apart in the same job, so that smoke can pass without ever having
been checked — the evidence that the door is live is the NEXT push's smoke, plus a `curl` with no
headers answering 302 or 403.

**What this replaced.** A WAF custom rule blocking traffic without an allowlisted source IP, the
`animichi_staging` cookie or the `x-staging-key` header, plus a hand-written OIDC exchange in the
edge Worker. Both are deleted (#1369): `infra/src/staging.ts`'s ruleset,
`workers/edge/src/staging-gate/**`, `scripts/setup-staging-gate.sh`, `e2e/global-setup.ts`, the
`stagingGate*` / `stagingAllowedIps` stack config and the `STAGING_GATE_TOKEN` GitHub secret. A
WAF rule can only see hostnames on the zone, and its credential was a static string that had to
stay in sync across a stack config and a GitHub secret. `infra/src/staging.ts` keeps only
`staging-http-config-settings`, which turns the Browser Integrity Check and the security-level
challenge off for the staging hostname so CI is not challenged ahead of Access.

**Locally.** Read the values from ESC rather than a file:

```sh
esc env open lifeodyssey/animichi/staging environmentVariables.CF_ACCESS_CLIENT_ID --format string
esc env open lifeodyssey/animichi/staging environmentVariables.CF_ACCESS_CLIENT_SECRET --format string
```

`open` and not `get`: `get` prints the environment's *definition*, which for these two keys is
the `pulumi-stacks` import expression rather than the resolved value (and, for a static secret,
ciphertext unless `--show-secrets` is passed). So
`esc env get lifeodyssey/animichi/staging environmentVariables` is what to run when you only need
to see that the two keys are declared and where they come from — it shows the import expression,
never the token.

A browser needs no variables at all: open `https://staging.animichi.com/`, enter an address in
`stagingAccessAllowedEmails`, paste the one-time PIN Cloudflare emails to it, and the session
lasts 24 hours.

## WAF and Edge Hardening

Manual Cloudflare dashboard steps live in `docs/ops/cloudflare-hardening.md`.
That runbook covers:

- `/v1/*` rate limiting
- coarse prompt-injection WAF filters
- rollback steps for over-blocking rules
- the future AI Gateway insertion point

The edge's layered rate-limit rollback procedure (native vs durable tiers, and
the rate-policy decision table) is `docs/ops/rate-limit-rollback.md`; it belongs
next to any `/v1/*`-rate-limiting incident run.

## AI Gateway Insertion Path

If AI Gateway is enabled later, it belongs between the edge Worker's model calls and the upstream
model provider. It does not belong in the browser.

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional edge Worker var

Important: this is a documentation target only right now. Before enabling it, the native model
composition (`workers/edge/src/agent/host/native-models.ts`) must support a provider base-URL
override through configuration rather than assuming the provider default.

## Rollback

Rollback is incident recovery, not a second deployment path. There is no rollback workflow: the
hand-written one was deleted with #1364 because Cloudflare already keeps every published version.
Recovery is `wrangler rollback`, run by the owner from a laptop, against one Worker at a time. No
workflow and no agent runs it — `CD` only ever moves forward (spec §二).

### The five Workers, by environment

| unit | staging Worker | production Worker |
|---|---|---|
| catalog | `catalog-staging` | `catalog` |
| users | `users-staging` | `users` |
| migrator | `migrator-staging` | added by #1365 (`workers/migrator/wrangler.toml` has no `[env.production]` before it) |
| edge | `animichi-staging` | `animichi` |
| web (SSR) | `animichi-web-staging` | `animichi-web` |

The names are `[env.<stage>].name` in `workers/catalog/wrangler.toml`, `workers/users/wrangler.toml`,
`workers/migrator/wrangler.toml`, `workers/edge/wrangler.toml` and `apps/web/wrangler.jsonc`.
`wrangler rollback` addresses the deployed Worker by name, so always pass `--name` rather than
relying on a config file and `--env`.

### 1. Find the version

```sh
pnpm exec wrangler versions list --name <worker>
```

It prints the **10 most recent** versions with their `Version ID`, `Created`, and `Tag`. From #1364
on, every `CD` deploy tags the version it publishes `sha-<sha>`, so the tag is the commit the
version was built from: pick the last version whose tag is a commit you trust. Versions published
before that card carry `Tag: -` and are only identifiable by timestamp.

The rollback window is wider than the listing. Cloudflare: "You can only roll back to the 100 most
recently published versions", and "When using Wrangler in interactive mode, you can select from up
to 100 recent versions"
([rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)).
So for anything older than the 10 the CLI prints, run `wrangler rollback --name <worker>` with no
version id and pick from the interactive list, or read the ids off **Workers & Pages → your Worker →
Deployments** in the dashboard. The listing window slides with every deploy — measured on
`catalog-staging` on 2026-09-07, one new deploy moved the earliest listable version from
`2026-09-06T15:40:27Z` to `2026-09-06T18:54:36Z` — so "not in `versions list`" does not mean "cannot
roll back to".

### 2. Roll back

```sh
pnpm exec wrangler rollback <version-id> --name <worker> -y --message "<why>"
```

`--message` is the incident record; wrangler's prompt caps it at 120 characters ("Please provide an
optional message for this rollback (120 characters max)"). The Cloudflare docs say that specifying it
skips both the confirmation and the message prompt, and they do not list `-y` among `rollback`'s
options at all — wrangler 4.114.0 nonetheless accepts `-y, --yes` (`wrangler rollback --help`). What
the drill below actually captured, with `-y --message` on both runs: the message prompt still printed
once, on the roll-back run, and resolved itself ("Using default value in non-interactive context:
…"); the confirmation prompt still printed once, on the roll-forward run, and the command completed
without waiting. Pass both flags — between the two of them nothing in either run needed a terminal.
Omitting `<version-id>` rolls back to "the version uploaded before the latest version"
([wrangler](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback)), which is
the usual incident case, but naming the id is what makes the step reviewable afterwards.

### 3. Verify

```sh
pnpm exec wrangler deployments list --name <worker>
```

The newest entry is last: it carries your `--message` and `(100%) <version-id>`. A rollback creates a
new **deployment**, not a new version — `versions list` is byte-for-byte unchanged after one, so
never verify a rollback with `versions list` alone.

Then check health on a route that actually exists for that Worker:

- edge: `https://animichi-staging.zhenjiazhou0127.workers.dev/healthz` — the same URL `CD`'s
  `staging smoke` step probes.
- web: `https://animichi-web-staging.zhenjiazhou0127.workers.dev/` — the SSR shell, that step's
  second probe.
- migrator: `GET $MIGRATOR_STAGING_URL/healthz` (the workflow variable of that name). It answers
  `{status, service, env, prismaTarget}` from the native contract carried by
  `workers/migrator/src/create-app.ts`.
- catalog and users: **no public host** — both configs set `workers_dev = false` and are reached only
  through the edge's service bindings. Verify them with `deployments list` plus a request through the
  edge (`/catalog/public/anime-overview/:id` for catalog, an authenticated `/v1/users/*` call for
  users). A probe of `catalog-staging.<subdomain>.workers.dev/healthz` returns 404 no matter which
  version is deployed; that 404 is the absent host, not a failed rollback.

### 4. Roll forward

The same command with the newer version id. There is no separate "undo": rolling forward is a
rollback to a later version, and it appends another deployment with its own message.

### What a rollback does and does not restore

A version "captures the complete state of your Worker at a point in time: its bundled code, static
assets, bindings, and compatibility settings"
([versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)), so
the target version's binding declarations return with its code. What does not return is the state
behind them: "Resources connected to your Worker will not be changed during a rollback", and "State
changes for associated storage resources such as KV, R2, Durable Objects, and D1 are not tracked with
versions". Concretely, a rollback does not:

- reverse an applied Neon migration — schema promotion precedes consumers, which is why
  expand/contract is mandatory (see "Migration promotion" above);
- undo a Durable Object class lifecycle change. Cloudflare **refuses** the rollback outright when a
  DO class lifecycle change (via exports or the legacy `migrations` array) happened between the
  active version and the target, or when the target has a binding to an R2 bucket, KV namespace, or
  queue that no longer exists. Plan a code fix forward for those, not a rollback;
- restore Pulumi state (see the Pulumi paragraph below);
- rewind a secret. Values behind Secrets Store bindings are read live, and the version records only
  the binding. "`wrangler secret put` creates a new version of the Worker and deploys it immediately"
  ([secrets](https://developers.cloudflare.com/workers/configuration/secrets/)), so a rotation is
  itself a version; what a rollback across one does to the value is not documented and has not been
  exercised here.

Honest limit on the binding claim: it is Cloudflare's documentation, not our measurement. On
2026-09-07 the two most recent `catalog-staging` versions bound the same two Secrets Store entries
(`CATALOG_ADMIN_TOKEN`, `CATALOG_DATABASE_URL`) and the same two R2 buckets, and the last three
`animichi-web-staging` versions carried identical `APP_ENV` / `RUNTIME_CONFIG` vars — no deploy in
the window changed a binding, so a rollback *across* a binding change is still unexercised here
(spec §七 #15).

### Drill: 2026-09-07, `catalog-staging`

`catalog-staging` was serving `33fe9323-2261-466f-be22-2a66efa2ce57` (published 12:55:52Z by `CD`).

1. `wrangler rollback d4e2e9d7-2d2e-4dd7-9b26-90d0877dcfbf --name catalog-staging -y --message "C4
   drill: roll back one version"` → deployment at 14:36:35Z, `(100%) d4e2e9d7…`, message recorded.
2. `wrangler deployments list --name catalog-staging` → newest entry is that deployment;
   `versions list` still returned the same 10 versions.
3. Roll forward with the same command and `33fe9323-2261-466f-be22-2a66efa2ce57` → `SUCCESS Worker
   Version 33fe9323… has been deployed to 100% of traffic`, deployment at 14:37:02Z with message
   "C4 drill: roll forward".

Elapsed: 27 seconds from rollback to roll-forward. The drill also produced the 404 caveat above — the
health probe used, `catalog-staging.zhenjiazhou0127.workers.dev/healthz`, 404s in both states because
catalog has no public host, which is why this runbook names the edge and web URLs instead.

### After any recovery

Release artifacts are retained for 14 days. If the selected artifact has expired, land a reviewed
revert on `main` and let `release-build.yml` publish a new immutable artifact, which dispatches `CD`
for itself; promote that run through the production approval. Revert the bad change on `main` so the
next release restores trunk state — a rolled-back Worker is behind `main` until you do.

For Pulumi, inspect the failed update in Pulumi Cloud's stack history and roll back from there: read
the last-good version number out of `pulumi stack history`, then `pulumi stack export --version
<version> --file state.json` and `pulumi stack import --file state.json`. A bare `pulumi stack
export` writes the *latest* checkpoint, which after a failed update is the broken one, so the version
is not optional. Follow the import with a reviewed reconciliation — the pre-apply R2 export is
retired (#1077). Never place a state export in a public GitHub artifact.

`CD`'s own `Smoke the release` step does not run on a recovery, so the owner must manually check health and the
affected user journey after one.

## Known Limitations

- default session storage is in-memory unless a distributed backend is introduced later
- OpenTelemetry exporters are opt-in and disabled by default
- AI Gateway is documented but not yet wired in backend provider configuration
- Release identity is the selected native artifact ID and `artifact-digest`, bound to its repository,
  build run and source SHA; the artifact name is a label. Before deployment credentials, the current
  accepted-main controller verifies the official download digest, sealed manifest, file hashes and
  complete source closure. Staging and production consume that same ID/digest and record their own
  script-scoped runtime identities. Health metadata supports diagnosis; it does not replace these checks.

The pre-2026-07 feat/ssr-cloudflare post-deploy notes are history: [`docs/archive/ops/2026-05-ssr-cloudflare-post-deploy-notes.md`](../archive/ops/2026-05-ssr-cloudflare-post-deploy-notes.md).

## Neon topology

See [neon-env-topology.md](./neon-env-topology.md) (N3 / #859).
