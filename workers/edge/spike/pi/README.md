# `animichi-spike-pi` — W0 probe Worker (#1244 S1, #1245 S2, #1247 S4, #1248 S5)

A throwaway Worker that runs `@earendil-works/pi-agent-core` turns on **deployed** workerd, so the
S1, S2, S4 and S5 acceptance criteria can be measured for real. `wrangler dev` does not count
(the agent TS rewrite spec for #1243, §四).

Nothing under `workers/edge/src/` imports anything from this directory. The probe has no route, no
identity layer and no CD cohort — the owner deploys it by hand and deletes it when W0 closes.

## What it does

| Route | Behaviour |
| --- | --- |
| `GET /healthz` | `{ ok, worker, providers, mimoRoutes }` — readiness as booleans, never key values |
| `POST /turn` | Runs one pi turn for `provider` = `mimo` \| `anthropic` \| `gemini`, streaming SSE |
| `POST /turn/abort` | The same turn, aborted at `abortPoint` = `provider_stream` \| `tool_call` \| `final_frame`, reporting what the abort left behind |
| `POST /compat` | **S2.** One measured mimo turn under one compat switch set — JSON in, JSON measurement out |
| `POST /turn/long` | **S4.** A deliberately long alarm-hosted turn of N tool steps, each holding `holdMs`, writing `runs` / `run_steps` / `messages` to Neon. Answers SSE and an `x-spike-run-id` header |
| `GET /runs/:id` | **S4.** The run as Neon holds it — status, steps, transcript — plus this Durable Object's tool-call counter and billed wall-clock |
| `POST /egress` | **S5.** One row of the BYOK red-line matrix: decides `{provider, baseUrl, key}` through `EgressPolicy` and, when allowed, runs a real pi round trip through the guarded fetch |
| `GET /egress/platform` | **S5.** The same address families with no policy in the way — what Cloudflare's own outbound proxy refuses |
| `GET /egress/redirect` | **S5.** The 302 re-validation, against fixed fixtures |

Both turn routes answer `text/event-stream`: one frame per pi agent event, then a final
`event: outcome` frame carrying the run id, the event sequence, the assistant text, the duration,
`abortFired`, `clientGone`, `alarmScheduled`, and the `dangling` / `clean` verdict that the
integration acceptance criterion asks for.

`POST /compat` is the exception to the paragraph below: it is served straight from the Worker's
fetch, because S2 measures the round trip the caller is waiting on rather than a turn's independence
from the connection. Its body is
`{ "route": "direct" | "zen", "compat": { …switches… }, "prompt"?: "…" }` and its response is one
measurement: `toolCallSucceeded`, `answered`, `toolRoundTrip`, `streamingUsage`, `usageTokens`,
`wallMs`, `firstTokenMs` (null when no content delta arrived), `events`, `error`. An unknown or
mistyped switch is a 400; a route whose key is absent is a 503 carrying `mimoRoutes`. A gateway that
rejects the dialect still answers **200** with the provider's error text in `error` — that rejection
is the measurement.

The two turn routes run **inside the Durable Object's `alarm()` handler**, not inside the caller's fetch — the
binding decision in spec §二. The fetch writes the run down, arms `setAlarm(now)` and returns the
SSE body; disconnecting the client sets `clientGone` and does not stop the turn.

## Deliberately out of scope

- **`enable_request_signal`.** The research report's original S1 list asked for an on/off comparison
  of that flag. The spec's §二 decision overtakes it: the turn must survive the caller hanging up,
  so the probe never wants the request signal to reach the agent. What it measures instead is the
  deliberate abort at each break point, plus `clientGone` on the outcome frame for the hang-up case.
- **Resuming a run after the Durable Object is evicted.** That is S4's question, and S4 answers it
  in its own class (below). `PiTurnSession` still behaves as S1 measured it: if an instance is
  evicted between `setAlarm(now)` and the alarm firing, the queued run is not resumed; the next
  alarm marks its stored row `lost_to_eviction` so the loss shows up as data rather than as a
  stream that never ends.

## W0-S4 (#1247) — the Durable Object state machine

A second Durable Object class, `DurableTurnSession`, on its own binding (`PI_DURABLE`) and its own
migration tag. S1's probe is left exactly as its published measurements found it.

The turn it hosts is **scripted, not model-driven**: `POST /turn/long` runs N tool steps with a
configurable hold. S4's question is the state machine (durability, admission, replay, billing), and
a scripted plan is what makes the step indexes the `(run_id, step_index)` idempotency key needs
deterministic across a replay. S1 and S2 own the pi kernel and the provider dialect.

That is also this spike's first finding for W1: with a **live** model, a replayed alarm only lands
on the same step indexes if the assistant's tool-call messages are replayed from the transcript
too. Persisting the tool-call turn alongside `run_steps` is therefore a W1 requirement, not an
optimisation.

What the loop does, per spec §三:

1. `fetch` writes session + user message + `runs(running)` in Neon. The INSERT **is** the admission
   decision: a second turn on a session that already has a running one loses to
   `runs_one_running_per_session` and comes back `409`.
2. `fetch` registers an in-memory SSE subscriber, arms `setAlarm(now)` and returns the stream. The
   subscriber is not persisted; hanging up costs the live frames and nothing else.
3. `alarm` takes the single-writer lease (clamped at `deadline_at` by the DDL's own CHECK), then for
   each step either replays the `run_steps` row that already has a `result`, or runs the tool and
   writes `(run_id, step_index)` **before** continuing.
4. The turn ends by writing the assistant message and moving `runs` to `succeeded`; a tool failure
   moves it to `failed` with a reason and refunds the quota reservation exactly once.

The deadline is a **required request field** with a spike-only floor of six minutes
(`long-turn-command.ts`). There is deliberately no default: production stays at the 100s of spec §二
and nothing in this directory can become that budget.

Fault injection, both request fields:

- `crashBeforePersistStep: N` — throw between "the tool returned" and "the step row is written".
  The alarm dies with an uncaught exception, which is exactly what Cloudflare's alarm contract
  retries with exponential backoff ("at-least-once execution … retried upon failure using
  exponential backoff, starting at two second delays for up to six retries"). The retry must
  replay steps `0..N-1` and re-run only step `N`, so the tool-call counter ends at `toolCalls + 1`
  rather than `2 × toolCalls`.
  The "fire once" marker for that crash is an awaited `storage.put`, which the write-coalescing
  rules say is committed on its own rather than batched with the writes around it. That reading is
  the one thing here only a **deployed** run can confirm: if the marker did not survive the
  exception, the alarm would crash again on every retry and the run would stay `running` — which
  is what the `crash` case in the measurement script would show.
- `failAtStep: N` — the tool itself fails. The run must end `failed` / `tool_failed`, not crash.

## W0-S5 (#1248) — the BYOK / egress red lines

S5 is the only spike whose product is **production code**: `workers/edge/src/agent/egress/` is a
reusable module (`EgressPolicy`, `ProviderAllowlist`, `GuardedFetch`, `SecretScrub`) that becomes
W2's BYOK core. Nothing under `workers/edge/src/` imports it yet; the spike is its first caller and
the deployed run is how each red line stops being an assertion about our own code and becomes a
measurement.

What the module decides, and why in this order: an empty key is refused **first**, before any
provider client exists, because several provider SDKs silently fall back to an ambient credential
when handed a falsy key (the `GoogleProvider` trap `apps/agent/.../byok_models.py` guards). Then
scheme, userinfo and port; then the host, which must clear **two independent conditions** — it is
one of the provider family's enumerated hosts (exact, never a suffix) *and* it is a name rather
than an address in a loopback / private / link-local / CGNAT / metadata / otherwise-unroutable
range, IPv4 and IPv6 including the IPv4-mapped and NAT64 spellings.

Three limits worth stating plainly:

- **No DNS resolution happens.** workerd exposes no resolver, so unlike
  `apps/agent/.../egress_guard.py` this module cannot classify what a hostname *resolves to*, and
  cannot pin a socket to a validated address. What replaces it is the exact-host allowlist: a
  caller cannot steer egress at an address of their choosing, so a mixed DNS answer or a rebinding
  flip has nothing to steer. That argument is measured rather than asserted from two directions:
  the `dns-resolves-loopback` matrix rows send real public names whose A record is `127.0.0.1`
  (`localtest.me`, `127.0.0.1.nip.io`) and watch the policy refuse them, and the matching
  `platform:` rows send the same names with no policy in the way and record what Cloudflare's own
  resolver-side proxy does with them. What stays **[U]** is narrower than the red line's wording:
  a *mixed* answer (one A record public, one private) and a rebind *between* validation and
  connect both need a nameserver we control, which no test here has. Neither is reachable through
  the allowlist, but neither is measured — report them as unverified, not green.
- **The `google-generative-ai` adapter refuses an injected fetch** — it throws "Custom fetch is not
  supported by the Google Generative AI adapter"
  (`node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js:33`). The guard cannot hang
  on that adapter, so the google family is driven through Google's OpenAI-compatible surface on the
  same host (`/v1beta/openai`). That is a W2 requirement, not an incidental choice.
- **httpbingo.org cannot emit a hostile redirect.** Its `/redirect-to` only redirects within its own
  domain; `https://169.254.169.254/`, `//169.254.169.254/`, `//evil.test/` and `http://10.0.0.1/`
  all answer 403 (checked 2026-09-03). The hostile hops therefore come from a 302 source inside the
  isolate, addressed at a `.invalid` host that can never resolve, while httpbingo supplies the one
  row that must be a real network redirect: the control that proves the guard does follow a
  re-validated 302.

```
scripts/spike/pi-s5-egress.sh all --url https://animichi-spike-pi.<subdomain>.workers.dev
```

`all` runs the decision matrix, the redirect fixtures and the platform probe, then prints the
markdown table for the spec §四 appendix. Individual cases are `matrix`, `redirect`, `platform`;
`format` reprints from `.local/spike/pi-s5/results.txt`.

The BYOK key the allowed rows send is `--key`, and it is **meant to be invalid** — the measurement
is that the provider's 401 comes back scrubbed (`key leaked` must read `false` on every row). Never
pass a live key: nothing here needs one and it would land in your shell history.

Reading the table for the platform-versus-application question the acceptance criterion asks:

- a **deny** row is the application policy. Nothing was sent, so the platform had no opinion to give.
- an **allow** row whose reason cell reads `allowlisted/failed` with a runtime error rather than a
  provider status is the **platform** refusing after the policy allowed — the only shape in which a
  platform block is directly observable through `POST /egress`.
- the `platform:` rows answer the other half directly, with no policy in the way. `blocked` means
  Cloudflare already refuses that address family; `reachable` means the application policy is the
  only thing standing between a BYOK caller and it.

This route needs no secret. It carries no provider key of its own — the credential is the caller's,
which is the whole point of BYOK.

## Deploy (owner, by hand)

This repository blocks local deploys from agents (`block-local-deploy`), and the probe is
deliberately outside CD. Run these yourself from the repo root:

1. Provision the secrets (each command prompts for the value — never pass it on the command line):

   ```
   npx wrangler secret put MIMO_API_KEY      -c workers/edge/spike/pi/wrangler.toml
   npx wrangler secret put ZEN_GO_API_KEY    -c workers/edge/spike/pi/wrangler.toml
   npx wrangler secret put ANTHROPIC_API_KEY -c workers/edge/spike/pi/wrangler.toml
   npx wrangler secret put GEMINI_API_KEY    -c workers/edge/spike/pi/wrangler.toml
   ```

   `MIMO_API_KEY` selects the direct MiMo endpoint; with only `ZEN_GO_API_KEY` present the probe
   falls back to the zen/go gateway. `GET /healthz` tells you which providers came up.

   S4 needs one more, and it is not a provider key:

   ```
   npx wrangler secret put SPIKE_DATABASE_URL -c workers/edge/spike/pi/wrangler.toml
   ```

   It is a Neon connection string, and nothing in the spike is branch-specific: any branch that
   carries the `migrations/neon` chain through `20260902000000_agent_runs.sql` works. Choose it
   with the rows in mind — the spike writes real `runs` / `run_steps` / `messages` rows under
   session ids beginning `s4`, so a throwaway branch is the tidiest target and production is never
   one. `GET /healthz` reports `database` as a boolean, so check that before spending five minutes
   on a turn.

2. Optional pre-flight — bundle and execute the artifact before it ever reaches Cloudflare. This is
   the check pi's own `check:browser-smoke` skips (research report §4.3), and it catches the esbuild
   `.lazy` chunk-init bug locally:

   ```
   pnpm --filter edge-worker exec esbuild workers/edge/spike/pi/src/entry.ts \
     --bundle --format=esm --platform=browser --conditions=workerd,worker,browser \
     --outfile=.local/spike/bundle.js
   node -e 'import("./.local/spike/bundle.js").then(async (m) => console.log((await m.default.fetch(new Request("https://x/healthz"), {})).status))'
   ```

3. Publish it, from the repo root:

   ```
   npx wrangler deploy -c workers/edge/spike/pi/wrangler.toml
   ```

   Note the `*.workers.dev` hostname wrangler prints — that hostname is the `--url` below. The
   first `[[migrations]]` tag creates the `PiTurnSession` Durable Object class on this first
   publish; later publishes reuse it.

## Measure — S1 (#1244)

```
scripts/spike/pi-s1-measure.sh all --url https://animichi-spike-pi.<subdomain>.workers.dev
```

`all` runs, in order: the cold wake-up, the warm wake-up, one real round trip per provider, the
three abort break points, and finally prints the markdown table for the spec §四 appendix. Results
accumulate under `.local/spike/pi-s1/` (`results.txt` plus the captured SSE bodies as evidence);
re-run `format` at any time to reprint the table:

```
scripts/spike/pi-s1-measure.sh format < .local/spike/pi-s1/results.txt
```

**The cold number is only honest after ≥10 minutes of idleness.** The script records its own last
contact and refuses to report a cold read inside that window; it never pings in between, so it
cannot warm the Worker itself. Immediately after the deploy the Worker is cold and no marker exists
yet, so the first `all` produces `idle=unverified` — that row is a real cold read, just one whose
idleness the script cannot prove.

Individual S1 cases, if you want to spread them out:

```sh
scripts/spike/pi-s1-measure.sh cold  --url <url>
scripts/spike/pi-s1-measure.sh warm  --url <url>
scripts/spike/pi-s1-measure.sh turn  --url <url> --provider anthropic
scripts/spike/pi-s1-measure.sh abort --url <url> --point tool_call
```

## Measure — S2 compat switch matrix (#1245)

```sh
scripts/spike/pi-s2-compat.sh --url https://animichi-spike-pi.<subdomain>.workers.dev
```

That runs both routes and prints the markdown table for spec §四:
`| route | switch | value | tool round trip | streaming usage | wall ms | first token ms | note |`.
Needs `jq` and `curl`.

Rows accumulate in `.local/spike/pi-s2/results.txt`, and every row's note ends with
`evidence=run-<stamp>-<pid>/<nnn>-<case>.json` — the response body that row was read from, relative
to that same directory. Each invocation writes into its own `run-…/` directory, so re-measuring a
case adds evidence beside the earlier row instead of overwriting what the earlier row points at.

Per route it runs the all-defaults case (pi's own auto-detection from the baseUrl) and then each of
the nine switches at **both** of its values, one switch at a time — 19 turns. At the S1 mimo
baseline of ~52 s a round trip that is roughly 17 minutes per route, so run it detached:

```sh
nohup scripts/spike/pi-s2-compat.sh --url <url> --route direct > .local/spike/pi-s2-direct.log 2>&1 &
disown
```

The zen route needs `ZEN_GO_API_KEY` on the deployed Worker. Without it the script does **not**
fail: `GET /healthz` is read once up front and the route is recorded as
`| zen | - | - | skipped | skipped | - | - | no key for this route on the deployed Worker |`.
An unreachable Worker, by contrast, aborts the run — a skip must never stand in for a broken URL.

Individual cases, to spread the wall time out or to re-measure one row:

```sh
scripts/spike/pi-s2-compat.sh case --url <url> --route direct
scripts/spike/pi-s2-compat.sh case --url <url> --route direct --switch supportsStrictMode --value false
scripts/spike/pi-s2-compat.sh case --url <url> --route zen --switch maxTokensField --value max_tokens
scripts/spike/pi-s2-compat.sh format < .local/spike/pi-s2/results.txt
```

Which switches, and why those: `spike/pi/src/compat-switch.ts` names the nine and records, with
reasons, every field of `OpenAICompletionsCompat` it deliberately leaves out.

## Measure — S4 (#1247)

```
scripts/spike/pi-s4-durable.sh all --url https://animichi-spike-pi.<subdomain>.workers.dev
```

`all` runs the concurrency rejection, the injected-crash replay and finally the five-minute turn
(last, because it takes five minutes), then prints the markdown table in the same shape S1 uses.
Individual cases are `busy`, `crash` and `long`; `long` accepts `--hold-ms` and `--deadline-ms`.

The `long` case is the S4 hard condition end to end: it opens the turn, hangs up after five seconds
(`curl --max-time`), then polls `GET /runs/:id` until the run is terminal. What to read off the
table: `status` must be `succeeded`, `steps=3`, `tools=3`, and `billedMs` is the number spec §七
wants for the Durable Object billing estimate. For `crash-replay`, `tools` must equal `expected`.

## Tests

`pnpm run test:worker` covers the parts that do not need a deployment: routing and command
validation, provider-key selection, SSE framing, the markdown tables, the three abort break
points driven through the real pi agent loop over a provider double that honours its abort signal,
the `/compat` request surface and its measurement over the same double, and the S2 script driven
against a loopback stub so the matrix it sends is pinned before it costs 17 minutes of real turns
(`workers/edge/test/pi-spike-*.test.ts`). S4's whole recovery matrix runs there too — the
five-minute turn included, because the tool's hold is an injected `sleep` that only moves the test
clock.

S5's red lines are `workers/edge/test/byok-egress-policy.test.ts` (allowlist, key, scheme, port,
userinfo, own infrastructure), `byok-egress-addresses.test.ts` (the IPv4 + IPv6 range matrix, one
test per range with the reason it must carry), `byok-egress-redirect.test.ts` (re-validation over a
fetch double that returns real 302 responses) and `byok-secret-scrub.test.ts`. The spike's own
surface is `pi-spike-egress-surface.test.ts`, which drives a real pi round trip through the guard
over a scripted 401.

`pnpm run test:spike-db` is an opt-in lane that runs `PostgresRunStore` against a **real**
PostgreSQL, so the invariants the unit tests lean on are the database's and not the double's
opinion of them. It fails closed without a database. Spin a disposable one the way the repo's
fresh-schema gate does:

```
cid="$(docker run -d -e POSTGRES_PASSWORD=gate -e POSTGRES_DB=postgres -p 127.0.0.1::5432 \
  animichi-test-postgres:18-3.6-pgvector-0.8.5)"
port="$(docker port "$cid" 5432/tcp | sed 's/.*://')"
docker exec "$cid" psql -U postgres -d postgres -c 'CREATE DATABASE spike TEMPLATE template1'
atlas migrate apply --dir file://migrations/neon --revisions-schema public \
  --url "postgresql://postgres:gate@127.0.0.1:${port}/spike?sslmode=disable"
SPIKE_TEST_DATABASE_URL="postgresql://postgres:gate@127.0.0.1:${port}/spike?sslmode=disable" \
  pnpm --filter edge-worker run test:spike-db
docker rm -f "$cid"
```

(The image is the one `scripts/local-gates/db-fresh-schema.sh` documents; build it with
`docker build -f apps/agent/docker/test-postgres/Dockerfile -t animichi-test-postgres:18-3.6-pgvector-0.8.5 .`)

## Teardown

When W0 closes, delete this directory and `workers/edge/db-test/` — but **not**
`workers/edge/src/agent/egress/`, which is production code S5 built for W2 and which the tests named
above cover independently of the spike. Also drop the three
`@earendil-works/*` / `typebox` devDependencies from `workers/edge/package.json` if W1 has not
adopted them yet (plus `pg` / `@types/pg`, which only the `db-test` lane uses), and delete the
Worker in Cloudflare. `@neondatabase/serverless` stays — W1's intake needs it.
