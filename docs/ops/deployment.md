# Deployment

This is the canonical deployment runbook for the current runtime.
The old root `DEPLOYMENT.md` compatibility pointer was removed in iter6 A6 (#640); this file is the only deployment runbook.

This file covers non-secret runtime config. For what each GitHub secret is, who consumes it,
and rotation impact, see [`secrets.md`](./secrets.md).

## Delivery architecture

There are exactly two automatic delivery entry points:

- `.github/workflows/pr-verification.yml` (`CI`) validates pull requests and merge-queue heads.
- `.github/workflows/cd.yml` (`CD`) deploys only a push to `main`.

There is no tag-triggered or manually dispatched deployment path. The protected branch requires
exactly `PR Verification` and `Security`. The first aggregates every selected CI
gate, `Security` directly aggregates changed-secret scans and affected security tools, and the last
plus native review-thread resolution; the merge gate is documented in [`review-gate.md`](./review-gate.md).

### Affected-only PR CI

`.github/ci/components.json` is the source of truth for component paths, dependencies, CI lanes,
and deploy units. `.github/scripts/change-plan.py` compares a pull request with its merge base,
then expands direct changes through reverse dependencies. A contract change therefore verifies
all consumers, a web change includes browser E2E, and a migration includes its schema consumers.
Only runtime-bearing paths propagate to reverse dependents; a component's tests select that
component's CI lane without fanning out to its consumers.
An unknown or unowned path fails closed to the full component set; merge-queue evaluation is also
fail-closed. Static quality, security, cross-stack, and agent-eval lanes run inside the same `CI`
workflow when selected. `PR Verification` and the direct `Security` context fail unless every
required selected job succeeds. Each component also declares `deploy_excludes`: tests, package
guidance, and component-local reference docs still select CI but cannot trigger a runtime promotion.
Root READMEs are repository-owned static-quality inputs rather than unknown product changes.

### Build once, promote the same artifact

On a `main` push, `CD` evaluates the exact `before..sha` range with the same component graph. Its
`deploy_triggers` selects every release unit for shared delivery controls, only the declared owner
for unit-specific adapters, and no product unit for other repository-only workflow changes. Every
affected unit is built once by `build-release-unit`; its sealed payload includes the source SHA,
manifest, and digest. Staging and production promote those same immutable bytes without rebuilding.

The ordered promotion phases are foundation, migration, services, edge, and web. Empty phases are
skipped without weakening the order. After the full affected cohort reaches staging, one
`production` environment approval releases that same cohort to production in manifest order.

Automated post-deploy smoke is intentionally deferred technical debt because GitHub-hosted runner
traffic is blocked at the Cloudflare boundary. The owner manually smokes staging before approving
production and manually smokes production after promotion. A manual smoke result is operational
evidence, not a synthetic GitHub required check.

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
  by `workers/edge/test/container-env.test.ts`. Until automatic smoke debt is repaid, the owner
  verifies the same denial during the manual staging/production smoke.

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
  via workflow-level branching. Staging promotion and the single production promotion both run
  under their job-level `environment:`, and GitHub environment secrets take precedence over a same-named secret the
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

There is one workflow-backed deploy path: the main-only `CD` workflow. It is not tag-triggered or
manually dispatched.

### Schema change policy

Neon migrations run from `migrations/neon/` before the Worker rollout, but the old container can
still serve traffic while that step is running. A destructive change can therefore briefly break
old code that still reads or writes the removed schema; the `route_anime` release, for example,
dropped `routes.bangumi_id` in the same release that changed the writer. For schema changes where
that overlap matters, use expand/contract: add the replacement first, deploy compatible readers
and writers, then remove the old column in a later release. Today’s infrequent, approval-gated
cadence keeps this window low-risk, but it does not make destructive same-release changes safe by
construction. The full authoring/apply boundary is [`migrations.md`](./migrations.md).

### Migration promotion

The migration release unit contains the committed `migrations/neon/` chain and `atlas.sum`.
Promotion verifies the sealed digest before applying it in the migration phase. Expand/contract
compatibility remains mandatory because schema promotion precedes consumers and Worker rollback
does not reverse an applied migration. For provisioning or recovery checks, follow
[`migrations.md`](./migrations.md) and [`neon-backup-rpo.md`](./neon-backup-rpo.md); do not infer
database state from a green artifact build.

### Main-only affected promotion (`.github/workflows/cd.yml`)

A push to `main` is the only deployment trigger. `change-plan.py` evaluates `before..sha` against
`.github/ci/components.json`, expands reverse dependencies, and `cd-cohort-plan.py` converts the
result to a deduplicated deploy cohort. Unknown paths select the full cohort.

The workflow builds every affected deploy unit once, seals its payload with the source SHA and
SHA-256 digest, and uploads it as `release-<sha>-<unit>`. Staging downloads and verifies those
artifacts, promoting them in this order: foundation, migration, services, edge, web. A failed or
cancelled phase blocks all later phases.

After the complete cohort reaches staging, `promote-production` requests the single GitHub
`production` environment approval. Production downloads the same artifacts and promotes them in
manifest order; it does not check out another revision or rebuild a unit. Empty cohorts end without
a deployment, and there is no manual or tag-triggered alternative.

Automated post-deploy smoke is deferred technical debt. The owner manually validates staging before
approval and production after promotion; do not represent that manual evidence as a CI check.

**CF Worker routing** (`workers/edge/src/app.ts`):
- `/v1/*` and `/healthz` → `CONTAINER` (Durable Object → FastAPI service on port 8080)
- `/v1/users/*` → `USERS` service binding
- `/catalog/public/anime-overview/:id` → allowlisted anonymous catalog read
- `/img/*` → image proxy + cache
- Everything else → JSON `404 not_found` (no asset/page fallback since #537)

### Pulumi state, encryption, and CI identity (#1077)

Both Pulumi projects — `seichijunrei-infra` (`infra/`) and `animichi-neon-secrets`
(`infra/database-access/`) — keep their state and their `secure:` encryption in **Pulumi Cloud**,
organization `lifeodyssey`. `backend.url` in each `Pulumi.yaml` is the source of truth for that.

No long-lived Pulumi access token is stored in GitHub secrets. `stage-foundation` and the
`promote-production` infra step run `pulumi/auth-actions`, which exchanges the job's GitHub OIDC
identity for a short-lived Pulumi Cloud *organization* token and exports it as
`PULUMI_ACCESS_TOKEN` for the rest of that job only. Those two jobs therefore carry
`id-token: write`, and `promote-release-unit.sh` fails closed when that token is absent. Applies are
organization-qualified (`pulumi up --stack lifeodyssey/<stack>`) so a token that defaults elsewhere
cannot land the apply in another organization. `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, and
the two R2 state keys are no longer read anywhere on the delivery lane; the contract that keeps them
out is `.github/scripts/test_cd_infrastructure_safety_contract.rb`.

The Pulumi-plane Cloudflare token and the Neon API key still come from GitHub environment secrets.
Moving them into ESC is #1078.

The pre-apply `pulumi stack export` copied into the R2 state bucket is retired: Pulumi Cloud's own
update history is the rollback record, and it does not require writing a state snapshot into the
bucket that used to hold live state.

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
Deleting the GitHub secrets themselves is #1081, not this step.

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

Rollback is incident recovery, not a second deployment path. `.github/workflows/rollback.yml` is
manually dispatched, requires the `production` environment approval, serializes with production
promotion, and re-promotes one caller-selected sealed artifact from a successful main `CD` run.
Only `edge`, `web`, `catalog`, and `users` are eligible; schema and infrastructure are not. Supply
the prior run's numeric `release_run_id`, exact `source_sha`, and the selected unit manifest's
`artifact_sha256`. The workflow accepts only a successful `push` run of `.github/workflows/cd.yml`
for this repository and `main`, then independently verifies the downloaded manifest and tarball
digest before any production credential reaches the promotion adapter. It never asks Cloudflare to
guess the "previous" version and never rebuilds during recovery.

For `edge`, the immutable release unit is the same-run `agent` + `edge` pair. Rollback downloads and
verifies both artifacts, republishes the exact agent image tar under its deterministic production
tag, and only then promotes the sealed edge bundle that references it. For `web`, `catalog`, and
`users`, only the selected artifact is promoted. The run summary records run ID, source SHA, unit,
and digest without logging payload values.

Release artifacts are retained for 14 days. A missing, duplicate, empty, or expired artifact fails
closed before promotion. Do not reconstruct or rebuild it in the rollback job: land a reviewed
revert/fix on `main`, let `CD` build a new sealed cohort, and use the normal production approval.
After any successful rollback, verify the affected routes manually and revert the bad change on
`main` so the next affected release restores trunk state.

`CD` and `Rollback` share the `affected-cd-main` concurrency group with cancellation disabled. GitHub
keeps the active run intact and retains at most one pending run; a newer pending run supersedes the
older pending run. Do not stack a rollback behind additional main pushes. During an incident, first
reject or cancel any run waiting at production approval and clear an unrelated pending deployment,
then dispatch the rollback; do not approve a competing production promotion.

Worker rollback changes the running Worker version but does not undo Durable Object migrations,
reverse a database migration, or restore Pulumi state. Edge recovery does republish the verified
paired agent image bytes; it does not rebuild them. Use expand/contract migrations so one-version
code rollback remains schema-compatible. For Pulumi, inspect the failed update in Pulumi Cloud's
stack history and roll back from there (`pulumi stack history`, then export the last good
checkpoint and `pulumi stack import` it), followed by a reviewed reconciliation — the pre-apply R2
export is retired (#1077). Never place a state export in a public GitHub artifact.

Automated rollback smoke is part of the same deferred smoke debt as forward promotion. The owner
must manually check health and the affected user journey after recovery.

## Known Limitations

- default session storage is in-memory unless a distributed backend is introduced later
- OpenTelemetry exporters are opt-in and disabled by default
- AI Gateway is documented but not yet wired in backend provider configuration
- Release identity is the sealed artifact manifest's `source_sha` plus `artifact_sha256`; staging
  and production promotion reject a payload whose identity or digest does not match the main-SHA
  cohort. Runtime health metadata is useful diagnosis but is not the artifact authority.

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
