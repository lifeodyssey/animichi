# `api-test/` — the agent tier's staging lane (W1-4 #1253, unblocked by W1-7 #1256)

Opt-in, never in CI, never in a deploy unit. Two files, one per question:

- `catalog-api.test.ts` — the catalog has no public door (spec Appendix D).
- `agent-turn.test.ts` — one real turn through the deployed edge actually calls a
  catalog tool, and the turn is readable back by conversation id. This is the
  **(api)** evidence #1253 had to defer.

```sh
CATALOG_API_ORIGIN=https://staging.animichi.com \
AGENT_TURN_BEARER="$(cat ~/.animichi/staging-access-token)" \
pnpm --filter edge-worker run test:catalog-api
```

Both variables fail closed: without `CATALOG_API_ORIGIN` the lane refuses to
guess an origin, and without `AGENT_TURN_BEARER` the turn cases refuse to run.
Run it only after a deploy that carries `AGENT_TURN_ROUTE = "edge"` — against
the container the turn is answered by `apps/agent`, which emits no
`x-session-id` header and the first assertion fails.

## Why the turn is signed in, and the anonymous path is not here

The anonymous door is behind Turnstile, and Turnstile is a challenge a headless
client cannot solve — that is the whole point of it. So this lane presents a
Neon Auth access token (any real staging login; the browser's session token
works, and it is short-lived by design). The ANONYMOUS half of the W1 exit
criterion — "staging 匿名可完整对话；切走再回来拉到完整结果" — is a manual browser
journey instead: `docs/ops/w1-staging-journey.md`.

## Why the catalog procedures still cannot be called directly

They ride the private `CATALOG` **service binding** (spec Appendix D: the
catalog is our own infrastructure, so it is never named by URL). A service
binding exists only as `env.CATALOG` inside a running Worker — there is no
hostname a laptop can send `POST /catalog/resolve` to.

The staging edge confirms it. Its bound routes are `/healthz`, `/img/*`,
`/tiles/*` and `/v1/*` (`infra/topology-staging.test.ts:41-44`); `/catalog/*` is
not among them, so `POST https://staging.animichi.com/catalog/resolve` is
answered by the web Worker's SPA 404, not by the catalog. Measured 2026-09-03.

What changed with #1256 is not that door — it is that the tools now RUN inside a
deployed Worker, so the hop is observable from its far side: the SD-9 frames
name the tool (`tool-input-start` carries `toolName`) and a
`tool-output-available` for the same `toolCallId` is the catalog having
answered. A `tool-output-error` instead means the binding hop failed, which is
exactly the failure this lane exists to catch.

## Running it behind a proxy

The script sets `NODE_USE_ENV_PROXY=1`. Cloudflare's WAF answers a direct
`fetch` from a laptop with a 403 challenge page, which would make the "no public
door" assertion vacuous — every path would be 403. With the proxy honoured the
staging origin answers `/healthz` 200 and every tool procedure exactly 404, so
the assertion is on the web Worker's real "no route here". The flag is inert
when no `HTTP_PROXY`/`HTTPS_PROXY` is set.
