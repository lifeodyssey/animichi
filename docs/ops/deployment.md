# Deployment

This is the canonical deployment runbook for the current runtime.
The root `DEPLOYMENT.md` file remains as a compatibility pointer for older links.

## Edge Topology

```text
Browser
  ├─ static paths ───────────────────────────────▶ Cloudflare ASSETS
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy/cache
  ├─ /healthz ───────────────────────────────────▶ Worker → RuntimeContainer → FastAPI service
  ├─ /catalog/* ─────────────────────────────────▶ Worker → CATALOG service binding → catalog Worker
  │                                                          └─ Postgres/PostGIS via Hyperdrive (`HYPERDRIVE`)
  └─ /v1/* ── auth at Worker edge ───────────────▶ Worker → RuntimeContainer → FastAPI service
                                                            ├─ Supabase Postgres (`SUPABASE_DB_URL`)
                                                            ├─ Anitabi API (`ANITABI_API_URL`)
                                                            ├─ catalog read path (`CATALOG_API_URL` → /catalog/*)
                                                            └─ Gemini provider (`GEMINI_API_KEY`)
```

The hybrid topology runs two Workers. The main `seichijunrei` Worker
(`worker/entry.js`) routes `/catalog/*` to the separate `catalog` Worker
(`catalog/wrangler.toml`) via a wrangler service binding (`env.CATALOG.fetch`).
The Python agent in the container cannot use that JS-only binding, so it reaches
the catalog over the public origin: `CATALOG_API_URL` (forwarded into the
container as a plain var) points at the deployed host, and `CatalogClient` POSTs
to `{CATALOG_API_URL}/catalog/<method>`, which the main Worker forwards to the
catalog Worker. Deploy order: catalog Worker first (so `service = "catalog"`
resolves), then the main Worker.

- `interfaces/fastapi_service.py` exposes `GET /healthz`
- `interfaces/fastapi_service.py` exposes `POST /v1/runtime`
- `interfaces/fastapi_service.py` exposes `POST /v1/runtime/stream` (SSE)
- `interfaces/fastapi_service.py` exposes `POST /v1/feedback`
- `Dockerfile` packages the runtime into a single container image

The deployment target stays intentionally thin. The Worker owns routing and edge auth; the container runs the backend service and stays unaware of raw end-user credentials.

## Trust Boundaries

| Layer | Responsibility | Secrets/config it should see |
|---|---|---|
| Frontend build | Static export only | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Worker edge | Route match, JWT/API-key auth, identity injection | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (+ optional `NEON_AUTH_*`) |
| Container runtime | Backend service, DB, model/provider calls | `SUPABASE_DB_URL`, `GEMINI_API_KEY`, `ANITABI_API_URL`, `CORS_ALLOWED_ORIGIN`, optional observability keys |

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

### Container runtime

Required:

- `SUPABASE_DB_URL`
- provider credentials for the configured model backend (`GEMINI_API_KEY` today)

Common runtime config:

- `ANITABI_API_URL`
- `CORS_ALLOWED_ORIGIN`
- `DEFAULT_AGENT_MODEL`
- `LOG_LEVEL`
- `MAX_RETRIES`
- `TIMEOUT_SECONDS`
- `OBSERVABILITY_SERVICE_NAME`
- `OBSERVABILITY_SERVICE_VERSION`
- `LOGFIRE_TOKEN` (optional — tracing/metrics export to Logfire only when set)
- `GOOGLE_MAPS_API_KEY` (optional)

Session storage:

- the backend currently uses the in-memory session store only

### Frontend build-time env

Required during `frontend` build only:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

These are injected in GitHub Actions during the static export step and are not runtime container secrets.

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
  -e GEMINI_API_KEY \
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
- `/img/*` runs through the Worker image proxy/cache
- everything else goes to `ASSETS` (`frontend/out/`)

## Deploy Sequence

There are two workflow-backed deploy paths. Neither path is tag-triggered.

### Main promotion path (`.github/workflows/ci.yml`)

`ci.yml` runs on pushes to `main` and `develop`, plus pull requests. Deploy jobs are narrower: they
only start when `github.event_name == 'push'` and `github.ref == 'refs/heads/main'`.

On a push to `main`, the current promotion chain is:

1. component CI, worker tests, DB migration dry-run, and security jobs run first. The agnix job is
   warn-only and is intentionally outside the deploy `needs:` chain.
2. `deploy-staging` calls `_deploy-component.yml` with `component: catalog`,
   `environment: staging`, and `pulumi_stack: staging`.
3. `_deploy-component.yml` runs with `environment: ${{ inputs.environment }}`. It checks out the
   repo, runs the shared setup action, applies Atlas migrations when `NEON_DATABASE_URL` is set,
   runs `pulumi up` in `infra/`, deploys `workers/${{ inputs.component }}` with Wrangler, and runs
   the component smoke step.
4. `post-staging` runs the API post-deploy suite against staging.
5. `deploy-prod` calls `_deploy-component.yml` with `environment: production` and
   `pulumi_stack: prod`. The GitHub `production` environment is the human approval gate.
6. `post-prod` runs the production smoke post-deploy suite.

### Manual production path (`.github/workflows/deploy.yml`)

`deploy.yml` is `workflow_dispatch` only. Its `Deploy to Production` job also uses
`environment: production`, so it requires the same GitHub environment approval before the job runs.
Its current order is:

1. build the frontend with `pnpm run build` in `frontend`
2. apply Supabase migrations with `supabase db push`
3. deploy the catalog Worker first, because the root Worker service binding depends on it
4. verify `Dockerfile` exists
5. deploy the root Worker/container with Wrangler

Do not use version tags as a deploy trigger for the current pipeline.

**CF Worker routing** (`worker/worker.js`):
- `/v1/*` and `/healthz` → `CONTAINER` (Durable Object → FastAPI service on port 8080)
- Everything else → `ASSETS` (Next.js static export from `frontend/out/`)

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

App rollback:

1. revert the offending commit on `main`
2. rerun the appropriate workflow-backed production path from the deploy sequence above
3. verify `/healthz`, `/v1/runtime`, and static asset delivery

Worker/container rollback:

1. use Git history as the source of truth for `worker/worker.js`, `wrangler.toml`, and workflow changes
2. redeploy the previous known-good revision
3. treat database rollbacks separately; `wrangler deploy` does not undo Supabase schema changes

WAF rollback:

1. disable the custom prompt-injection rule first
2. keep the `/v1/*` rate limit in place unless it is the source of the incident
3. inspect Worker logs before re-enabling stricter filters

## Known Limitations

- default session storage is in-memory unless a distributed backend is introduced later
- OpenTelemetry exporters are opt-in and disabled by default
- AI Gateway is documented but not yet wired in backend provider configuration

## HISTORICAL (pre-2026-07): feat/ssr-cloudflare Post-deploy Notes

This section records the old feat/ssr-cloudflare merge runbook. It is not the current deployment
trigger; do not tag for current deploys. Use the workflow paths above instead.

After the old feat/ssr-cloudflare merge, operators used these checks:

1. **Apply DB migrations** — Supabase CLI auto-applies on deploy:
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
