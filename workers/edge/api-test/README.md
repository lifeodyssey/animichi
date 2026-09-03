# `api-test/` — the catalog tools' staging lane (W1-4, #1253)

Opt-in, never in CI, never in a deploy unit. Run it by hand:

```sh
CATALOG_API_ORIGIN=https://staging.animichi.com pnpm --filter edge-worker run test:catalog-api
```

It fails closed without `CATALOG_API_ORIGIN`, the same way `test:spike-db` fails
closed without its database.

## Why this lane does not call the four tools' catalog procedures

It cannot, from here, and that is the point of the first assertion.

The tools reach the catalog through the private `CATALOG` **service binding**
(spec Appendix D: the catalog is our own infrastructure, so it is never named by
URL). A service binding exists only as `env.CATALOG` inside a running Worker —
there is no hostname a laptop can send `POST /catalog/resolve` to.

The staging edge confirms it. Its bound routes are `/healthz`, `/img/*`,
`/tiles/*` and `/v1/*` (`infra/topology-staging.test.ts:41-44`); `/catalog/*` is
not among them, so `POST https://staging.animichi.com/catalog/resolve` is
answered by the web Worker's SPA 404, not by the catalog. Measured 2026-09-03.

The nearest public read that is catalog-shaped, `GET /v1/search/preview`, is
served by the Python container rather than by this adapter, and on staging it
answered `row_count: 0` for every query tried (`lucky star`, `hyouka`, `K-On`,
`涼宮ハルヒ`, `君の名は`, `らき☆すた`) — so it cannot carry a truthful positive
assertion about catalog data either.

## What a real end-to-end check needs

The four procedures become observable from outside exactly when the tools run
inside a deployed Worker. That is #1256, which routes `/v1/chat` to the
`AgentSession` DO; a turn that calls `resolve_anime` then makes the real hop,
and the run's `run_steps` rows are the evidence. Until then the deployed-Worker
vehicle is the W0-S1 spike (`spike/pi/`), which carries its own `wrangler.toml`
and is deployed by hand — out of scope for this card, which may not deploy.

## Running it behind a proxy

The script sets `NODE_USE_ENV_PROXY=1`. Cloudflare's WAF answers a direct
`fetch` from a laptop with a 403 challenge page, which would make the "no public
door" assertion vacuous — every path would be 403. With the proxy honoured the
staging origin answers `/healthz` 200 and every tool procedure exactly 404, so
the assertion is on the web Worker's real "no route here". The flag is inert
when no `HTTP_PROXY`/`HTTPS_PROXY` is set.
