# `animichi-spike-pi` — W0-S1 probe Worker (#1244)

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
- **Resuming a run after the Durable Object is evicted.** That is S4's question. If an instance is
  evicted between `setAlarm(now)` and the alarm firing, the queued run is not resumed; the next
  alarm marks its stored row `lost_to_eviction` so the loss shows up as data rather than as a
  stream that never ends.

## Deploy (owner, by hand)

This repository blocks local deploys from agents (`block-local-deploy`), and the probe is
deliberately outside CD. Run these yourself from the repo root:

1. Provision the four secrets (each command prompts for the value — never pass it on the command line):

   ```
   npx wrangler secret put MIMO_API_KEY      -c workers/edge/spike/pi/wrangler.toml
   npx wrangler secret put ZEN_GO_API_KEY    -c workers/edge/spike/pi/wrangler.toml
   npx wrangler secret put ANTHROPIC_API_KEY -c workers/edge/spike/pi/wrangler.toml
   npx wrangler secret put GEMINI_API_KEY    -c workers/edge/spike/pi/wrangler.toml
   ```

   `MIMO_API_KEY` selects the direct MiMo endpoint; with only `ZEN_GO_API_KEY` present the probe
   falls back to the zen/go gateway. `GET /healthz` tells you which providers came up.

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

Individual cases, if you want to spread them out:

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
(`workers/edge/test/pi-spike-*.test.ts`).

## Teardown

When W0 closes, delete this directory, drop the three `@earendil-works/*` / `typebox`
devDependencies from `workers/edge/package.json` if W1 has not adopted them yet, and delete the
Worker in Cloudflare.
