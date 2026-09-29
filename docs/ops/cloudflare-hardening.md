# Cloudflare Hardening Runbook

## Scope

This runbook captures Cloudflare dashboard changes that are intentionally not stored in Git:

- `/v1/*` WAF and rate-limit controls
- coarse prompt-injection edge filtering
- rollback procedure for over-blocking rules
- BYOK egress red lines (#1248)
- the future AI Gateway insertion point

For the full deployment topology, auth flow, and env-var boundaries see `deployment.md` in this directory.

## Request Flow

```text
Browser / API client
  │
  ▼
Cloudflare Edge (Worker: workers/edge/src/entry.ts)
  ├─ page HTML ──────────────────────────────────▶ apps/web Worker (TanStack Start; not this Worker)
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy → Anitabi CDN (cached)
  ├─ /tiles/* ───────────────────────────────────▶ private R2 tile proxy
  ├─ /healthz ───────────────────────────────────▶ Worker readiness answer (no auth, no binding)
  ├─ /v1/users/* ────────────────────────────────▶ USERS service binding
  └─ /v1/* ── authenticate ── strip Authorization
       │        inject X-User-Id, X-User-Type
       ▼
     native `AgentSession` Durable Object (in this Worker)
       ├─ Neon Postgres (`AGENT_SVC_DATABASE_URL`)
       ├─ catalog.internal (private) ─────────────▶ CATALOG service binding
       │    (no public /catalog/* browser route)
       └─ MiMo model provider (`MIMO_API_KEY`) — the chat turn
```

## Auth Flow

The only bearer credential type is a human JWT, validated at the Worker edge:

| Credential | Format | Validation |
|---|---|---|
| Human JWT | `Bearer <neon_auth_jwt>` | `authenticate()` verifies the signature locally against the branch's Neon Auth JWKS (EdDSA via jose `createRemoteJWKSet`), checking issuer/audience/exp — no round-trip to the auth origin. AUTH-2 #950 hard cut: `NEON_AUTH_JWKS_URL` is the edge's ONLY identity source; the Supabase verifier and the dual-issuer flag are deleted. |

The `sk_*` API-key credential and the `api_keys` table are deleted (AUTH-1 #945): an `sk_*`
Bearer token is rejected as invalid, never mapped to an "agent" identity. Anonymous access uses a
worker-minted cookie identity, not a credential.

On success the Worker sets `X-User-Id` and `X-User-Type` and deletes the `Authorization` header;
the native agent tier never sees raw bearer tokens. `/v1/users/*` likewise gets `Authorization`
stripped and the verified identity forwarded as `X-User-Id`/`X-User-Type` (AUTH-2 #950) — the users
Worker trusts only that header.

## Env Var Boundary

| Variable | Boundary | Notes |
|---|---|---|
| `NEON_AUTH_JWKS_URL` | Worker-only | Branch JWKS — the edge's ONLY identity source (AUTH-2 #950). issuer/audience are derived from it in `workers/edge/src/identity/auth.ts`; production is unset (fails closed) until its Neon Auth branch is provisioned |
| `AGENT_SVC_DATABASE_URL` | Worker-only (Secrets Store) | `agent_svc` role Neon DSN for the native agent tier |
| `MIMO_API_KEY` | Worker-only (Secrets Store) | Primary `mimo-v2.6-flash` provider credential |
| `TURNSTILE_SECRET` · `ANON_ID_SECRET` | Worker-only (Secrets Store) | Anonymous-access gate and anonymous-cookie seed |
| `VITE_*` (web build) | `apps/web` build-time only | Injected by CI into the web Worker; not edge-Worker secrets |
| `VITE_NEON_AUTH_BASE_URL` | `apps/web` build-time only | Better Auth client origin (login UI + JWT exchange) |

The full binding and var surface is `workers/edge/wrangler.toml` per environment, typed by
`workers/edge/src/env.ts`.

## Current Trust Boundary

- Browser clients hit `apps/web`; API clients hit the edge Worker hostname
- Worker-only auth secrets stay at the edge: `NEON_AUTH_JWKS_URL`; the edge JWT path verifies against the branch's public JWKS, so no Supabase/anon key is involved
- Every edge binding is declared per environment in `workers/edge/wrangler.toml` and resolved through `workers/edge/src/env.ts`
- Agent auth trust starts from `X-User-Id` and `X-User-Type`, not from raw bearer tokens

## 1. `/v1/*` Rate Limit Rule

Cloudflare dashboard path:

- Security → WAF → Rate limiting rules

Recommended rule:

- Expression: `http.host eq "seichijunrei.zhenjia.org" and starts_with(http.request.uri.path, "/v1/")`
- Counting characteristic: source IP
- Threshold: `60` requests
- Period: `1 minute`
- Action: `Block`
- Response: `429` if the zone plan exposes custom response options; otherwise keep Cloudflare default block handling

Notes:

- leave `/healthz` outside this rule
- do not include static asset paths
- if trusted internal automation needs higher throughput later, add a narrowly-scoped bypass instead of loosening the global rule

## 2. Prompt-Injection Coarse Filter

Cloudflare dashboard path:

- Security → WAF → Custom rules

Goal:

- block obviously hostile prompt text before it reaches Worker logs or model-provider spend
- keep this filter coarse and reversible

Suggested phrases:

- `ignore previous instructions`
- `system prompt`
- `output your prompt`
- `pretend you are`

Safer baseline expression when only URI/query inspection is available:

```text
http.host eq "seichijunrei.zhenjia.org"
and starts_with(http.request.uri.path, "/v1/")
and (
  lower(http.request.uri.query) contains "ignore previous instructions"
  or lower(http.request.uri.query) contains "system prompt"
  or lower(http.request.uri.query) contains "output your prompt"
  or lower(http.request.uri.query) contains "pretend you are"
)
```

Operational guidance:

- start with `Managed Challenge` if you are unsure about false positives
- switch to `Block` only after observing clean hits
- if your Cloudflare plan supports request-body inspection for custom WAF rules, extend the same phrase list there
- if body inspection is unavailable, keep this query/header-only rather than reimplementing ad-hoc content filtering in the Worker
- this is only a coarse edge filter; application-level prompt guardrails still remain required

## 3. AI Gateway Insertion Point

If AI Gateway is enabled later:

- place it between the edge Worker's model calls and the upstream model provider (MiMo)
- do not place it in the browser

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional edge Worker var

Before enabling it, the native model composition (`workers/edge/src/agent/host/native-models.ts`)
must support a provider base-URL override through configuration. Until that exists, keep AI Gateway
disabled and treat this section as a forward path only.

## 4. Rollback Procedure

If legitimate traffic is blocked:

1. disable the custom prompt-injection rule first
2. keep the `/v1/*` rate-limit rule enabled unless it is the clear source of the incident
3. inspect Worker logs for `401`, `429`, and upstream `5xx` spikes
4. only then reintroduce narrower filters

If the rate limit is too aggressive:

1. raise the threshold above `60 req/min/IP`, or
2. switch action from `Block` to `Managed Challenge`

If an app deploy is at fault instead of WAF:

1. revert and redeploy the app separately
2. leave WAF changes untouched unless they contributed to the incident
3. verify `/healthz`, `/v1/chat`, and static asset delivery independently

## 5. Post-Change Verification

After manual dashboard changes:

- confirm `/healthz` still succeeds without auth
- confirm `/v1/chat` still requires auth and returns `401` when missing credentials
- confirm a valid authenticated `/v1/chat` request completes a native turn
- confirm `apps/web` page routes are unaffected (they are a separate Worker)
- inspect Worker logs for unexpected spikes in blocked traffic or auth failures

## 6. Egress Network Policy (BYOK red lines — #1248)

A caller-supplied BYOK `base_url` is decided at the Worker edge before any provider client is
constructed. `workers/edge/src/agent/byok/byok-headers.ts` runs
`BYOK_EGRESS_POLICY.decide({ provider, baseUrl, key })`
(`workers/edge/src/agent/egress/egress-policy.ts`) and refuses the credential with
`egress_blocked` when the destination fails. Two independent conditions must both hold:

1. **Exact-host allowlist** — `provider-allowlist.ts` enumerates the hosts each provider family may
   be pointed at (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`) and
   refuses this repository's own origins. Exact hosts, never suffixes: a suffix rule is the classic
   way an allowlist stops being one.
2. **Address classification** — `hostAddressOf` (`packages/agent/src/host-address.ts`) refuses
   loopback / private / link-local / CGNAT / metadata / otherwise-unroutable addresses, and refuses
   every bare IP literal (`ip_literal_host`). workerd exposes no resolver, so nothing here resolves
   DNS; the exact-host condition is what makes that safe.

The decision is a pure function of `(provider, baseUrl, key)` with no I/O, clock or bindings, so
every red line is assertable under `node --test` without a network:
`workers/edge/test/byok-egress-policy.test.ts` (the two conditions and each refusal reason) and
`workers/edge/test/byok-egress-addresses.test.ts` (the address classes). A configured credential is
probed over the same policy (`byok-probe.ts`), additionally bounded by a fixed wall-clock deadline
and a 64 KiB response cap.

**Residual (T12 — a later code path that builds its own client).** This policy covers the
credential's own request path, not an arbitrary new one: an outbound call site that constructs its
own client instead of going through this seam is a review-time refusal. Provider credentials must
not reach logs, spans or error bodies — `secret-scrub.ts` is the explicit scrub the host and view
projections run text and payloads through before they reach `console.*` or Logfire.
