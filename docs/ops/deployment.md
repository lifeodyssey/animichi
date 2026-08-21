# Deployment

This is the canonical deployment runbook for the current runtime.
The old root `DEPLOYMENT.md` compatibility pointer was removed in iter6 A6 (#640); this file is the only deployment runbook.

This file covers non-secret runtime config. For what each GitHub secret is, who consumes it,
and rotation impact, see [`secrets.md`](./secrets.md).

## SAFE-1: production freeze (2026-08-10)

Every production entry point (`ci.yml` promotion, manual `deploy.yml`, and `rollback.yml`) routes
through the SAFE-1 eligibility workflow. It resolves the immutable pre-campaign release manifest
(`.github/release-manifests/production-pre-campaign.json`, content-addressed by pinned Git blob id
and SHA-256) from the GitHub API — never from the working tree — and judges the candidate SHA.

- **Eligible** when the candidate `github.sha` equals the pinned pre-campaign source revision
  `b94c30ab6a519f1cce9eb0a3f7885953f8ff54cf` (Atlas target `20260809000031`). Production jobs then
  check out that pinned revision, verify `HEAD` and `atlas.sum`, and apply Atlas with the pinned
  target.
- **Ineligible** otherwise: every production job is skipped (CI records the reason in the
  `production-eligibility` job's log as a notice: "candidate <sha> is not the pinned pre-campaign
  source <sha> — campaign revisions cannot mutate production"). The reusable deploy additionally
  fails closed before Atlas/Pulumi/Wrangler if an ineligible caller somehow reaches it.
- **Rollback** has no caller-supplied `version_id` anymore: eligibility resolves from the manifest,
  and every component is rollback-ineligible until an owner-approved manifest revision marks a
  component/version pair eligible.

Operator notes: the freeze is a self-referential GitHub Actions guard — it makes ordinary campaign
revisions technically unable to mutate production, and it cannot stop someone who deliberately
edits the freeze's own workflows or resolver pins. Staging behavior and DAG are unchanged.



## Build-once component promotion

Issue #1007 wires the build-once promotion primitive beside the existing deploy path; the old
per-environment rebuild path stays available during expand/migrate and is deleted by the final
promotion ticket (#1013, AC6) only after every component migrates. Issue #1013 slice 2 (AC3/AC4/AC5)
generalizes the primitive to every deployable component and hardens the production path; the
AC6 cutover (deleting the legacy `Deploy Worker` rebuild path) is NOT yet done and requires
staging/prod evidence + owner approval.

A component built by `reusable-deploy-component.yml` emits:

- a **promotion manifest** (`.github/scripts/promotion-manifest-cli.py generate`) pinning component,
  source SHA, artifact digest (SHA-256), SBOM/attestation, schema compatibility, configuration
  schema, and dependency revisions — schema closed, unknown fields rejected;
- **one immutable CI artifact** (the built output tarball) keyed by its digest, so a rebuild
  that changes a byte is detectable;
- staging **consumes and reports** the manifest digest after deploy;
- production eligibility (`reusable-production-eligibility.yml`) runs a deterministic AC4
  self-check that rejects a rebuild, a mismatched digest, stale staging evidence, an
  incompatible schema, or a changed dependency manifest;
- **#1013 AC4**: a deployed-version-metadata read (`.github/scripts/promote_deployed.py`) fails
  when the deployed digest/config schema differs from the approved manifest. For components with
  no platform metadata yet it fails closed with a documented mechanism (see `promote_deployed.py`
  `PLATFORM_READ_MECHANISM`); the live read is wired per component once a platform adapter exists.

**AC3 (component generalization):** `promotion_manifest.py` maps every deployable component to its
artifact dir (`component_artifact_dir()`/`COMPONENT_ARTIFACT_DIRS`) — web → `apps/web/.output`, the
Cloudflare Workers (catalog/users/edge/root) → their wrangler dry-run bundle dir, infra → Pulumi
state digest. The deploy workflow resolves `PROMO_ARTIFACT_DIR` from this table (never invented
inline), so an unmapped component fails closed. The six AC3 manifests (Agent/Edge/Catalog/Users/Web/Infra)
are covered by `test_promotion_manifest.py` and the `promotion-manifest-e2e.test.sh` AC3 section.

**AC5 (no prod build, no tag deploy):** when a promoted artifact digest is supplied, the deploy
consumes that artifact (no `pnpm … build` runs for a promoted component); the build and build-once
manifest steps are gated off by `promotion_artifact_digest == ""`, and the consume step fails closed
until the immutable digest-keyed store (AC6/#1013 follow-up) lands. Neither `ci.yml` nor `deploy.yml`
is tag-triggered (asserted by `test_promotion_ac5_contract.rb`).

Source of truth for the schema: `.github/scripts/promotion_manifest.py`; behavioral coverage:
`.github/scripts/test_promotion_manifest.py` (unit), `scripts/local-gates/promotion-manifest-e2e.test.sh`
(AC2/AC3/AC4), `.github/scripts/test_promote_deployed.py` (AC4 read+gate), and
`.github/scripts/test_promotion_ac5_contract.rb` (AC5), all run in `pipeline-quality.yml`. Rollback
remains the SAFE-1/`wrangler rollback` path above.
## Edge Topology

```text
Browser
  ├─ static paths ───────────────────────────────▶ Cloudflare ASSETS
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy/cache
  ├─ /healthz ───────────────────────────────────▶ Worker → RuntimeContainer → FastAPI service
  ├─ /catalog/* ─────────────────────────────────▶ Worker → CATALOG service binding → catalog Worker
  │                                                          └─ Neon Postgres/PostGIS via neon-http (`DATABASE_URL`)
  └─ /v1/* ── auth at Worker edge ───────────────▶ Worker → RuntimeContainer → FastAPI service
                                                            ├─ Neon Postgres (`AGENT_SVC_DATABASE_URL`)
                                                            ├─ catalog read path (`CATALOG_API_URL` → /catalog/*)
                                                            └─ MiMo primary (`MIMO_API_KEY`)
                                                               └─ DeepSeek fallback temporarily disabled
                                                                  (`DEEPSEEK_API_KEY` remains provisioned)
```

The hybrid topology runs the edge Worker plus the catalog and users Workers. The main `seichijunrei` Worker
(`workers/edge/src/entry.ts`) routes `/catalog/*` to the separate `catalog` Worker
(`workers/catalog/wrangler.toml`) via a wrangler service binding (`env.CATALOG.fetch`).
The Python agent in the container cannot use that JS-only binding, so it reaches
the catalog over the public origin: `CATALOG_API_URL` (forwarded into the
container as a plain var) points at the deployed host, and `CatalogClient` POSTs
to `{CATALOG_API_URL}/catalog/<method>`, which the main Worker forwards to the
catalog Worker. Deploy order: catalog Worker first (so `service = "catalog"`
resolves), then the main Worker.

Catalog and users Workers query Neon through Drizzle's `neon-http` driver, which supplies their
runtime query/type metadata. The checked-in Atlas directory is the only Neon schema authority for
all three. See
[`migrations.md`](./migrations.md) before changing a table or deploy step.

Agent HTTP surface (paths relative to `apps/agent/src/animichi/`):

- `interfaces/fastapi_service.py` / `interfaces/routes/health.py` — `GET /healthz`
- `interfaces/routes/runtime.py` — `POST /v1/runtime` and `POST /v1/runtime/stream` (SSE)
- `interfaces/routes/feedback.py` — `POST /v1/feedback`
- `apps/agent/Dockerfile` packages the agent into a single container image

The deployment target stays intentionally thin. The Worker owns routing and edge auth; the container runs the agent service and stays unaware of raw end-user credentials.

## Trust Boundaries

| Layer | Responsibility | Secrets/config it should see |
|---|---|---|
| Web app (`apps/web`) | SSR browser surface, deployed as its own Worker on its own route | none of this Worker's secrets |
| Worker edge | Route match, JWT auth, identity injection | `NEON_AUTH_JWKS_URL` |
| Container runtime | Backend service, DB, model/provider calls | `AGENT_SVC_DATABASE_URL`, `MIMO_API_KEY`, `DEEPSEEK_API_KEY`, `CORS_ALLOWED_ORIGIN`, optional observability keys |

Current hardening rule: the Worker strips the raw `Authorization` header before proxying and forwards only trusted `X-User-Id` / `X-User-Type` identity headers to the container.

## Auth Flow

Worker auth is implemented in `workers/edge/src/identity/auth.ts`:

- JWT flow: `authenticate()` verifies the token signature locally against the branch's Neon Auth JWKS (jose `createRemoteJWKSet`, cached per isolate) — no per-request round-trip to the auth origin. AUTH-2 #950 hard cut: `NEON_AUTH_JWKS_URL` is the edge's ONLY identity source; issuer/audience are derived from it (EdDSA), and the injected `X-User-Id` is the token `sub`.
- Production JWKS is unset — the production edge Worker fails closed on any bearer until its Neon Auth branch is provisioned.
- `sk_*` API keys are gone (AUTH-1 #945): an `sk_*` Bearer token is rejected as invalid — there is no `api_keys` lookup and no "agent" identity class.
- Forwarding flow: the Worker injects `X-User-Id` and `X-User-Type`, deletes `Authorization`, and proxies the request to `CONTAINER` (unchanged); `/v1/users/*` goes to the `USERS` service binding with the same identity headers (users trusts only the edge-forwarded identity).

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

- `NEON_AUTH_JWKS_URL` (staging; production unset — fails closed until its Neon Auth branch is provisioned)

These secrets stay in the Worker environment and are not forwarded into the container runtime. The edge JWT path verifies against the branch's public JWKS — no Supabase/anon key is involved (AUTH-2 #950).

### Container runtime

Required:

- `AGENT_SVC_DATABASE_URL` — the Postgres DSN (#995: the `SUPABASE_DB_URL` fallback
  was deleted from settings). The role-scoped Neon DSN (`agent_svc` role) is supplied
  via the edge Worker's Secrets Store binding and forwarded into the container. The legacy
  `SUPABASE_DB_URL` name remains only as a **transitional container-DSN env name** (a Neon DSN,
  not a live Supabase plane) pending the #855 rename; see `docs/ops/prod-dsn-cutover.md`.
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

- `EDGE_SHOWCASE_MODE` — edge-only `[vars]` (NOT forwarded to the container, NOT a GitHub secret),
  the worker-side half of "prod is a landing-only showcase" (GOAL C): `"true"` (production) makes
  every functional route (`/v1/*`, `/v1/users/*`, the public catalog read) answer 403
  `showcase_denied` before any binding is touched, while `/healthz`, `/img/*`, `/tiles/*` stay
  reachable. Strict boolean like `VITE_SHOWCASE_MODE`: only the literal `"false"` opens the
  backend — unset/empty/malformed values fail closed (deny) with a one-per-isolate warning. Pinned
  by `workers/edge/test/container-env.test.ts`; the post-deploy smoke gate parses it from `wrangler.toml`
  and asserts the denial as a permanent CI check.

Production is temporarily MiMo-only while the DeepSeek account has insufficient balance. After
recharging DeepSeek, set `FALLBACK_AGENT_MODEL=deepseek:deepseek-v4-flash` to re-enable the already
provisioned fallback path.

Common runtime config:

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
  `reusable-deploy-component.yml`'s `deploy` job (`environment: ${{ inputs.environment }}`) and
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
  -e AGENT_SVC_DATABASE_URL \
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
- `/v1/users/*` goes to the `USERS` service binding, trusting only the edge-forwarded identity headers (it no longer verifies its own JWT — AUTH-2 #950)
- `/catalog/public/anime-overview/:id` is the one allowlisted anonymous catalog read
- `/img/*` runs through the Worker image proxy/cache
- everything else answers a JSON `404 not_found`

<!-- historical: retired in #537 -->
Issue #537 removed the bundled legacy static frontend and with it the `[assets]` binding: this
Worker has **no** HTML surface. `apps/web` (TanStack Start) deploys as its own Worker and owns
every page. Route ownership for the apex is declared in Pulumi (`infra/index.ts`, #541): until
`webRoutesEnabled` is on, the root Worker may have no public hostname at all
(`workers_dev = false`). `apps/web` owns HTML on its Worker hostname; the root Worker is API +
proxy only (`/v1/*`, `/healthz`, `/img/*`, `/tiles/*`, one public catalog read).

## Deploy Sequence

There are two workflow-backed deploy paths. Neither path is tag-triggered.

### Schema change policy

Neon migrations run from `migrations/neon/` before the Worker rollout, but the old container can
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
`migrations/neon`) and, on staging, an empty orphaned `atlas_schema_revisions` schema left over from
an earlier manual attempt that ran without `--revisions-schema public`. The full, real data plane
(23 tables) exists only on the `test-base` branch. **Every prior "successful deploy" to staging or
production shipped Worker code against an empty database** — the app-level effect of that had not
previously surfaced because nothing had exercised the affected paths hard enough to notice.

Once the Atlas scoping fix above lands, the first `Atlas migrate` run against staging (and,
separately and later, production) will apply **all 11** `migrations/neon/*.sql` files from scratch in
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

1. The per-package suites run in their own `pipeline-*.yml` workflows (S0-v2 B4, CI-1 union
   method): `pipeline-web/agent/catalog/users/edge/contract/infra/db.yml`, each with
   the three-stage naming `lint` / `test` / `build` (db has `lint` + `build`), a pathless
   `pull_request` trigger (merge_group compatibility), a `merge_group` trigger on `main`, and
   push paths on `main`. The `changes` aggregation job, dorny/paths-filter middle layer, and the
   whole `*-gate` layer are retired; required checks land on real job names. The credentialed
   verify lanes (`Agent Eval (L0 smoke, ~80 cases)`, `Python integration (Neon)`, `Catalog spikes
   (Neon)`) remain in `ci.yml` and are never required; they self-gate with step-level dorny
   filters. STATUS (as of 2026-08-06): the repository ruleset has been flipped — the
   orchestrator executed the one-shot hard-switch PUT (9 → 35 required contexts; the 6 retired
   gate contexts were deleted in the same PUT; `enforcement=active`, `bypass_actors=[]`;
   verified via `gh api repos/lifeodyssey/animichi/rulesets/19974534`). The ruleset now requires
   the 35 contexts declared in `docs/iterations/s0v2/ruleset-target.json` (a live-state
   snapshot, not a target): the 23 new contexts (22 package stages — `Agent`/`Catalog`/`Users`/
   `Maintenance`/`Edge`/`Contract` lint+test+build, `Infra` lint+test, `DB` lint+build — plus the
   `Quality / invariants` meta lane (`pipeline-quality.yml` — the unfiltered fixed point that
   also carries the repo-hygiene checks and the CI contract test)), the three
   `Web / lint|test|build` contexts B1 already required, and the 9 `Security / *` contexts
   (ci.yml declares a `merge_group` trigger, so queue runs produce them). `Infra / build` is
   deferred out of the required set: the new `pipeline-infra.yml` lane was red at flip time (R2
   state-backend 401, credentials since re-issued) and its preview steps are path-gated on PRs;
   re-add it once the lane is consecutively green.
   BACKLOG (not part of the B4 PUT): the 95% changed-line verdict. `codecov/patch` is not a
   required status today — neither in the live ruleset nor in the B4 target — and the retired
   `Codecov Patch` lane was only the upload/policy precondition, not the changed-line gate.
   Re-requiring the external `codecov/patch` status (95% patch coverage) is a tracked backlog
   item for the orchestrator; until then the repo-side policy check
   (`pipeline-quality.yml` "Verify patch coverage policy") is the only 95% enforcement.
0. **Schema before app (migrator, #1051/#1052)**: `deploy-migrator-staging` deploys the migrator
   worker (its DSN arrives from the Cloudflare Secrets Store binding, never from CI), then
   `migrate-staging` triggers it via GitHub OIDC (no stored secret), applies the committed chain
   to head, and fails the run unless the applied head equals the expected target. Every staging
   component deploy below depends on `migrate-staging` in its `needs:` graph, so a failed
   trigger blocks all component deploys. The routine staging path carries NO `NEON_DATABASE_URL`.

2. `deploy-infra-staging` always runs on the deploy lane (no path filter) and applies the
   main `infra/` stack (`reusable-deploy-infra.yml`). Staging catalog, users, web, and root
   `needs` that job **and** `migrate-staging`. Catalog, users, and root ring the Builds
   doorbell (`reusable-ring-doorbell.yml`); `staging-worker-paths` skips those rings when
   their tree did not change. Staging web also rings the doorbell (#1075).
   `vars.DOORBELL_STAGING_URL` is public config. Accepted tradeoff: staging deploys
   no longer wait on any package pipeline, because GitHub cannot express `needs:` across
   workflows — protection comes from the required merge contexts in the ruleset instead, plus
   the future merge queue.
3. `deploy-neon-secrets-staging` runs **before** `deploy-staging` (catalog waits on it, so
   users/root cascade behind it): the Neon service roles and the Cloudflare Secrets
   Store DSN secrets (`infra/neon-secrets/`, ADR 0003 / #912) must exist before any Worker deploy
   consumes them (PR2's `wrangler.toml` store bindings). It calls the slim
   `reusable-deploy-neon-secrets.yml` (Pulumi-only — no Worker machinery):
   `pulumi package add` to generate the gitignored Neon provider SDK (the package.json rewrite
   that command performs is reverted right after — a `file:` spec it appends to
   `pnpm.onlyBuiltDependencies` makes pnpm 10.33 reject the project, see the workflow header),
   a plain frozen `pnpm install` against `infra/neon-secrets/pnpm-lock.yaml` (the SDK's
   postinstall compiles it; the committed `pnpm-workspace.yaml` allows that build), the #485
   rollback backup to the same R2 `rollback-backups/` prefix, and `pulumi up` on stack
   `staging`.
   **State backend**: R2 (`PULUMI_BACKEND_URL`) + `PULUMI_CONFIG_PASSPHRASE` — the same
   encrypted backend the `infra/` project uses. A file backend was used for the #926 validation
   but can never serve CI, and the state holds Neon role passwords + DSNs, so it must stay
   encrypted at rest. No `NEON_API_KEY` secret exists: the key lives in the committed
   `Pulumi.staging.yaml` as a passphrase-encrypted `secure:` value, exactly like `infra/`'s
   stack configs.
   **First run**: the `staging` stack does not exist on R2 yet, so the job `pulumi stack init`s
   it (passphrase secrets provider) and runs `.github/scripts/neon-secrets-adopt.sh`, which
   imports the resources the #926 local file-backend run created (a fresh `up` would try to
   re-create the roles and the Neon API rejects duplicate creates). Adoption is idempotent and
   guarded on the stack state; after it, `pulumi up` is a no-change apply.
   **Production**: deliberately absent from `deploy.yml` and the prod promotion — the stack is
   staging-only (single branch, no `Pulumi.prod.yaml`); the production stack is a #912
   follow-up.
4. `reusable-deploy-component.yml` runs with `environment: ${{ inputs.environment }}`. It checks out the
   repo, runs the shared setup action, and runs the `run_atlas` migration step ONLY when the
   caller leaves it on. **#1052 schema-before-app**: every **staging** caller passes
   `run_atlas: false` and carries no `NEON_DATABASE_URL` - the schema is applied by the
   **migrator trigger** (`migrate-staging` in ci.yml, step 0) BEFORE any component deploy, so a
   staging deployment never holds the database credential. **Production** callers keep
   `run_atlas` on and the pinned per-component Atlas apply (`NEON_DATABASE_URL` present) until
   #1055 removes it. Staging catalog/users/web/root skip this reusable (#1076 doorbell;
   #1074 infra job). Production catalog still runs `pulumi up` in this reusable
   (SAFE-1 freeze). Production Worker publish still uses Wrangler.
5. the web, users, and root staging deploys complete in the same promotion stage.
6. `post-staging` runs the API post-deploy suite against staging, including the **migration
   ledger-head smoke** (#1052 AC5): it reads the migrator's read-only `/ledger-head` endpoint and
   fails unless the applied head equals the expected committed head (schema-before-app proven
   post-deploy).

**#1052 AC7 - real staging deploy with a schema change lands green, CI-run post-merge**: merging a
PR that contains (a) a new `migrations/neon/*.sql` + rehashed `atlas.sum` and (b) the code that
consumes it is the CI-run verification that a real staging deploy with a schema change lands
green end-to-end: on the post-merge push to `main`, `ci.yml` deploys the migrator, the OIDC
trigger applies the new chain head, every component deploy runs `run_atlas: false` against the
new schema, and `post-staging` re-asserts the ledger head equals the target. The required
`Quality / invariants` lane and the `migration-boundary` contract guard run on the PR before the
merge; the deploy + smoke run on the merge. A red staging deploy or smoke is CI visible and
blocks promotion.
7. `deploy-prod` and the other production component jobs deploy catalog, web, users, and root with
   `environment: production`; `pulumi_stack: prod` remains catalog-only. The GitHub
   `production` environment is the human approval gate.
8. `post-prod` runs the production smoke post-deploy suite.

### Manual production path (`.github/workflows/deploy.yml`)

`deploy.yml` is `workflow_dispatch` only. Its `Deploy to Production` job also uses
`environment: production`, so it requires the same GitHub environment approval before the job runs.
Its current order is:

1. install workspace dependencies (`pnpm install --frozen-lockfile`); there is no app build
   step — the root Worker ships as TypeScript source
2. deploy the catalog Worker first, because the root Worker service binding depends on it
3. deploy the users Worker before the root Worker, because the root `USERS` binding depends on it
4. verify `Dockerfile` exists
5. deploy the root Worker/container with Wrangler

The manual path runs the same `reusable-deploy-component.yml` as the CI promotion, so it applies
`migrations/neon/` (when `NEON_DATABASE_URL` is set) exactly like the CI path — it is not a
migration-free path. The Supabase compatibility directory (`supabase/`) is **archived/historical
(issue #1000)** and never applied by either path; an explicitly approved auth migration would follow
the separate Supabase owner/runbook and must not be used to change Neon catalog or user tables.

Do not use version tags as a deploy trigger for the current pipeline.

**CF Worker routing** (`workers/edge/src/app.ts`):
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

The edge's layered rate-limit rollback procedure (native vs durable tiers, and
the rate-policy decision table) is `docs/ops/rate-limit-rollback.md`; it belongs
next to any `/v1/*`-rate-limiting incident run.

## AI Gateway Insertion Path

If AI Gateway is enabled later, it belongs between the container and the upstream model provider.
It does not belong in the browser and does not belong in the Worker.

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional container-only env

Important: this is a documentation target only right now. Before enabling it, the backend planner client must support provider base-URL override through env rather than assuming the provider default.

## Rollback

Every `reusable-deploy-component.yml` deploy step is a plain `wrangler deploy` (not `wrangler versions
upload`), but Cloudflare still records each one as a numbered **version** under the hood, so
`wrangler rollback` and `wrangler versions list` work against it without any change to the deploy
step itself. This is the instant-rollback side of the same versions primitive used by deployment.

### CI one-command path (rollback.yml)

SAFE-1 removed the caller-supplied `version_id` input: rollback eligibility now resolves from the
pinned release manifest, and every component is rollback-ineligible until an owner-approved manifest
revision marks a component/version pair eligible. Running the workflow today fails closed before any
Wrangler command:

`gh workflow run rollback.yml -f component=<name>`

The workflow waits on the `production` environment approval and shares the prod deploy concurrency
groups, so it cannot race a deploy. The per-component table below remains the reference for what
each rollback does and its caveats.

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
| web | `apps/web` | `pnpm --filter web exec wrangler versions list --env <staging\|production>` | `pnpm --filter web exec wrangler rollback <version-id> --env <staging\|production> -y -m "<reason>"` |

`wrangler rollback` with no version id rolls back to the version immediately before the current
one; pass an explicit id from the `versions list` output to jump further back. This only swaps the
running Worker code version — it does not touch bindings/secrets changed since that version, and it
does not re-run Pulumi.

**⚠️ root is the least certain of the four to roll back cleanly.** Unlike catalog/users/web, root
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
   automated post-rollback check to lean on instead: `reusable-post-deploy-test.yml`'s `api`/`e2e`/`smoke`
   suites are still TODO no-ops (tracked separately; PR #493 is turning them into real assertions).
   It does have a `workflow_dispatch` trigger now so it *can* be re-run manually from the Actions UI
   during an incident, but until those suites land, re-running it confirms nothing beyond "the job
   didn't crash" — don't treat a green re-run as verification yet.
5. Still revert the offending commit on `main` afterward — the rollback above is a stopgap for the
   live Worker, not a fix for the tree; the next `main` push will otherwise redeploy the bad code on
   top of your rollback.

### Pulumi rollback

Staging's `reusable-deploy-infra.yml` "Pulumi stack export (rollback backup)" step (and production
catalog's matching step in `reusable-deploy-component.yml`) runs `pulumi stack export`
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

Staging catalog/users/web/root pass `run_pulumi: false`; the staging main-stack apply lives in
`deploy-infra-staging`. Production catalog still runs Pulumi in `reusable-deploy-component.yml`
(SAFE-1 freeze) — look there for the production backup.

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

Nothing above undoes an Atlas migration (`migrations/neon`) or a Supabase migration. `wrangler
rollback` only swaps Worker code; it cannot un-apply a schema change the new code already wrote
data under. Roll a schema change back only by writing and applying a new forward migration that
reverses it (expand/contract, per the schema change policy above) — never by trying to "undo" the
old migration file. Treat any release that combined a schema change with app code as a case where
Worker rollback alone is insufficient; check `migrations/neon` for what shipped in that release before
declaring the rollback complete.

**Neon data-plane recovery (PITR, RPO/RTO, failed-migrate checklist, bad-migration stub):** see
[`neon-backup-rpo.md`](./neon-backup-rpo.md). Worker/Pulumi steps on this page do not replace Neon
history-window restore or the owner HITL monitor checklist.

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
it. (`reusable-post-deploy-test.yml` did gain a `workflow_dispatch` trigger in this same change — tracked
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
- `/healthz`'s `git_branch`/`git_commit` are real in deployed containers via the CI bake chain:
  `reusable-deploy-component.yml`'s "Bake git build info" step writes
  `apps/agent/src/animichi/build_info.py` (gitignored, regenerated per deploy) from
  `GITHUB_SHA`/`GITHUB_REF_NAME`; the image's `COPY apps/agent/src/animichi` ships it and
  `apps/agent/src/animichi/interfaces/routes/health.py` imports it at startup (fallback: env vars →
  git shell-out → `"unknown"`). The container never carries `.git`, so `"unknown"` in a deployed
  environment means the bake chain broke — and since #494's gate fix,
  `.github/scripts/post-deploy-assert.sh healthz` **hard-fails the deploy** on `"unknown"` and, when
  `EXPECTED_GIT_COMMIT` is passed (both CI smoke sites), asserts `git_commit` equals the deploy run's
  own SHA. Live-verified 2026-08-05 (staging returned the deployed SHA; production's last deploy
  predates the bake fix, so prod still reports `"unknown"` until its next deploy).

## HISTORICAL (pre-2026-07): feat/ssr-cloudflare Post-deploy Notes

This section records the old feat/ssr-cloudflare merge runbook. It is not the current deployment
trigger or an executable migration procedure. **Historical only; no longer current.** The current
Neon migration authority is `migrations/neon/` applied by pinned Atlas before the Worker rollout;
use [`migrations.md`](./migrations.md) and the workflow paths above instead.

After the old feat/ssr-cloudflare merge, operators used these checks:

1. **Historical Supabase schema event (not a current apply)** — the old Supabase CLI path recorded
   these legacy schema files:
   - `20260509200000_fix_wrong_bangumi_ids.sql` — delete wrong seed IDs
   - `20260510170000_add_bangumi_platform.sql` — add platform column
   - `20260510180000_add_points_city.sql` — add city column to points

2. **Backfill city for existing points** — one-time, run after migrations:
   ```bash
   AGENT_SVC_DATABASE_URL=<production_dsn> uv run python -m backend.scripts.backfill_city
   ```
   This reverse-geocodes all points with `city IS NULL` using GeoNames data (~12MB).
   Expected: ~1000+ points across ~50 cities. Takes <30 seconds.

3. **Verify** — check a few bangumi:
   ```sql
   SELECT city, count(*) FROM points GROUP BY city ORDER BY count DESC LIMIT 10;
   ```

## Neon topology

See [neon-env-topology.md](./neon-env-topology.md) (N3 / #859).
