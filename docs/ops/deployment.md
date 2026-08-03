# Deployment

This is the canonical deployment runbook for the current runtime.
The old root `DEPLOYMENT.md` compatibility pointer was removed in iter6 A6 (#640); this file is the only deployment runbook.

This file covers non-secret runtime config. For what each GitHub secret is, who consumes it,
and rotation impact, see [`secrets.md`](./secrets.md).

## Edge Topology

```text
Browser
  ├─ static paths ───────────────────────────────▶ Cloudflare ASSETS
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy/cache
  ├─ /healthz ───────────────────────────────────▶ Worker → RuntimeContainer → FastAPI service
  ├─ /catalog/* ─────────────────────────────────▶ Worker → CATALOG service binding → catalog Worker
  │                                                          └─ Neon Postgres/PostGIS via neon-http (`DATABASE_URL`)
  └─ /v1/* ── auth at Worker edge ───────────────▶ Worker → RuntimeContainer → FastAPI service
                                                            ├─ Supabase Postgres (`SUPABASE_DB_URL`)
                                                            ├─ Anitabi API (`ANITABI_API_URL`)
                                                            ├─ catalog read path (`CATALOG_API_URL` → /catalog/*)
                                                            └─ MiMo primary (`MIMO_API_KEY`)
                                                               └─ DeepSeek fallback temporarily disabled
                                                                  (`DEEPSEEK_API_KEY` remains provisioned)

Cloudflare Cron Triggers ─────────────────────────▶ maintenance Worker
                                                   └─ agent-domain Neon via `AGENT_DATABASE_URL`
```

The hybrid topology runs the edge Worker plus the catalog, users, and scheduled maintenance Workers. The main `seichijunrei` Worker
(`worker/entry.js`) routes `/catalog/*` to the separate `catalog` Worker
(`catalog/wrangler.toml`) via a wrangler service binding (`env.CATALOG.fetch`).
The Python agent in the container cannot use that JS-only binding, so it reaches
the catalog over the public origin: `CATALOG_API_URL` (forwarded into the
container as a plain var) points at the deployed host, and `CatalogClient` POSTs
to `{CATALOG_API_URL}/catalog/<method>`, which the main Worker forwards to the
catalog Worker. Deploy order: catalog Worker first (so `service = "catalog"`
resolves), then the main Worker.

Catalog, users, and maintenance Workers query Neon through the `neon-http` driver. Drizzle supplies
runtime query/type metadata for catalog/users only; the checked-in Atlas directory is the only Neon schema authority. See
[`migrations.md`](./migrations.md) before changing a table or deploy step.

- `interfaces/fastapi_service.py` exposes `GET /healthz`
- `interfaces/fastapi_service.py` exposes `POST /v1/runtime`
- `interfaces/fastapi_service.py` exposes `POST /v1/runtime/stream` (SSE)
- `interfaces/fastapi_service.py` exposes `POST /v1/feedback`
- `Dockerfile` packages the runtime into a single container image

The deployment target stays intentionally thin. The Worker owns routing and edge auth; the container runs the backend service and stays unaware of raw end-user credentials.

## Trust Boundaries

| Layer | Responsibility | Secrets/config it should see |
|---|---|---|
| Web app (`apps/web`) | SSR browser surface, deployed as its own Worker on its own route | none of this Worker's secrets |
| Worker edge | Route match, JWT/API-key auth, identity injection | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (+ optional `NEON_AUTH_*`) |
| Container runtime | Backend service, DB, model/provider calls | `SUPABASE_DB_URL`, `MIMO_API_KEY`, `DEEPSEEK_API_KEY`, `ANITABI_API_URL`, `CORS_ALLOWED_ORIGIN`, optional observability keys |
| Maintenance Worker | Scheduled agent-domain retention; no public route | `AGENT_DATABASE_URL` only |

Current hardening rule: the Worker strips the raw `Authorization` header before proxying and forwards only trusted `X-User-Id` / `X-User-Type` identity headers to the container.

## Auth Flow

Worker auth is implemented in `worker/auth.ts`:

- JWT flow: `authenticate()` verifies the token signature locally against the issuer JWKS (jose `createRemoteJWKSet`, cached per isolate) — no per-request `/auth/v1/user` round-trip. Supabase tokens verify as ES256/RS256 against `SUPABASE_URL/auth/v1/.well-known/jwks.json` (issuer `SUPABASE_URL/auth/v1`, audience `authenticated`, `exp` checked); the injected `X-User-Id` is the token `sub`.
- Dual-issuer readiness: a flag-gated Neon Auth (Better Auth, EdDSA) verification path exists but is OFF by default — active only when `NEON_AUTH_ENABLED=true` and both `NEON_AUTH_JWKS_URL` and `NEON_AUTH_ISSUER` are set. Tokens route by `alg`/`iss`, so Supabase and Neon issuers coexist without a cutover.
- API key flow: `authenticate()` hashes the presented `sk_*` token and looks it up through Supabase REST using `SUPABASE_SERVICE_ROLE_KEY` (unchanged)
- Forwarding flow: the Worker injects `X-User-Id` and `X-User-Type`, deletes `Authorization`, and proxies the request to `CONTAINER` (unchanged)

Auth expectations:

- `/v1/*` always requires `Authorization: Bearer ...`
- `/healthz` and static assets bypass auth
- the container trusts only the Worker-injected identity headers; it is not the auth enforcement point

## Local Service Run

Install dependencies and start the service:

```bash
uv sync --extra dev
make serve
```

Default bind settings:

- `SERVICE_HOST=0.0.0.0`
- `SERVICE_PORT=8080`

## Environment by Boundary

### Worker edge

Required at deploy time:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional: `NEON_AUTH_ENABLED`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER` (dual-issuer readiness; leave unset to keep the Neon path off)

These secrets stay in the Worker environment and are not forwarded into the container runtime. `SUPABASE_ANON_KEY` is no longer required at the edge — the JWT path verifies against the public Supabase JWKS and sends no `apikey` header.

### Maintenance Worker

`workers/maintenance` requires `AGENT_DATABASE_URL` as a Cloudflare secret binding. CI resolves the
same-named secret from the selected GitHub Environment, so staging and production receive distinct
agent-domain Neon DSNs. Schedules and cutover verification are in
[`maintenance-worker.md`](./maintenance-worker.md).

### Container runtime

Required:

- `SUPABASE_DB_URL`
- `MIMO_API_KEY` for the primary `mimo-v2.5` model
- `DEEPSEEK_API_KEY` remains deploy-required and provisioned for the dormant DeepSeek fallback
- `APP_ENV` — forwarded from `wrangler.toml`'s per-environment `[vars]` block (`development` /
  `staging` / `production`), NOT a GitHub secret. Fail-closed since issue #498: the Worker throws at
  container-start if it is missing rather than seeding a hardcoded default, because a silent default
  previously tagged every environment's Logfire traces as `production` regardless of which
  environment actually deployed them.

  **There is a second, unrelated `APP_ENV`** — `apps/web/wrangler.jsonc`'s per-env `vars`, read by
  `apps/web/src/server/noindex-plugin.ts`. Same name, same meaning, **opposite behaviour when
  absent**: the container's is fail-**closed** (throw), the web app's is fail-**open-to-noindex**
  (assume non-production and send `X-Robots-Tag`). Both directions are deliberate — a mislabelled
  trace is cheap, a live site that stops sending `noindex` is not, and neither is a live site that
  starts. Do not "unify" them without deciding which cost you are choosing. Guarded by
  `apps/web/tests/unit/wrangler-app-env.test.ts`, which also pins the top-level block: its `name` is
  the production Worker, so a `wrangler deploy` without `--env` would otherwise publish to
  production with no `APP_ENV` and silently deindex the site.

Production is temporarily MiMo-only while the DeepSeek account has insufficient balance. After
recharging DeepSeek, set `FALLBACK_AGENT_MODEL=deepseek:deepseek-v4-flash` to re-enable the already
provisioned fallback path.

Common runtime config:

- `ANITABI_API_URL`
- `CORS_ALLOWED_ORIGIN`
- `DEFAULT_AGENT_MODEL`
- `FALLBACK_AGENT_MODEL` (empty by default for MiMo-only operation)
- `LOG_LEVEL`
- `MAX_RETRIES`
- `TIMEOUT_SECONDS`
- `OBSERVABILITY_SERVICE_NAME`
- `OBSERVABILITY_SERVICE_VERSION`
- `LOGFIRE_TOKEN` (optional — tracing/metrics export to Logfire only when set). Since issue #498,
  production and staging each write to their own Logfire project (`animichi-prod` /
  `animichi-staging`) via **GitHub Environment-scoped secrets of the same name**
  (`LOGFIRE_TOKEN` defined directly on the `production` and `staging` GitHub Environments), not
  via workflow-level branching. No workflow YAML changes were needed for this: both
  `_deploy-component.yml`'s `deploy` job (`environment: ${{ inputs.environment }}`) and
  `deploy.yml`'s `deploy` job (`environment: production`) already ran under a job-level
  `environment:`, and GitHub environment secrets take precedence over a same-named secret the
  caller workflow explicitly passes through `secrets:` for a job that references that environment
  — see [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
  ("If you include environment in the reusable workflow at the job level, the environment secret
  will be used, and not the secret passed from the caller workflow"). This was confirmed empirically
  against this repo's real GitHub Actions runners with a throwaway diagnostic workflow (three
  differently-sized marker secrets — repo-level, `production`-environment, `staging`-environment —
  each job resolved the environment-scoped one, not the repo-level one the caller passed): staging
  resolved the staging marker, production resolved the production marker, in both cases overriding
  what the caller's `secrets: LOGFIRE_TOKEN: ${{ secrets.LOGFIRE_TOKEN }}` line explicitly passed.
  The repo-level `LOGFIRE_TOKEN` secret remains only as the implicit fallback for a hypothetical
  environment with no `LOGFIRE_TOKEN` secret of its own (same convention already relied on for the
  8-9 other secrets — `CLOUDFLARE_API_TOKEN`, `NEON_DATABASE_URL`, `PULUMI_*`, `R2_*`,
  `NEON_AUTH_JWKS_URL` — that are defined both at repo level and per-environment).
- `CORS_ALLOWED_ORIGIN` is defined as a **`production`-environment secret** (no repo-level copy) —
  by the same precedence rule above, it was already reaching the container correctly in production
  deploys. Staging gets its value a different way (#527/#528): `wrangler.toml`'s
  `[env.staging.vars].CORS_ALLOWED_ORIGIN` sets it to the real staging web origin
  (`https://animichi-web-staging.zhenjiazhou0127.workers.dev`) as a plain (non-secret) value, not a
  GitHub secret — a domain name isn't a secret, and this needs no owner action to provision. Do
  **not** add a `CORS_ALLOWED_ORIGIN` secret to the `staging` GitHub Environment: it is no longer
  in `deploy-root-staging`'s `worker_secrets` list, so such a secret would be dead (unread), and if
  it were ever added back to that list later, the secret would silently override the wrangler var,
  reintroducing a second source of truth. Before #527/#528, staging had neither the secret nor the
  var, and inherited APP_ENV's mislabeling as "production" (see above) — which made
  `cors_allowed_origin`'s `"*"` default fail the production-strictness CORS check and **crash the
  container at boot** rather than silently accept a wildcard origin; #527/#528 fixed this at the
  `wrangler.toml` layer, independent of the APP_ENV fix in this same issue.
- `GOOGLE_MAPS_API_KEY` (optional)
- `ANON_DAILY_COST_BUDGET_USD` (optional — the global anonymous daily-dollar circuit breaker, X4/#274; `0` disables it)
- `ANON_DAILY_MESSAGE_QUOTA` (optional — the per-identity anonymous daily message quota, S1.10/#282, a fairness/UX mechanism rather than a defense line; `0` or unset disables it, same convention as the budget ceiling above)

Session storage:

- the backend currently uses the in-memory session store only

## Container Path

Build the image locally:

```bash
docker build -t seichijunrei-runtime .
```

Run the image locally:

```bash
docker run --rm -p 8080:8080 \
  -e SUPABASE_DB_URL \
  -e ANITABI_API_URL \
  -e MIMO_API_KEY \
  -e DEEPSEEK_API_KEY \
  -e CORS_ALLOWED_ORIGIN \
  seichijunrei-runtime
```

Smoke test:

```bash
curl http://127.0.0.1:8080/healthz
curl -X POST http://127.0.0.1:8080/v1/runtime \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: local-dev' \
  -H 'X-User-Type: human' \
  -d '{"text":"从京都站出发去吹响的圣地"}'
```

Note: direct container access trusts forwarded identity headers. Bearer-token auth is enforced at the Worker edge, not inside the container process.

## Cloudflare Workers + Containers Path

Production runs on Cloudflare Workers + Containers (backed by a Durable Object container class).
`wrangler deploy` builds the image from `Dockerfile`, uploads it to Cloudflare's container registry, and wires it to `RuntimeContainer`.

Requirements:

- Wrangler 4+ (`[[containers]]` is ignored by Wrangler 3)
- GitHub Actions uses `cloudflare/wrangler-action@v4` with `wranglerVersion: "4.79.0"`
- This repo deploys from the checked-in `Dockerfile`; there is no GHCR handoff

Routing defined by `wrangler.toml`:

- `/v1/*` and `/healthz` run through the Worker and proxy to `CONTAINER`
- `/v1/users/*` goes to the `USERS` service binding (it verifies its own JWT)
- `/catalog/public/anime-overview/:id` is the one allowlisted anonymous catalog read
- `/img/*` runs through the Worker image proxy/cache
- everything else answers a JSON `404 not_found`

Issue #537 removed the bundled Next.js app and with it the `[assets]` binding: this Worker
has **no** HTML surface. `apps/web` deploys as its own Worker and owns every page. The root
Worker's `routes` still claim `animichi.com/*`, so the apex has not yet been cut over to the
web Worker. Until issue #541 changes the DNS and route ownership, the root Worker owns the
apex request but returns its JSON 404 for page paths; `apps/web` owns HTML only on its own
Worker hostname. That cutover must land before `animichi.com` gets a DNS record.

## Deploy Sequence

There are two workflow-backed deploy paths. Neither path is tag-triggered.

### Schema change policy

Neon migrations run from `db/migrations/` before the Worker rollout, but the old container can
still serve traffic while that step is running. A destructive change can therefore briefly break
old code that still reads or writes the removed schema; the `route_anime` release, for example,
dropped `routes.bangumi_id` in the same release that changed the writer. For schema changes where
that overlap matters, use expand/contract: add the replacement first, deploy compatible readers
and writers, then remove the old column in a later release. Today’s infrequent, approval-gated
cadence keeps this window low-risk, but it does not make destructive same-release changes safe by
construction. The full authoring/apply boundary is [`migrations.md`](./migrations.md).

### ⚠️ The first successful staging/production Atlas run is a provisioning event, not a routine migration

Confirmed via Neon (project `billowing-fire-22850320`, read-only queries, #516 investigation): as of
2026-07-29, staging (`br-gentle-king-aowjem8v`) and production (`br-cold-term-aor1v6gl`) both have
**zero** business tables in `public` — only `neon_auth` (Neon Auth's own 9 tables, unrelated to
`db/migrations`) and, on staging, an empty orphaned `atlas_schema_revisions` schema left over from
an earlier manual attempt that ran without `--revisions-schema public`. The full, real data plane
(23 tables) exists only on the `test-base` branch. **Every prior "successful deploy" to staging or
production shipped Worker code against an empty database** — the app-level effect of that had not
previously surfaced because nothing had exercised the affected paths hard enough to notice.

Once the Atlas scoping fix above lands, the first `Atlas migrate` run against staging (and,
separately and later, production) will apply **all 11** `db/migrations/*.sql` files from scratch in
one shot — this is a one-time provisioning event for that branch, not the incremental single-file
apply every subsequent deploy will actually be. Reviewed all 11 files for anything that assumes a
manual step outside the migration directory (backfills, hand-run grants, seed data) — found none;
every `ALTER`/`DROP` is `IF EXISTS`/`IF NOT EXISTS`-guarded and every `DO $$` block is self-contained
and idempotent, so applying them in order from empty should be safe. That review is static, not a
substitute for watching the real run.

**Before letting production follow staging through this**:
1. After staging's first post-fix deploy, manually confirm all 23 expected tables exist in
   `public` on the staging branch (e.g. `SELECT count(*) FROM information_schema.tables WHERE
   table_schema = 'public'` via Neon, or `\dt` over a direct connection) — don't infer success from
   the CI job going green alone.
2. Only then let `deploy-prod` proceed; production is currently even more empty than staging was
   (it doesn't even have the stray `atlas_schema_revisions` table staging had), so it faces the
   identical one-shot 11-migration apply, not a smaller catch-up.

### Main promotion path (`.github/workflows/ci.yml`)

`ci.yml` runs on pushes to `main` and `develop`, plus pull requests. Deploy jobs are narrower: they
only start when `github.event_name == 'push'` and `github.ref == 'refs/heads/main'`.

On a push to `main`, the current promotion chain is:

1. The seven stable required lanes run first: `Web CI`, `Backend CI`, `Agent CI`, `Infra & DB CI`,
   `Cross-stack E2E`, `Repository Quality`, and `Codecov Patch`. Their component jobs remain
   affected-only on pull requests, while each stable lane is always created and treats an
   intentionally skipped component as green. A failed or cancelled component fails its lane and
   blocks promotion. The `agnix` check remains warn-only inside `Repository Quality`; its warning
   policy is explicit and does not mask failures from the security reusable workflow or CI contract
   test. `Codecov Patch` is deliberately only the stable upload/policy precondition: it does not
   calculate changed-line coverage locally. The GitHub ruleset must require the external Codecov
   `codecov/patch` status as the real 95% changed-line verdict as well as this stable context.
   Coverage upload jobs use GitHub OIDC and fail closed when Codecov cannot authenticate or publish;
   they do not silently accept a tokenless upload failure.
2. `deploy-staging` calls `_deploy-component.yml` with `component: catalog`,
   `environment: staging`, and `pulumi_stack: staging`.
3. `_deploy-component.yml` runs with `environment: ${{ inputs.environment }}`. It checks out the
   repo, runs the shared setup action, applies Atlas migrations when `NEON_DATABASE_URL` is set,
   runs `pulumi up` in `infra/`, deploys `workers/${{ inputs.component }}` with Wrangler, and runs
   the component smoke step.
4. `deploy-maintenance-staging` deploys the scheduled Worker after the catalog job has applied Atlas
   migrations; the web, users, and root staging deploys complete in the same promotion stage.
5. `post-staging` runs the API post-deploy suite against staging.
6. `deploy-prod` and the other production component jobs deploy catalog, web, users, maintenance,
   and root with `environment: production`; `pulumi_stack: prod` remains catalog-only. The GitHub
   `production` environment is the human approval gate.
7. `post-prod` runs the production smoke post-deploy suite.

### Manual production path (`.github/workflows/deploy.yml`)

`deploy.yml` is `workflow_dispatch` only. Its `Deploy to Production` job also uses
`environment: production`, so it requires the same GitHub environment approval before the job runs.
Its current order is:

1. install workspace dependencies (`pnpm install --frozen-lockfile`); there is no app build
   step — the root Worker ships as TypeScript source
2. validate the checked-in Neon migration directory with pinned Atlas (the manual path does not
   mutate the database)
3. deploy the catalog Worker first, because the root Worker service binding depends on it
4. deploy the users Worker before the root Worker, because the root `USERS` binding depends on it
5. deploy the scheduled maintenance Worker with `AGENT_DATABASE_URL`
6. verify `Dockerfile` exists
7. deploy the root Worker/container with Wrangler

The approval-gated main promotion (`_deploy-component.yml`) applies `db/migrations/` before its
catalog/users rollout. This manual path does not apply either the Neon or frozen Supabase
compatibility directory; an explicitly approved auth migration follows the separate Supabase
owner/runbook and must not be used to change Neon catalog or user tables.

Do not use version tags as a deploy trigger for the current pipeline.

**CF Worker routing** (`worker/app.ts`):
- `/v1/*` and `/healthz` → `CONTAINER` (Durable Object → FastAPI service on port 8080)
- `/v1/users/*` → `USERS` service binding
- `/catalog/public/anime-overview/:id` → allowlisted anonymous catalog read
- `/img/*` → image proxy + cache
- Everything else → JSON `404 not_found` (no asset/page fallback since #537)

## WAF and Edge Hardening

Manual Cloudflare dashboard steps live in `docs/ops/cloudflare-hardening.md`.
That runbook covers:

- `/v1/*` rate limiting
- coarse prompt-injection WAF filters
- rollback steps for over-blocking rules
- the future AI Gateway insertion point

## AI Gateway Insertion Path

If AI Gateway is enabled later, it belongs between the container and the upstream model provider.
It does not belong in the browser and does not belong in the Worker.

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional container-only env

Important: this is a documentation target only right now. Before enabling it, the backend planner client must support provider base-URL override through env rather than assuming the provider default.

## Rollback

Every `_deploy-component.yml` deploy step is a plain `wrangler deploy` (not `wrangler versions
upload`), but Cloudflare still records each one as a numbered **version** under the hood, so
`wrangler rollback` and `wrangler versions list` work against it without any change to the deploy
step itself. This is the instant-rollback side of the same versions primitive used by deployment.

### One-command rollback per component

Find the last known-good **version id** first (not a "deployment id" — `wrangler rollback` takes a
version id from `wrangler versions list`), then roll back non-interactively. Run from the repo
root; `pnpm --filter <pkg> exec` resolves each sub-worker's own `wrangler.toml`/`wrangler.jsonc`.
`wrangler rollback` prompts interactively for confirmation and a reason message by default — in a
non-TTY shell that hangs rather than failing, so always pass `-y` (auto-confirm) and `-m` (reason)
explicitly.

| Component | Working dir | List versions | Roll back |
|---|---|---|---|
| root (edge Worker + container) | `.` | `npx wrangler@4.112.0 versions list --env <staging\|production>` | `npx wrangler@4.112.0 rollback <version-id> --env <staging\|production> -y -m "<reason>"` |
| catalog | `workers/catalog` | `pnpm --filter catalog exec wrangler versions list --env <staging\|production>` | `pnpm --filter catalog exec wrangler rollback <version-id> --env <staging\|production> -y -m "<reason>"` |
| users | `workers/users` | `pnpm --filter users exec wrangler versions list --env <staging\|production>` | `pnpm --filter users exec wrangler rollback <version-id> --env <staging\|production> -y -m "<reason>"` |
| maintenance | `workers/maintenance` | `pnpm --filter maintenance exec wrangler versions list --env <staging\|production>` | `pnpm --filter maintenance exec wrangler rollback <version-id> --env <staging\|production> -y -m "<reason>"` |
| web | `apps/web` | `pnpm --filter web exec wrangler versions list --env <staging\|production>` | `pnpm --filter web exec wrangler rollback <version-id> --env <staging\|production> -y -m "<reason>"` |

`wrangler rollback` with no version id rolls back to the version immediately before the current
one; pass an explicit id from the `versions list` output to jump further back. This only swaps the
running Worker code version — it does not touch bindings/secrets changed since that version, and it
does not re-run Pulumi.

**⚠️ root is the least certain of the five to roll back cleanly.** Unlike catalog/users/maintenance/web, root
carries two Durable Object bindings (`CONTAINER`, `EDGE_GUARD`) behind `[[migrations]]` (`v1`
`new_sqlite_classes: RuntimeContainer`, `v2` `new_sqlite_classes: EdgeGuard`) plus a `[[containers]]`
image. `wrangler rollback` swaps the Worker script version; it does **not** un-apply a Durable
Object class migration or restore a deleted container image:
- if the bad release added a DO migration, rolling back the *script* does not roll back the DO
  storage/class binding underneath it — a version straddling that migration boundary may not start
  cleanly, or may start against storage shaped for the newer class;
- if `wrangler containers delete` (or an image prune) already removed the container image the old
  version referenced, rolling back the script alone will not resurrect it — the old version will
  fail to boot its container until the image is rebuilt and pushed back.

Treat a root rollback across a DO-migration or container-image boundary as a case that needs manual
verification (does the old version actually start? check `wrangler tail`), not a routine one-liner.

Steps:

1. Identify the bad component(s) from the incident (which `deploy-*` job ran, or which route is
   failing).
2. `wrangler versions list --env <environment>` for that component; pick the version id from before
   the bad release (or omit it to go back exactly one step).
3. `wrangler rollback <version-id> --env <environment> -y -m "<reason>"` for that component.
4. If the rolled-back component is `root`, verify it actually started (`wrangler tail --env
   <environment>`, `/healthz`) — see the DO-migration/container warning above. There is currently no
   automated post-rollback check to lean on instead: `_post-deploy-test.yml`'s `api`/`e2e`/`smoke`
   suites are still TODO no-ops (tracked separately; PR #493 is turning them into real assertions).
   It does have a `workflow_dispatch` trigger now so it *can* be re-run manually from the Actions UI
   during an incident, but until those suites land, re-running it confirms nothing beyond "the job
   didn't crash" — don't treat a green re-run as verification yet.
5. Still revert the offending commit on `main` afterward — the rollback above is a stopgap for the
   live Worker, not a fix for the tree; the next `main` push will otherwise redeploy the bad code on
   top of your rollback.

### Pulumi rollback

`_deploy-component.yml`'s "Pulumi stack export (rollback backup)" step runs `pulumi stack export`
immediately before every `pulumi up` **that actually runs**, then uploads the result to the **same
R2 bucket the Pulumi state backend already lives in** (`aws s3 cp`, using the `R2_ACCESS_KEY_ID`/
`R2_SECRET_ACCESS_KEY` credentials already present in that step) under a `rollback-backups/`
prefix — object key `rollback-backups/pulumi-<stack>-<run-id>.json`.

**This is deliberately not a GitHub Actions artifact.** This repository is **public**, and a public
repo's workflow artifacts are downloadable by any signed-in GitHub account, not just people with
repo access. `infra/index.ts` exports `cloudflareAccountId`/`cloudflareZoneId`/`webDomain` in
plaintext and `catalogDatabaseUrl` as `secure:` ciphertext — publishing that as a run artifact on
every catalog deploy would mean handing out plaintext account/zone identifiers (a targeted-abuse and
social-engineering surface, even though not credentials themselves) and an offline-crackable Neon
connection string, retained for however long the artifact lived. Writing to the R2 bucket instead
keeps the backup exactly as private as the Pulumi state it's a snapshot of — no new exposure surface,
same trust boundary, same credentials this step already holds.

`run_pulumi` defaults to `true`, but every caller except `component: catalog` explicitly sets
`run_pulumi: false` (see `ci.yml`), so **this step currently only ever runs under the catalog deploy
jobs** (`deploy-staging` / `deploy-prod`) — don't go looking for a backup from a root/web/users run.

To roll back a bad Pulumi apply:

1. Fetch the object for **the same run that did the bad `pulumi up`** — the export step runs
   immediately *before* `up` inside that one run, so the pre-apply snapshot has that run's own
   `github.run_id` in its key, not the run before it. From `infra/`, with R2 credentials exported as
   `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`:
   ```
   aws s3 cp --endpoint-url "https://<cloudflare-account-id>.r2.cloudflarestorage.com" \
     "s3://<pulumi-state-bucket>/rollback-backups/pulumi-<stack>-<run-id>.json" ./backup.json
   ```
2. `pulumi stack select <staging|prod>` in `infra/`, then `pulumi stack import --file backup.json`
   to restore that state, followed by `pulumi up` to reconcile real infrastructure back to it.
3. This is a state-only restore; it does not undo already-applied Cloudflare API side effects that
   Pulumi doesn't track (rare, but check R2/DNS manually if in doubt).

**Known gap**: no lifecycle/expiry rule is configured on the `rollback-backups/` prefix yet, so
objects accumulate indefinitely instead of expiring after a few days the way the old GitHub-artifact
retention window did. Adding an R2 bucket lifecycle rule is an `infra/index.ts` change (a new Pulumi
resource, applied through the same approval-gated path as everything else here) and is out of scope
for this change; tracked as **#521**, not silently assumed to already exist.

### ⚠️ Database migrations do NOT roll back this way

Nothing above undoes an Atlas migration (`db/migrations`) or a Supabase migration. `wrangler
rollback` only swaps Worker code; it cannot un-apply a schema change the new code already wrote
data under. Roll a schema change back only by writing and applying a new forward migration that
reverses it (expand/contract, per the schema change policy above) — never by trying to "undo" the
old migration file. Treat any release that combined a schema change with app code as a case where
Worker rollback alone is insufficient; check `db/migrations` for what shipped in that release before
declaring the rollback complete.

### Prerequisite: a local Cloudflare API token, provisioned BEFORE an incident

Every command in the table above needs a Cloudflare API token in the operator's own environment —
this is not optional infrastructure to stand up mid-incident, it must already exist and already be
tested.

1. Create one at <https://dash.cloudflare.com/profile/api-tokens> → "Create Token" → custom token
   with, at minimum, **`Workers Scripts:Edit`** for the account (this is what `wrangler
   rollback`/`versions list`/`secret put` all authenticate against — the same permission
   `CLOUDFLARE_API_TOKEN` already carries in CI). Scope it to the account, not a single zone; root's
   rollback also needs `Workers Scripts:Edit` on the account the `catalog`/`users` Workers live in if
   you need to roll those back too, since they're separate Workers under the same account.
2. Store it in a password manager or the OS keychain, not a plaintext file in the repo or home
   directory — export it into the shell only for the duration of the rollback (`export
   CLOUDFLARE_API_TOKEN=...`; `wrangler` reads it from that env var, no config file needed).
3. **Verify it works now, not during the incident**: `wrangler whoami` should print the token's
   scope; `wrangler versions list --env staging` (read-only) against a real component confirms both
   the token and this doc's commands actually work end to end.
4. Anyone expected to run this table during an incident needs their own token satisfying the above
   *before* they're on call for it — this whole rollback path assumes that precondition and does not
   re-derive credentials for you.

### Automating the rollback trigger

No dedicated `workflow_dispatch` rollback workflow (component + version-id inputs) is added here
beyond the manual commands above. `wrangler rollback`/`versions list` already are the one-command
primitive the issue asked for; wrapping them in a bespoke, never-exercised dispatch workflow would
add untested complexity — invalid version ids, wrong environment, partial multi-component rollback
ordering, the DO-migration/container caveat above — to an incident-response tool that most needs to
be simple and trustworthy under pressure. The manual table above can be run by anyone with the
Cloudflare API token described just above, from their own machine; automating it is tracked
separately as **#496** (rollback automation), including the case this section's own tradeoff doesn't
cover — an incident where the only device on hand is a phone, where a local `wrangler` invocation
isn't reachable at all and a `workflow_dispatch` may be the only usable primitive — and the
precondition that the manual path above has actually been exercised at least once before automating
it. (`_post-deploy-test.yml` did gain a `workflow_dispatch` trigger in this same change — tracked
separately as #493 for turning its suites from TODO no-ops into real assertions — since the trigger
itself was a pure UI-affordance gap rather than new untested rollback logic; see step 4 above.)

### WAF rollback

1. disable the custom prompt-injection rule first
2. keep the `/v1/*` rate limit in place unless it is the source of the incident
3. inspect Worker logs before re-enabling stricter filters

## Known Limitations

- default session storage is in-memory unless a distributed backend is introduced later
- OpenTelemetry exporters are opt-in and disabled by default
- AI Gateway is documented but not yet wired in backend provider configuration
- **CURRENTLY BROKEN — do not rely on this**: `/healthz`'s `git_branch`/`git_commit` fields are
  always `"unknown"` in every deployed environment. `Dockerfile` never `COPY`s `.git` into the
  image, so the `git rev-parse`/`git branch --show-current` calls in
  `apps/agent/agent/interfaces/routes/health.py` fail every time. "Verify `/healthz` `git_branch`
  after a deploy" (referenced in `docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md:215`
  and `docs/superpowers/specs/2026-07-28-284-byok-design.md:1080`) cannot confirm anything today —
  tracked in issue #494.

## HISTORICAL (pre-2026-07): feat/ssr-cloudflare Post-deploy Notes

This section records the old feat/ssr-cloudflare merge runbook. It is not the current deployment
trigger or an executable migration procedure. **Historical only; no longer current.** The current
Neon migration authority is `db/migrations/` applied by pinned Atlas before the Worker rollout;
use [`migrations.md`](./migrations.md) and the workflow paths above instead.

After the old feat/ssr-cloudflare merge, operators used these checks:

1. **Historical Supabase schema event (not a current apply)** — the old Supabase CLI path recorded
   these legacy schema files:
   - `20260509200000_fix_wrong_bangumi_ids.sql` — delete wrong seed IDs
   - `20260510170000_add_bangumi_platform.sql` — add platform column
   - `20260510180000_add_points_city.sql` — add city column to points

2. **Backfill city for existing points** — one-time, run after migrations:
   ```bash
   SUPABASE_DB_URL=<production_dsn> uv run python -m backend.scripts.backfill_city
   ```
   This reverse-geocodes all points with `city IS NULL` using GeoNames data (~12MB).
   Expected: ~1000+ points across ~50 cities. Takes <30 seconds.

3. **Verify** — check a few bangumi:
   ```sql
   SELECT city, count(*) FROM points GROUP BY city ORDER BY count DESC LIMIT 10;
   ```
