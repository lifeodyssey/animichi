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
(`docs/superpowers/specs/2026-07-28-284-byok-design.md`, now landed in this tree — see the
Threat Model table there for the full T1–T14 list), whose OQ-5 ruling required a **spike before
implementation**: verify whether the Cloudflare Containers runtime "grants `NET_ADMIN` / can
express an egress policy **at all**" — a kernel-level or platform-level block of RFC1918 +
`169.254.0.0/16` + `100.64.0.0/10` *behind* the application-layer SSRF guard (`egress_guard`,
Task 1 / #458), as a second line of defense against threat **T12** ("application-layer guard
bypassed by a code path that builds its own client"). OQ-5 has two independent clauses; getting
only the first one right is not sufficient to trigger the pre-authorized fallback — see below.

### Spike, clause 1: NET_ADMIN / iptables — CONFIRMED unavailable

Evidence from Cloudflare's own documentation (via the `cloudflare-docs` MCP tool and web search;
no live deploy was performed — deploys stay CI/CD-only per the repo's no-local-deploy rule):

- **Cloudflare Containers FAQ** states explicitly: *"Cloudflare Containers do not support
  iptables manipulation. The `--iptables=false` and `--ip6tables=false` flags prevent Docker from
  attempting to configure network rules, which would otherwise fail."* and *"Containers run
  without root privileges"* (Docker-in-Docker guidance tells users to use `docker:dind-rootless`
  precisely because the outer container has no root).
- The Wrangler `[[containers]]` configuration schema
  (`https://developers.cloudflare.com/workers/wrangler/configuration/#containers`) exposes only
  image/build, placement, rollout, SSH, and `constraints` settings — `image`, `class_name`,
  `instance_type`, `max_instances`, `name`, `image_build_context`, `image_vars`,
  `rollout_active_grace_period`, `rollout_step_percentage`, `ssh`, `authorized_keys`,
  `constraints.regions`, `constraints.jurisdiction`. **No capability, security-context, or
  network-policy field exists** anywhere in that schema.
- This repo's own `wrangler.toml` `[[containers]]` block (`class_name = "RuntimeContainer"`) and
  the `./Dockerfile` are consistent with this: the Dockerfile already runs as a non-root
  `appuser`, matching the platform's documented no-root/no-`NET_ADMIN` posture, not something we
  can loosen from our side.

**This clause holds: NET_ADMIN / iptables-style egress policy is confirmed unavailable on
Cloudflare Containers today.**

### Spike, clause 2 (correction — the first pass of this doc got this wrong): a declarative CIDR denylist IS available, and does not require NET_ADMIN

An earlier version of this section additionally claimed the platform's only egress-shaping
primitive was HTTP(S)-scoped Worker request routing (`outboundByHost`), and concluded from that
that clause 2 of OQ-5 was also unmet. **That conclusion was wrong** and is corrected here after
independent re-verification against `https://developers.cloudflare.com/containers/platform-details/outbound-traffic/`
(checked 2026-07-29) and the `@cloudflare/containers@0.3.7` type definitions actually vendored in
this repo (`node_modules/@cloudflare/containers/dist/lib/container.d.ts` — checked directly, not
inferred from docs prose):

- **`deniedHosts`** is a `Container`-class instance property (same class `RuntimeContainer`
  already extends) that accepts **hostnames, hostname globs, and IP CIDR ranges** — the official
  example is literally `deniedHosts = ["some-nefarious-website.com", "141.101.64.0/18"]`.
- Per the vendored type declaration's own doc comment: *"Denied hosts are blocked unconditionally,
  even when `enableInternet` is `true` or a catch-all outbound handler is set"* — i.e. this is
  enforced **before** any outbound handler runs, unconditionally, and does **not** require
  `enableInternet: false` (which would additionally restrict egress to ports 80/443 + DNS and
  break the direct `asyncpg` Postgres hop — confirmed as a real constraint, which is why the
  `deniedHosts`-only variant, not the `enableInternet: false` variant, is the one implemented
  below).
- `allowedHosts` is separately documented as *"a deny-by-default allowlist"* when set — i.e.
  default-deny-then-allow is expressible on this platform; we are not using `allowedHosts` here
  (an allowlist would need to enumerate every legitimate provider hostname and would be a much
  larger, riskier change than a denylist of well-known non-routable ranges), but its existence is
  further confirmation that clause 2 of OQ-5 is met.

**Corrected conclusion: OQ-5's clause 2 is met. The platform can express an egress policy (a
declarative, platform-enforced CIDR denylist) without NET_ADMIN. The pre-authorized fallback
("document that the application layer is the sole control") does *not* trigger, because its own
precondition — the platform cannot express an egress policy at all — is false. Task 7 ships as
an actual implemented policy, not a documented-acceptance closure.**

### What is implemented

`RuntimeContainer.deniedHosts` (`worker/entry.ts`) is set from `DENIED_EGRESS_CIDRS`
(`worker/containerEnv.ts`, split out for the same Node-import-chain reason as
`buildContainerEnvVars` — see that file's header comment):

```ts
export const DENIED_EGRESS_CIDRS = [
  "10.0.0.0/8",       // RFC1918
  "172.16.0.0/12",    // RFC1918
  "192.168.0.0/16",   // RFC1918
  "169.254.0.0/16",   // link-local (AWS/Azure/GCP IMDS)
  "100.64.0.0/10",    // CGNAT (Alibaba/Tencent metadata)
];
```

Pinned by `worker/containerEnv.test.ts` (run via `pnpm run test:worker`), which asserts both the
exact CIDR list and that it covers every address the spec's Task 7 AC error-path names
(`169.254.169.254`, `100.100.100.200`, `10.0.0.1`) while not covering a public address
(`1.1.1.1`).

### Scope and an honest limit: HTTP is covered today; HTTPS interception is a deferred, evaluated cost

Per the same vendored type declaration, `deniedHosts` filtering is applied as part of the
Container runtime's outbound-HTTP interception, which is unconditional for **plain HTTP**. HTTPS
traffic is only decrypted/inspected for filtering when `interceptHttps: true` is additionally set
(`applyOutboundInterception`'s doc comment: *"When `interceptHttps` is enabled, also applies
HTTPS interception"*). We evaluated turning this on and **did not**, for one concrete, evidenced
reason: `interceptHttps` MITMs all outbound HTTPS with an ephemeral per-instance CA
(`/etc/cloudflare/certs/cloudflare-containers-ca.crt`), which the container's Python process must
be configured to trust (Python's `httpx`/`certifi` bundle does not trust arbitrary system CAs by
default). Flipping this on without first wiring that trust — and verifying it in a real deploy,
which this task cannot do — would silently break **every** production HTTPS call (MiMo, the
DeepSeek fallback, any BYOK provider), not just close a gap. That is a materially worse failure
mode than the gap it would close, given:

- the exact AC error-path scenario in the spec uses `http://169.254.169.254/` (plain HTTP) — the
  shipped `deniedHosts` list already blocks this, and real cloud-metadata IMDS endpoints
  (AWS/Azure/GCP `169.254.169.254`, Alibaba/Tencent `100.100.100.200`) are HTTP-only in practice,
  so the highest-value SSRF targets are covered without `interceptHttps`;
- the residual gap is an HTTPS request to a private/link-local/CGNAT IP specifically — a narrower
  bypass than the one this section closes, and one still caught by the application-layer guard
  (`egress_guard`/`GuardedAsyncTransport`) for the BYOK path specifically.

**Follow-up, not required for Task 7's closure:** turning on `interceptHttps` needs its own
spec'd rollout (Python CA-trust wiring + a staging verification pass), tracked as a Task 7
follow-up rather than bundled into this docs/config PR.

### AC disposition

The spec's three Task 7 ACs, checked against what is actually shipped here (config + unit test,
not a live-container integration test — this task cannot deploy, so the following is what is
verified today vs. what still needs a manual staging check before being marked fully closed):

- **Happy path** (public egress succeeds): satisfied by design — `DENIED_EGRESS_CIDRS` contains
  no public ranges; pinned by the `1.1.1.1`-not-covered assertion in
  `worker/containerEnv.test.ts`. Not yet verified against a live deployed instance.
- **Null/empty** (catalog `outboundByHost` hop + the MiMo provider call still succeed):
  satisfied by design — the catalog hop is a private-hostname binding interception, a different
  code path from `deniedHosts` entirely; the MiMo provider's public hostname resolves outside all
  five denied CIDRs. Not yet verified against a live deployed instance.
- **Error path** (`169.254.169.254`, `100.100.100.200`, `10.0.0.1` refused at the network layer):
  satisfied **for plain HTTP**, matching the spec's own literal AC wording
  (`http://169.254.169.254/`); pinned by `worker/containerEnv.test.ts`. **Not** yet satisfied for
  HTTPS to the same addresses — see the `interceptHttps` limit above.

A live-container verification pass (confirming the above against a real deployed instance, and
confirming the HTTPS gap is as scoped) is recorded as a required follow-up, not fabricated as
done here.

### Defense-in-depth control inventory (what enforces this, end to end)

1. **`RuntimeContainer.deniedHosts`** (this section) — the container-runtime-level CIDR denylist
   described above; the actual Task 7 deliverable.
2. **`egress_guard.validate_base_url()`** (`apps/agent/agent/infrastructure/egress_guard.py`,
   Task 1 / #458) — SSRF pre-flight check run against any user-supplied BYOK `base_url` before a
   model client is constructed; rejects private/link-local/CGNAT/reserved targets (dual-condition
   `is_global` + deny-flag check, T3/T6) with a `400` before any socket is opened.
3. **`GuardedAsyncTransport` / `build_guarded_async_client`**
   (`apps/agent/agent/infrastructure/egress_transport.py`, Task 1) — the only sanctioned way to
   build a BYOK-path HTTP client (all three provider families — OpenAI-compatible, Anthropic,
   Gemini — route through it via `agents/byok_models.py`, #477). It:
   - re-validates at connect time and **pins the socket to the validated IP with a rewritten
     `Host` header** (`_rewrite_for_pinned_endpoint`), closing the DNS-rebinding/TOCTOU window
     (**T4**);
   - **refuses every 3xx response** (`EgressBlockReason.REDIRECT_REFUSED`), closing the
     redirect-based bypass (**T5**);
   - is constructed with **`trust_env=False`** and no `mounts`/proxy, closing **T13** (a proxy env
     var silently defeating IP pinning);
   - **opts itself out of global Logfire/OTel httpx instrumentation**
     (`_exclude_from_httpx_instrumentation`, Task 2 / #474) so the credential-stripping middleware
     is not bypassed by an auto-instrumented span on this specific transport.
4. **`X-BYOK-*` deny-capture** (Task 2 / #474) — credential headers never reach logs/spans/
   exception payloads, so a bypass cannot be bootstrapped from leaked telemetry.
5. **Task 9 authenticated-path rate limiting** (#451) at the Worker — bounds the blast radius of any
   single identity hammering an egress target, independent of whether that target is blocked. This
   bound is currently scoped to **server-key traffic**; BYOK-specific quota-exemption semantics
   land in Task 4/5 (`feat/284-t45-exemption-probe`, unmerged at the time of writing) and will
   change this bound once merged — re-check this item then.

Production today is **MiMo-only** (the DeepSeek fallback is provisioned but disabled) — "the MiMo
provider call" above, not "two live provider hops"; re-word this bullet if/when DeepSeek is
re-enabled.

### Residual risk (T12), and the AGENTS.md convention that backs it

**T12** — "a future contributor adds a code path that builds its own HTTP client, bypassing the
guarded factory" — is now **partially** mitigated at runtime, not solely by code review: a raw
socket/`httpx` client making a **plain-HTTP** connection to a denied CIDR is blocked by
`RuntimeContainer.deniedHosts` regardless of which Python code path constructed it. For an
**HTTPS** connection to the same ranges, the only backstop today is the guarded-factory
convention plus code review — `apps/agent/AGENTS.md`'s HTTP conventions section states this
explicitly (previously it said the opposite: "leave `trust_env` at httpx's default (`True`)",
without carving out the BYOK/egress-guarded path, which would have told a future contributor to
recreate the exact T13 bypass this section closes — that has been corrected). Owner: whoever
lands new outbound HTTP call sites in `apps/agent/agent/` must construct clients via
`egress_transport.build_guarded_async_client`; PR review is the enforcement point for the HTTPS
residual.

### Process-level socket guard — evaluated, not implemented

The spec's fallback explicitly allows an *optional* process-level guard (e.g., a Python `socket`
patch that inspects the destination of every outbound `connect()` and rejects RFC1918/link-local/
CGNAT targets before the OS attempts the connection) as a cheaper stand-in for a kernel policy.
Now that `deniedHosts` closes the plain-HTTP case at the platform layer, the remaining case such a
guard would add is the HTTPS-to-private-IP gap above. This was evaluated and **not implemented**,
for two concrete reasons (a third reason from an earlier draft of this section — that Task 1/3
were still unmerged — no longer holds: #458, #474, and #477 are all merged; the two reasons below
stand on their own regardless):

1. **Blast radius vs. benefit.** A global monkeypatch of `socket.socket.connect`/`connect_ex`
   affects every outbound connection the process makes — Postgres (`asyncpg`), the catalog
   binding hop, the MiMo provider call, and any future dependency — not just the BYOK path. The
   marginal benefit over `deniedHosts` (platform layer, HTTP) plus the guarded-factory convention
   (application layer, HTTPS, code-review-enforced) is closing one narrow HTTPS-to-private-IP
   bypass scenario, while the downside of a global socket patch misbehaving is an outage across
   every network call the container makes.
2. **Two independent guards drift apart.** A process-level socket guard would duplicate
   `egress_guard`'s validation logic (dual-condition IP classification, IPv6-mapped-IPv4 handling,
   `0x`-encoded octets, etc.) in a second implementation. Two guards with subtly different edge-case
   handling is a known SSRF-bypass anti-pattern in its own right — independent of whether the
   guarded factory is merged or not, maintaining one validation implementation instead of two is
   the safer design. The single-guard approach (guard the one factory that builds every client) is
   deliberately the pattern the spec already chose.

If a future engineer wants to revisit this, the correct home for a socket-level guard is inside
`egress_guard` itself as a `socket.getaddrinfo` / custom `httpx` transport hook scoped **only** to
BYOK-constructed clients (not a global patch) — which is what the guarded-client design already
sets up the seam for.

### Upgrade path

Two independent follow-ups, tracked separately from Task 7's closure:

1. **HTTPS coverage of the denylist** — wire Python CA trust for
   `/etc/cloudflare/certs/cloudflare-containers-ca.crt`, set `interceptHttps: true`, verify in a
   real staging deploy that legitimate HTTPS (MiMo) still works before enabling in production.
2. **True kernel-level policy, if Cloudflare ever ships it** — re-check the Wrangler `containers`
   configuration schema changelog
   (`https://developers.cloudflare.com/workers/wrangler/configuration/#containers`) and the
   Containers changelog (`https://developers.cloudflare.com/changelog/product/containers/`) for a
   `NET_ADMIN`/capability field; if one ships, it would be additive to (not a replacement for)
   `deniedHosts`, which stays as the primary control either way.

A live-container verification pass (the AC-disposition gaps above) is the immediate next step,
independent of either follow-up.
