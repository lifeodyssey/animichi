# Cloudflare Hardening Runbook

## Scope

This runbook captures Cloudflare dashboard changes that are intentionally not stored in Git:

- `/v1/*` WAF and rate-limit controls
- coarse prompt-injection edge filtering
- rollback procedure for over-blocking rules
- the future AI Gateway insertion point

For the full deployment topology, auth flow, and env-var boundaries see `deployment.md` in this directory.

## Request Flow

```text
Browser / API client
  │
  ▼
Cloudflare Edge (Worker: worker/worker.js)
  ├─ static paths (/, /about, *.js, *.css, …) ──▶ ASSETS binding (frontend/out/)
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy → Anitabi CDN (cached)
  ├─ /healthz ───────────────────────────────────▶ RuntimeContainer (no auth)
  └─ /v1/* ── authenticate ── strip Authorization
       │        inject X-User-Id, X-User-Type
       ▼
     RuntimeContainer (Durable Object → Python FastAPI on port 8080)
       ├─ Supabase Postgres (SUPABASE_DB_URL)
       ├─ Anitabi API (ANITABI_API_URL)
       └─ Gemini model provider (GEMINI_API_KEY)
```

## Auth Flow

Two credential types, both validated at the Worker edge:

| Credential | Format | Validation |
|---|---|---|
| Human JWT | `Bearer <supabase_jwt>` | `authenticate()` verifies the signature locally against the Supabase JWKS (ES256/RS256 via jose `createRemoteJWKSet`), checking issuer/audience/exp — no `/auth/v1/user` round-trip. Flag-gated Neon Auth (EdDSA) issuer is off by default. |
| Agent API key | `Bearer sk_<hex>` | `validateApiKey()` SHA-256 hashes the key, looks up `api_keys` table via Supabase REST with `SUPABASE_SERVICE_ROLE_KEY` |

On success the Worker sets `X-User-Id` and `X-User-Type`, deletes the `Authorization` header, and forwards to the container. The container never sees raw bearer tokens.

## Env Var Boundary

| Variable | Boundary | Notes |
|---|---|---|
| `SUPABASE_URL` | Worker-only | JWKS fetch (`/auth/v1/.well-known/jwks.json`) for local JWT verification + `api_keys` lookup |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker-only | Used for `api_keys` table lookup |
| `NEON_AUTH_ENABLED` / `NEON_AUTH_JWKS_URL` / `NEON_AUTH_ISSUER` | Worker-only (optional) | Dual-issuer readiness — Neon Auth EdDSA JWKS verification; absent or `false` ⇒ Neon path off (default) |
| `SUPABASE_DB_URL` | Container-only | Direct Postgres connection for asyncpg |
| `GEMINI_API_KEY` | Container-only | LLM provider credential |
| `ANITABI_API_URL` | Container-only | Pilgrimage data API |
| `CORS_ALLOWED_ORIGIN` | Container-only | Backend CORS allowlist |
| `GOOGLE_MAPS_API_KEY` | Container-only (optional) | Geocoding |
| `LOGFIRE_TOKEN` | Container-only (optional) | Observability |
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend build-time only | Injected by CI, not a runtime secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend build-time only | Injected by CI, not a runtime secret |

The full container env allowlist is defined in `worker/worker.js` as `CONTAINER_REQUIRED_ENV_KEYS`, `CONTAINER_RUNTIME_ENV_KEYS`, and `CONTAINER_OPTIONAL_ENV_KEYS`.

## Current Trust Boundary

- Browser and API clients talk only to the Worker hostname
- Worker-only auth secrets stay at the edge: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (+ optional `NEON_AUTH_*`); the edge JWT path verifies against the public Supabase JWKS, so no `SUPABASE_ANON_KEY` is needed there
- Container runtime receives only its explicit allowlist from `worker/worker.js`
- Backend auth trust starts from `X-User-Id` and `X-User-Type`, not from raw bearer tokens

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

- place it between the container and Gemini
- do not place it in the browser
- do not place it in the Worker

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional container-only env

Before enabling it, backend model configuration must support provider base-URL override through env. Until that exists, keep AI Gateway disabled and treat this section as a forward path only.

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
3. verify `/healthz`, `/v1/runtime`, and static asset delivery independently

## 5. Post-Change Verification

After manual dashboard changes:

- confirm `/healthz` still succeeds without auth
- confirm `/v1/runtime` still requires auth and returns `401` when missing credentials
- confirm a valid authenticated `/v1/runtime` request still reaches the backend
- confirm static frontend assets remain unaffected
- inspect Worker logs for unexpected spikes in blocked traffic or auth failures

## 6. Egress Network Policy (container-level defense-in-depth — #284 Task 7)

### Threat model reference

This section closes **Task 7** of the BYOK design spec
(`docs/superpowers/specs/2026-07-28-284-byok-design.md`), whose OQ-5 ruling required a **spike
before implementation**: verify whether the Cloudflare Containers runtime grants `NET_ADMIN` /
lets us express a kernel-level egress policy (iptables-style block of RFC1918 + `169.254.0.0/16`
+ `100.64.0.0/10`) *behind* the application-layer SSRF guard (`egress_guard`, Task 1 / #458), as
a second line of defense against threat **T12** in that spec's threat model ("application-layer
guard bypassed by a code path that builds its own client").

### Spike conclusion: NET_ADMIN-style egress policy is NOT available — CONFIRMED, fallback triggers

Evidence gathered 2026-07-29 from Cloudflare's own documentation (via the `cloudflare-docs` MCP
tool and web search; no live deploy was performed — deploys stay CI/CD-only per the repo's
no-local-deploy rule, and a real container-network experiment is out of scope for a docs spike):

- **Cloudflare Containers FAQ** states explicitly: *"Cloudflare Containers do not support
  iptables manipulation. The `--iptables=false` and `--ip6tables=false` flags prevent Docker from
  attempting to configure network rules, which would otherwise fail."* and *"Containers operate
  without root privileges"* (Docker-in-Docker guidance tells users to use `docker:dind-rootless`
  precisely because the outer container has no root). No `NET_ADMIN` (or any Linux capability
  grant) is documented anywhere in the Containers platform docs, the `Container` class reference,
  or the Wrangler `[[containers]]` configuration schema — `instance_type`, `image`, `class_name`,
  `max_instances`, `ssh`, and `authorized_keys` are the only per-container settings that exist
  today (`https://developers.cloudflare.com/workers/wrangler/configuration/#containers`).
- This repo's own `wrangler.toml` `[[containers]]` block (`class_name = "RuntimeContainer"`) and
  the `./Dockerfile` confirm there is no capability/security-context knob to set even if we wanted
  one — the Dockerfile already runs as a non-root `appuser`, which is consistent with the
  platform's documented no-root/no-`NET_ADMIN` posture, not something we can loosen.
- The platform's actual egress-shaping primitive is **Worker-side outbound interception**
  (`static outbound` / `static outboundByHost` on the `Container` class,
  `https://developers.cloudflare.com/containers/container-class/`), which this repo already uses
  for exactly one hop — `RuntimeContainer.outboundByHost["catalog.internal"] → env.CATALOG`
  (see `wrangler.toml` comments). This is a real mechanism, but it is **not** the kernel/NET_ADMIN
  control OQ-5 asked about: it is documented as HTTP(S)-scoped request interception running
  inside the Workers runtime (a request-routing layer), not a network-layer firewall, and today
  it is configured per-hostname (allow-list of one), not as a default-deny-then-allow egress
  policy. Turning it into a comprehensive RFC1918/link-local/CGNAT blocklist for *all* container
  egress would be a materially larger change (a global `outbound` catch-all handler covering every
  destination, including the two live provider hops below) that is out of scope for this spike and
  is called out as a future upgrade path, not a requirement, below.

**Conclusion: the strong prior holds. NET_ADMIN / iptables-style egress policy is confirmed
unavailable on Cloudflare Containers today. The OQ-5 pre-authorized fallback triggers.**

### Fallback: application-layer guard is the sole enforced control

Per the OQ-5 ruling, Task 7 closes as **documented acceptance**, not as a shipped network policy.
The three Task 7 ACs in the spec are satisfied by this documentation, not by a runtime test, and
are not left as skipped/placeholder tests — there is nothing to skip because there is no policy
to test.

**What actually enforces the RFC1918 + `169.254.0.0/16` + `100.64.0.0/10` block today:**

1. **`egress_guard.validate_base_url()`** (Task 1 / #458) — SSRF pre-flight check run against any
   user-supplied BYOK `base_url` before a model client is constructed; rejects private/link-local/
   CGNAT targets with a `400` before any socket is opened.
2. **The guarded `httpx` client factory** (`byok_models.py`, Task 3) — the only sanctioned way to
   build a BYOK-path HTTP client; constructed with `trust_env=False` and no `mounts`/proxy (closes
   **T13** — an `HTTPS_PROXY`/`ALL_PROXY` env var silently defeating IP pinning by routing through
   a re-resolving proxy).
3. **`X-BYOK-*` deny-capture** (Task 2) — credential headers never reach logs/spans/exception
   payloads, so a bypass cannot be bootstrapped from leaked telemetry.
4. **Task 9 authenticated-path rate limiting** at the Worker — bounds the blast radius of any
   single identity hammering an egress target, independent of whether that target is blocked.

**Residual risk (recorded in the threat model, not newly introduced):** **T12** — "a future
contributor adds a code path that builds its own HTTP client, bypassing the guarded factory" — is
only caught today by code review + the guarded-factory convention, not by a second enforcement
layer. This is the direct consequence of the OQ-5 finding: there is no kernel-level backstop on
this platform, so the guarded-factory pattern (single sanctioned construction path) is the actual
mitigation for T12, and it lives entirely in application code review discipline, not runtime
policy. Owner: whoever lands new outbound HTTP call sites in `apps/agent/agent/` must construct
clients via the guarded factory; PR review is the enforcement point.

### Process-level socket guard — evaluated, not implemented

The spec's fallback explicitly allows an *optional* process-level guard (e.g., a Python `socket`
patch that inspects the destination of every outbound `connect()` and rejects RFC1918/link-local/
CGNAT targets before the OS attempts the connection) as a cheaper stand-in for a kernel policy.
This was evaluated and **not implemented**, for three concrete reasons:

1. **Blast radius vs. benefit.** A global monkeypatch of `socket.socket.connect`/`connect_ex`
   affects every outbound connection the process makes — Postgres (`asyncpg`), the catalog
   binding hop, both live model providers, and any future dependency — not just the BYOK path.
   The marginal benefit over the guarded-factory pattern (which already governs every BYOK client
   construction site) is a bypass scenario that is already mitigated by code review (T12), while
   the downside of a global socket patch misbehaving is an outage across every network call the
   container makes, not just BYOK.
2. **Verification is not credible without the exact runtime.** A meaningful test of "does this
   guard block a raw `httpx.AsyncClient().get('http://169.254.169.254/')` from *inside the built
   container image*" requires exercising it in the actual container network namespace — not a
   local pytest process on a developer's machine or CI runner, which have different network
   topology (loopback/link-local addressing differs, and CI sandboxes commonly firewall
   169.254.169.254-class addresses themselves, which would produce a false-positive "pass").
   Standing up that verification is itself a real container deploy, which this task cannot do
   (CI/CD-only deploy rule) — so any socket-guard test we could write today would be testing our
   own mock, not the real bypass scenario, which fails the "no placeholder AC" bar just as much as
   a skipped network test would.
3. **Coupling to an unmerged dependency.** The guarded `httpx` client factory this guard would
   need to coexist with (Task 1 `egress_guard`, Task 3 `byok_models.py`) is still in flight on
   unmerged branches (`feat/284-t1-ssrf-guard`, `feat/284-t3-byok-model`) at the time of this
   spike. Building a second, independent enforcement layer against a moving target risks producing
   two guards with subtly different validation logic (e.g. IPv6-mapped IPv4, `0x`-encoded octets)
   that drift apart over time — a known SSRF-bypass anti-pattern. The single-guard approach (guard
   the one factory that builds every client) is deliberately the pattern already chosen in the
   spec; a second ad hoc guard duplicates it with a different risk surface instead of adding real
   depth.

If a future engineer wants to revisit this, the correct home for a socket-level guard is inside
`egress_guard` itself as a `socket.getaddrinfo` / custom `httpx` transport hook scoped **only** to
BYOK-constructed clients (not a global patch) — which is what Task 1's `trust_env=False`
guarded-client design already sets up the seam for.

### Upgrade path if Cloudflare adds real network-layer egress control

If Cloudflare ships `NET_ADMIN`, a security-context/capabilities field on `[[containers]]`, or a
first-class network-policy primitive for Containers in the future:

1. Re-open this section — check the Wrangler `containers` configuration schema changelog first
   (`https://developers.cloudflare.com/workers/wrangler/configuration/#containers`) and the
   Containers changelog (`https://developers.cloudflare.com/changelog/product/containers/`).
2. Add the capability to `[[containers]]` in `wrangler.toml` and an `iptables`/`nftables` rule (or
   equivalent declarative policy) to the `Dockerfile`/entrypoint blocking RFC1918 +
   `169.254.0.0/16` + `100.64.0.0/10` outbound.
3. Add the integration test the original Task 7 AC called for
   (`apps/agent/agent/tests/integration/test_egress_network_policy.py`): happy path (public egress
   succeeds), null/empty (catalog `outboundByHost` hop + live model provider calls still succeed),
   error path (raw `httpx.AsyncClient().get("http://169.254.169.254/")` still blocked).
4. Downgrade T12's residual-risk note above from "code-review-only" to "code-review + runtime
   backstop."

Until then, this documented-acceptance state is the closed state of Task 7.
