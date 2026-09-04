# `api-test/` — the agent tier's staging lane (W1-4 #1253, unblocked by W1-7 #1256)

Opt-in, never in CI, never in a deploy unit. Three files, one per question:

- `catalog-api.test.ts` — the catalog has no public door (spec Appendix D).
- `agent-turn.test.ts` — one real turn through the deployed edge actually calls a
  catalog tool, and the turn is readable back by conversation id. This is the
  **(api)** evidence #1253 had to defer.
- `web-search-turn.test.ts` — one real turn calls `web_search`, and what came
  back is wrapped in the untrusted preamble (W2-1 #1287). This is the only
  question the unit suite cannot answer: whether Cloudflare's egress reaches
  `html.duckduckgo.com`, and whether that endpoint answers a Worker the way it
  answered the laptop the adapter was measured on. A `tool-output-available`
  whose text starts with the preamble means the hop worked.

  A `Search failed for '<query>': <detail>` sentence means the search did not
  complete, and that is ALL it means on its own — the tool degrades every one of
  its failures into that one sentence rather than throwing. The `<detail>` is
  what tells them apart, and each spelling has a different fix:

  | `<detail>` | what happened | what to do |
  |---|---|---|
  | `egress denied: host_not_allowlisted` (or another `EgressDenyReason`) | our own guard refused the destination — typically a redirect off `html.duckduckgo.com` | read `web-search-egress.ts`; a legitimate new host is a reviewed allowlist edit, never a widened rule |
  | `search backend answered 202` | the anti-bot answer: DuckDuckGo served the Worker a challenge instead of results | the backend refused THIS caller; a keyed API behind the same `WebSearcher` port is the fix |
  | `search backend answered 429` / `5xx` | rate limited or upstream trouble, not a refusal of Workers as such | re-run the lane before concluding anything |
  | `the search timed out` | the 10s budget elapsed | check whether the hop is slow or hung; re-run before concluding |

  Anything else in `<detail>` came from the runtime (a DNS or TLS failure, say),
  which means the request never reached the backend at all. Every one of these
  is also on the server side as a `web_search_failed` entry in Workers Logs,
  with the same text — so a turn nobody was watching can still be diagnosed.

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
