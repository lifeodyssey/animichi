# `animichi-spike-pi` — W0 probe Worker (#1244 S1, #1247 S4)

A throwaway Worker that runs one `@earendil-works/pi-agent-core` turn on **deployed** workerd, so
the three S1 acceptance criteria can be measured for real. `wrangler dev` does not count
(the agent TS rewrite spec for #1243, §四).

Nothing under `workers/edge/src/` imports anything from this directory. The probe has no route, no
identity layer and no CD cohort — the owner deploys it by hand and deletes it when W0 closes.

## What it does

| Route | Behaviour |
| --- | --- |
| `GET /healthz` | `{ ok, worker, providers }` — provider readiness as booleans, never key values |
| `POST /turn` | Runs one pi turn for `provider` = `mimo` \| `anthropic` \| `gemini`, streaming SSE |
| `POST /turn/abort` | The same turn, aborted at `abortPoint` = `provider_stream` \| `tool_call` \| `final_frame`, reporting what the abort left behind |
| `POST /turn/long` | **S4.** A deliberately long alarm-hosted turn of N tool steps, each holding `holdMs`, writing `runs` / `run_steps` / `messages` to Neon. Answers SSE and an `x-spike-run-id` header |
| `GET /runs/:id` | **S4.** The run as Neon holds it — status, steps, transcript — plus this Durable Object's tool-call counter and billed wall-clock |

Both turn routes answer `text/event-stream`: one frame per pi agent event, then a final
`event: outcome` frame carrying the run id, the event sequence, the assistant text, the duration,
`abortFired`, `clientGone`, `alarmScheduled`, and the `dangling` / `clean` verdict that the
integration acceptance criterion asks for.

The turn runs **inside the Durable Object's `alarm()` handler**, not inside the caller's fetch — the
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

## Measure

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

### S4 — the Durable Object state machine

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

Individual S1 cases, if you want to spread them out:

```
scripts/spike/pi-s1-measure.sh cold  --url <url>
scripts/spike/pi-s1-measure.sh warm  --url <url>
scripts/spike/pi-s1-measure.sh turn  --url <url> --provider anthropic
scripts/spike/pi-s1-measure.sh abort --url <url> --point tool_call
```

## Tests

`pnpm run test:worker` covers the parts that do not need a deployment: routing and command
validation, provider-key selection, SSE framing, the markdown table, and the three abort break
points driven through the real pi agent loop over a provider double that honours its abort signal
(`workers/edge/test/pi-spike-*.test.ts`). S4's whole recovery matrix runs there too — the
five-minute turn included, because the tool's hold is an injected `sleep` that only moves the test
clock.

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

When W0 closes, delete this directory and `workers/edge/db-test/`, drop the three
`@earendil-works/*` / `typebox` devDependencies from `workers/edge/package.json` if W1 has not
adopted them yet (plus `pg` / `@types/pg`, which only the `db-test` lane uses), and delete the
Worker in Cloudflare. `@neondatabase/serverless` stays — W1's intake needs it.
