# pi-durable spike: record (phase 1 and phase 2 parts A and B, 2026-11-18 UTC)

Status: the spike in #1999, the first card of `docs/specs/2026-10-04-pi-durable-migration-spec.md` ("spike（第一张卡）").

- **Phase 1** answered question 1 (Workers, the minimum deliverable) by a recorded workerd run, and questions 4 and 5
  at the desk. It also wrote the exact plan for questions 2 and 3.
- **Phase 2, part A** ran everything that needs no Postgres:
  - the choice between routes (b) and (b′);
  - case b0;
  - question 3's container-free cases, plus a seventh, the per-request rebuild of stored web results;
  - the sandbox refusing sockets;
  - the counting method, which part B then validated and used.
- **Part B** ran the Postgres-backed cases against the shared loopback test Postgres, through `pg` and databases of the
  spike's own (`spike_pi_durable_*`, all dropped at the end), with no container started by the writer:
  - b3-alt, the card's literal (b) wake criterion, without Postgres;
  - the counting control, and today's store counted by the coordinator's container lane;
  - route (b′): b1, b′1–b′3, and admission against Pi's commit (C1–C4);
  - route (a): a1–a5; its C1–C4 were not run;
  - question 3's `settlement` and `selection`;
  - the overall verdict, go, and the re-cut migration tickets.

Nothing here is a migration decision. Choosing to migrate and choosing a storage route are the owner's, after the full
report.

Notation: repository files are `path:line` at 6c9fb45b6, except files changed after the spike branched, which are
`path:line` at the named commit. npm packages are `package@version path:line`, the path relative to the installed
package. Evidence files are relative to this directory.

## Record fields

The card's last criterion asks for these fields, so a reviewer can re-run every command.

| Field | Value |
|---|---|
| Baseline pi line on `main` at the start | 0.87.1: `@earendil-works/pi-agent-core`, `pi-ai` and `chord` (`pnpm-workspace.yaml` catalog at 6c9fb45b6). Owner decision, 2026-11-18: start the pi-durable migration directly and skip the 0.99.2 step (#1995), so 0.87.1 is the baseline the migration surface is measured from. |
| `agents` used | 0.33.0, the npm `latest` on 2026-11-18. The edge already declares `^0.33.0` (`workers/edge/package.json`), so the edge needs no `agents` version bump to get `PiHarness`. |
| pi-durable used | 1.5.2, the npm `latest`, with pi-ai, chord, pi-schema and pi-telemetry 1.5.2, which pi-durable pins exactly. |
| Runtime | Build: Wrangler 4.132.0 `deploy --dry-run` (the repository's catalog version and the edge bundle-smoke lane's method). Run: Miniflare 4.20260722.0, which runs workerd 1.20260722.1 (the repository's catalog Miniflare). Compatibility date `2026-07-22` and flags `["nodejs_compat"]`, read from `workers/edge/wrangler.toml:89-91` on every run. Node 24.18.0, pnpm 12.4.2. |
| Spike branch and commit | `spike/pi-durable`, created from origin/main at 6c9fb45b6. Phase 1: 608a77efc. Part A: 1dced1ab0. Part B: _filled when the coordinator commits and pushes_. |
| Prototype lockfile | `prototype/pnpm-lock.yaml`, SHA-256 `1ffb663ac5098eed093eb27f80eb4987fc43063d47f9a73b47cc21237cf104c8` (part B). Part B added one dependency, `pg` 8.23.0 (the root lockfile's version, `pnpm-lock.yaml:9408`; the catalog says `^8.23.0`). The lockfile gained 110 lines and changed none: pg 8.23.0, pg-pool 3.14.0, pg-protocol 1.16.1, pg-cloudflare 1.4.1, pg-connection-string 2.14.1, pg-types 2.2.0, pgpass 1.0.5 and their small dependencies. pg-protocol and pg-cloudflare resolved one patch above the root lockfile's 1.16.0 and 1.4.0. Part A's hash was `4451ccee2b3a388894fd4a7cfc361e806a34e4d2a8f718ff7acbdc69690298ab`, phase 1's `c0a6fed90e136bffd298a76ad30ae085e6dca6cdfe838c461fc65adc7bcc97ed`. Part A added two dev dependencies for the `validation` case: `pi-ai-0871` (`npm:@earendil-works/pi-ai@0.87.1`) and `typebox` 1.3.32 (the repository's catalog version); that lockfile gained 80 lines and changed none. |
| Criteria per route | [Criteria](#criteria) |
| Overall go or no-go | **Go** by the card's rule: questions 1 and 3 go, route (b′) go, questions 4 and 5 answered ([Overall](#overall-go)). Migrating and the route remain the owner's choices. |
| Re-cut migration tickets | Seven tickets for route (b′), sizes included, on one integration branch ([Re-cut migration tickets](#re-cut-migration-tickets)). Per the card, nobody files them before the owner's decision. |

## Criteria

| Question | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | One turn (user message, one `resolve_anime` call against the stubbed catalog, answer) finishes in workerd at the edge's date and flags | **go** | `evidence/q1-turn.json` |
| 1 | Evicted (workerd SIGKILLed) during the tool call with `replay: "safe"`: the tool runs again (the catalog counts two calls), and the lifecycle job finishes the turn from persistent storage | **go** | `evidence/q1-evict-safe.json` |
| 1 | The same with `replay: "unsafe"`: the model receives an interrupted result, the tool does not run again (one call), and the turn finishes | **go** | `evidence/q1-evict-unsafe.json` |
| 1 | The bundle has no Node-only import | **go** | `evidence/q1-bundle.json` |
| 1 | A later compatibility date is needed | **no**: everything ran at 2026-07-22 | all of the above |
| 1 | Way 11: an outbound handler fails any request other than the stubbed catalog | **in place**: the guard refused its negative control and saw nothing else. Separately, in the first step-0 run, Miniflare's Node side tried to fetch its `Request.cf` data and the sandbox refused it (EPERM); `cf: false` in `run/workerd.ts` now prevents the attempt. | `evidence/q1-guard.json` |
| 1, 2 | Way 11 for sockets, which the `fetch` guard cannot see | **the sandbox is the enforcement** (part A): from Node and from workerd, a loopback connect succeeds, and a connect to 192.0.2.1 is refused at once with EPERM (3.8 ms and 6 ms in the recorded run; the checks allow 100 ms and 1 s). The guard saw neither socket. | `evidence/q2-sockets.json` |
| 2 (a) | After each of three crash points, the Neon record equals the projection recomputed from Pi's store; the two-object case passes; statements per turn are no more than today; recovery is no weaker | **Storage: pass**: after a1, a2 and a3 the row equals the projection recomputed from Pi's store, and a4's two objects each read back only their own turn. **Statements: pass**: 3 per turn against today's 199. **Recovery against admission (C1–C4): not run**, so route (a) is not shown to be go. | `evidence/q2-route-a-crash-all.json`, `q2-route-a-isolation.json`, `q2-route-a-count.json` |
| 2 (b) | The conformance suite, the two-object isolation case and `PiHarness`'s wake pass on a Neon backend; statements and recovery as above | **out**. The wake itself is not the obstacle: b3-alt shows `PiHarness`'s lifecycle wake finishing an interrupted turn on a store it did not prepare, in both replay modes. But with such a store its `accepted`, `wait()`, `abort(operationId)` and `sessions.list()` answer from its own empty store (part A; b3-alt again: `wait()` → `not_found`), so (b) as the card words it, `PiHarness` kept and only the storage swapped, has a silently wrong operation API (way 4). | `evidence/q2-route.json`, `q2-b3-alt.json` |
| 2 (b′) | The conformance suite, the two-object isolation case and our own wake pass; statements and recovery as above | **storage: pass**: b1 32 of 32 on the test Postgres, nothing weakened; b′1 isolation passes, with a negative control that collides; b′2 our own wake finishes the interrupted turn, safe and unsafe. **Statements: pass**: a cold one-request turn costs 56 statements on the Pi store against today's 199 for the same shape (b′3, baseline below). **Recovery: pass**: at each of C1–C4 the scan realigns admission, Pi and settlement, with no double charge. **Route (b′): go.** | `evidence/q2-b1-conformance.txt`, `q2-b-prime-isolation.json`, `q2-b-prime-wake.json`, `q2-b-prime-count.json`, `q2-baseline-count.json`, `q2-b-prime-admission.json` |
| 3 | Every semantic difference has a covering layer shown by a prototype; per-tool replay by experiment (`translate_anime_title` neither reruns nor double-bills); two completed turns each charged only their own usage | **go**. Part A's container-free cases: `admission`, `budget`, `stream`, `replay` (no rerun, one reservation, nothing billed for the interrupted call), `validation` (no difference from today), `restart`, and the web-result rebuild. Part B's: `settlement` (two completed turns each charged only their own usage, with a thrown 4xx, an error frame and an interrupted attempt between them; Pi's `usage()` total equals the charges plus the uncharged attempts) and `selection` (no model, the same admission and idempotency, settled for nothing). Each names its covering layer. | [Question 3](#question-3-business-layer), `evidence/q3-settlement.json`, `q3-selection.json` |
| 4 | Release cadence, API surface, experimental parts, cost of following releases | **answered** | [Question 4](#question-4-risk) |
| 5 | Per-package surface with sizes, including the `agents` upgrade; whether two pi-ai versions coexist in one package | **answered** | [Question 5](#question-5-migration-surface) |

## How to re-run

Every run of Node, Wrangler, Miniflare or workerd goes under a macOS sandbox with outbound network denied except
loopback, with proxy variables removed. The profile is six lines, kept as `prototype/no-network.sb` (SHA-256
`2ee51fee1df184abc9b11a53c854022877ab06f7bb9958b8f1f406119b4710b1`):

```text
(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote unix-socket))
(allow network-outbound (remote ip "localhost:*"))
(deny network-outbound (remote ip "localhost:7897"))
```

Phase 1 ran with the same six lines from a machine-local path, `/tmp/catalog-guard-baseline/no-network.sb`. Part A
copied that file byte for byte into the prototype and ran with the copy.

From the repository root:

```sh
cd docs/iterations/pi-durable-spike-2026-10/prototype
# Outside the sandbox: the only step that reaches the npm registry.
pnpm_config_strict_dep_builds=false pnpm install --ignore-workspace --frozen-lockfile
# A function, not a variable: zsh does not split an unquoted variable into words.
sandboxed() { sandbox-exec -f no-network.sb env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy "$@"; }
# Phase 1
sandboxed node run/alarm-probe.ts   > ../evidence/q1-step0-run-output.txt 2>&1   # step 0 (about 3 s)
sandboxed node run/q1.ts            > ../evidence/q1-run-output.txt 2>&1         # 22 checks, exit 0 when all pass (about 70 s)
sandboxed node run/bundle-report.ts > ../evidence/q1-bundle-run-output.txt 2>&1  # the bundle's imports (about 10 s)
# Phase 2, part A (no container, no database)
sandboxed node run/route.ts         > ../evidence/q2-route-run-output.txt 2>&1   # (b) or (b′): 23 checks
sandboxed node --test --test-reporter=spec q2/conformance-control.test.ts > ../evidence/q2-b0-conformance.txt 2>&1  # b0: 32 cases
sandboxed node --test --test-reporter=spec q2/conformance-negative.test.ts > ../evidence/q2-b0-negative.txt 2>&1   # b0's negative control
sandboxed node run/socket.ts        > ../evidence/q2-sockets-run-output.txt 2>&1 # way 11 for sockets
# Question 3. Each workerd run builds first (about 10 s); then replay runs about 31 s and restart about 100 s.
for c in admission budget stream web-results validation replay restart; do
  sandboxed node run/q3.ts --case "$c" > "../evidence/q3-$c-run-output.txt" 2>&1
done
# Phase 2, part B. Postgres is the shared loopback test server; SPIKE_PG_ADMIN_DSN overrides
# postgresql://postgres:test@127.0.0.1:32768/postgres. Every runner creates and drops databases named spike_pi_durable_*.
# A run that counts resets pg_stat_monitor, which is global: run it with no other database suite on the server.
sandboxed node q2/pg-inspect.ts    > ../evidence/q2-pg-inspect-run-output.txt 2>&1     # the counting extension, confirmed
sandboxed node q2/count-control.ts > ../evidence/q2-count-control-run-output.txt 2>&1  # counts: 11 and 11 (counts)
sandboxed node run/b3-alt.ts       > ../evidence/q2-b3-alt-run-output.txt 2>&1         # b3-alt, no database (about 75 s)
sandboxed node --test --test-reporter=spec q2/neon-conformance.db.test.ts > ../evidence/q2-b1-conformance.txt 2>&1  # b1 (under a minute)
for c in count isolation wake; do   # b′3 (counts), b′1, b′2 (about 80 s)
  sandboxed node run/b-prime.ts --case "$c" > "../evidence/q2-b-prime-$c-run-output.txt" 2>&1
done
sandboxed node run/b-prime-admission.ts --crash all > ../evidence/q2-b-prime-admission-run-output.txt 2>&1  # C1–C4 (about 2 min)
sandboxed node run/route-a.ts --crash all      > ../evidence/q2-route-a-crash-all-run-output.txt 2>&1  # a1–a3 (counts at a3; about 2 min)
sandboxed node run/route-a.ts --case isolation > ../evidence/q2-route-a-isolation-run-output.txt 2>&1  # a4
sandboxed node run/route-a.ts --case count     > ../evidence/q2-route-a-count-run-output.txt 2>&1      # a5 (counts)
for c in settlement selection; do   # question 3's two database cases (settlement about 1.5 min)
  sandboxed node run/q3-db.ts --case "$c" > "../evidence/q3-$c-run-output.txt" 2>&1
done
sandboxed node q2/pg-cleanup.ts > ../evidence/q2-pg-cleanup-run-output.txt 2>&1  # last: drop every spike_pi_durable_* database, the counter included
# Today's store, the baseline: a container lane (the host test boots or reuses the server through testcontainers),
# after `pnpm install --frozen-lockfile` at the worktree root. The coordinator ran it with these four variables:
sandboxed DOCKER_HOST=unix://<colima socket> TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock TESTCONTAINERS_RYUK_DISABLED=true \
  WRANGLER_HIDE_BANNER=true node q2/baseline-count.ts > ../evidence/q2-baseline-count-run-output.txt 2>&1   # (counts)
```

- `pnpm_config_strict_dep_builds=false` is the one override. pnpm 12 fails an install on dependency build scripts nobody
  approved (workerd, esbuild, protobufjs, core-js-pure, @google/genai). The repository answers that with
  `allowBuilds: false` for each in `pnpm-workspace.yaml`, which an `--ignore-workspace` install does not read. The
  override leaves every build script unrun, the same outcome. `--ignore-scripts` does not avoid the failure.
- Run the binaries directly, as above. `pnpm exec` or `pnpm run` in this directory without `--ignore-workspace` would
  resolve up to the repository's workspace.
- Each runner writes its evidence under `evidence/` with machine paths replaced by `<repo>`, `<tmp>` and `<home>`.
  The persisted Durable Object state lives in a fresh temporary directory per run.
- `git diff --stat origin/main -- pnpm-workspace.yaml pnpm-lock.yaml` is empty: the prototype has its own lockfile.

## Question 1: Workers — go

### What ran

`prototype/src/q1.worker.ts` hosts `PiHarness` the way the official guide `agents/docs/harnesses/pi.md` (in
`agents@0.33.0`) shows: a plain Durable Object, `Lifecycle.install(this).use(this.harness)`, a factory that calls
`Harness.open(storage, { models, registry, onWake }, context)`, and the registry per object. Two classes differ only
in the `resolve_anime` tool's `replay`: `SafeProbe` (`"safe"`) and `UnsafeProbe` (`"unsafe"`, the default).

- **Model**: pi-ai 1.5.2's `fauxProvider`. Each step is a factory that reads the transcript it is handed: with no tool
  result yet, it calls `resolve_anime` for the user's title; after a tool result, it answers from that result. A
  restarted instance therefore continues the same script. No real model is reached.
- **Tool**: `resolve_anime` fetches `https://catalog.internal/v1/resolve`. Nothing in workerd answers that host: every
  request leaves through Miniflare's `outboundService` (`prototype/run/workerd.ts`). That handler runs in Node, outside
  workerd, so its counts survive the kill. It answers the stubbed catalog and refuses everything else.
- **Event log**: every event (construction, startup, request, alarm, each lifecycle job via a `PiHarness` subclass
  that only records `onJob`, model steps, tool start and end) goes to a table in the object's own SQLite, tagged with
  a per-instance random id. The report therefore never depends on memory the eviction destroys.

Eviction is a real process kill. Miniflare 4's `dispose()` sends SIGKILL to workerd
(`miniflare@4.20260722.0 dist/src/index.js:83634`). The runner starts a new workerd over the same persisted directory
and sends nothing until the object has answered. Step 0 (`run/alarm-probe.ts`) first proved the mechanism alone on a
bare SQLite Durable Object. An alarm armed for +1,993 ms survived the SIGKILL, constructed a new instance in the new
process, and ran `alarm()` there before any request (`evidence/q1-step0-alarm-survives-sigkill.json`:
`constructed`, `alarm`, then the runner's `request:read`).

### Results

**One turn.** `pi.user`, then `pi.system` (the tool offered), `pi.assistant` calling `resolve_anime({ title: "Turn
Probe" })`, `pi.tool-result` (`isError: false`), and `pi.assistant` answering from it. The operation settles `done`;
the catalog counted one call.

**Eviction with `replay: "safe"`** (times from the SIGKILL):

- On A: submit; model step `resolve_anime`; `tool:start` at −1,002 ms, its catalog call held in flight by the guard.
- Then the wake job and its alarm at −1,001 ms, so the job's 30 s heartbeat is armed. The runner waited 1 s, tool call
  still held, so the re-arm was durable before the kill.
- On B, with no request sent: a new instance at +29,006 ms; `tool:start` (the rerun) at +29,028; startup at +29,030;
  the `pi-wake` job at +29,031; `tool:end` at +29,034; the model's answer at +29,051. The runner's first request
  (+29,058) found the operation `done`, with text `Resolved: {"outcome":"resolved",…}`.
- The catalog counted two calls: the held one and the rerun's. The transcript holds one tool call and one successful
  result.

**Eviction with `replay: "unsafe"`**: the same path to the kill.

- On B, with no request sent: a new instance at +29,012 ms, and the model's answer at +29,109.
- The model was handed `<harness>\n[error] Tool resolve_anime was interrupted and may have partially run\n</harness>`
  as the tool result (`isError: true`), and answered from it. The operation settled `done` with that answer.
- The catalog counted one call; no `tool:start` on B.

**Order on the restarted instance.** `PiHarness` opens Pi in its own startup hook, which runs before the host's
`onStart` (`agents@0.33.0 dist/harness/pi/index.js:141-143`). Its `_doOpen` calls `pi.resume()` (`:447-462`), so the
safe rerun and the unsafe interrupted result begin inside the startup that the alarm triggered. The `pi-wake` job then
runs and waits on Pi until the turn ends. This matches the guide: "If the object is evicted or crashes, the job is
still due, so its alarm restarts the object. Pi reopens its stored state and resumes the session's work: a
replay-safe tool call runs again, and an unsafe one is reported to the model as interrupted"
(`agents/docs/harnesses/pi.md:273`).

**Recovery delay depends on where the kill falls.** The runner fixes one path so re-runs agree; development runs
without the 1 s wait also showed the other two, and their output was not kept.

- After the job's heartbeat re-arm is durable (the recorded runs): about 29 s. That is the 30 s heartbeat from the
  job's last run (`HEARTBEAT_MS`, `agents@0.33.0 dist/harness/pi/index.js:39`; the Lifecycle deadman delay is also
  30 s, `dist/lifecycle-v1rKHV2C.js:445`), less the 1 s wait.
- Before the first wake ran, or before its re-arm committed: much faster, but only sometimes. The stored alarm is
  still the due-now wake that `submit` pushed (`dist/harness/pi/index.js:325-348`), and workerd fires it as soon as it
  starts.
  - This is an observation that depends on timing, not a recorded result. Phase 1's development runs saw 36–56 ms,
    and that output was not kept.
  - The independent review of phase 1 removed the wait for the wake alarm and the 1 s sleep, and killed six times
    (three runs, safe and unsafe). One kill hit the fast path: 223 ms, unsafe. The other five took about 30 s.
  - In every case both modes finished the turn.
- A console line from the object can precede its durable write. In one development run, the runner saw the object's
  `alarm` log line, killed immediately, and found neither that event nor the re-arm on disk afterwards.
- workerd may redeliver an alarm invocation the kill cut off. The restarted object sees its alarm already moved and
  cancels that delivery. workerd's stderr says `SQLite alarm handler canceled with requestScheduledAlarm`, and the
  instance built for it does nothing; the heartbeat alarm then restarts the object.

The checks therefore require that no request reaches the object before its answer, and that the `pi-wake` job ran on
the instance that answered. They do not require a single new instance.

### `AbortSignal.any`, TypeBox's `new Function`, timers

Probes run inside the Durable Object at the edge's settings (`prototype/src/probes.ts`; values in
`evidence/q1-turn.json`, `probes`).

- **`AbortSignal.any`** exists at 2026-07-22, at module scope and in a handler. Composing two signals and aborting one
  aborts the composite and carries the reason.
  - In the shipped graph it is called from chord's `withAbortSignal` when nesting under a parent signal
    (`@earendil-works/chord@1.5.2 dist/context/index.js:71`) and from pi-ai's `Models.refresh`
    (`@earendil-works/pi-ai@1.5.2 dist/models.js:190`).
  - pi-durable 1.5.2 no longer calls it directly. The call site the October record cites,
    `pi-durable@1.0.2 dist/harness/scheduler.js:1072`, has no counterpart in 1.5.2's `dist`.
  - A counting wrapper around the native method recorded 0 calls during the turn. Its positive control holds: the
    probe's own single call then moved the counter to 1 (`abortSignalAnyCallsAfterOwnCall`). It is available, and the
    turn's path does not use it.
- **TypeBox's `new Function`**: TypeBox is gone from the chain. pi-durable 1.5.2 validates tool arguments with
  pi-schema 1.5.2, whose npm description is "JSON Schema validation without eval: drafts 2020-12 and 7, compiled into
  plain closures". No `typebox` package is in the prototype's lockfile or the bundle's module graph.
  - workerd at this date allows `new Function` at module scope and refuses it in a handler with
    `EvalError: Code generation from strings disallowed for this context`. That is the trap the card names: a library
    that detects the feature at load time sees it work, then fails inside a request.
  - The only `new Function` in the emitted bundle is the probe's own (`evidence/q1-bundle.json`,
    `newFunctionOccurrences`).
  - pi-schema's validator ran in request context. It refused `{}` before `execute` ran, with the error result
    `Validation failed for tool "resolve_anime": title: missing` (line breaks removed; `evidence/q1-validation.json`).
  - It also coerced `{ title: 42 }` to `"42"` and ran the tool with it. Phase 1 called this a semantic difference for
    question 3. Part A's [`validation`](#validation) case refutes it for the inputs it ran: today's 0.87.1 validator
    coerces the same arguments the same way, before `execute`.
- **Timers**:
  - Inside a live object, `setTimeout(25)` resolved after 26–27 ms. The faux model's streaming and `PiHarness`'s wait
    loop (`dist/harness/pi/index.js:401-407`) both run on in-memory timers.
  - None of them survives an eviction. The persisted alarm is the only wake, about 29 s after the kill in the recorded
    runs (above).
  - The factory passes `onWake`, so Pi arms no in-memory timer while a task sleeps. `PiHarness` logged no
    missing-`onWake` warning (the warning text is at `dist/harness/pi/index.js:461`).
  - In local workerd, `Date.now()` advanced 46–63 ms across a 20-million-iteration synchronous loop (across runs). Whether
    production's clock behaves the same was not checked here. It matters to question 3's turn budget, which reads a
    start time.

### The bundle

The Wrangler dry-run artifact of `src/q1.worker.ts`, the one `run/q1.ts` executes, is about 0.99 MB (about 0.22 MB
gzip). The exact size depends on the build path, so it does not reproduce byte for byte. Phase 1 recorded 991,226 bytes
(220,674 gzip); the independent review's re-run got 983,998 (220,195 gzip). Its metafile (`evidence/q1-bundle.json`)
shows:

- **External imports** (Wrangler's `node-built-in-modules:` shim credited to the module that asked):
  - `node:async_hooks` (`agents@0.33.0 dist/current-agent-DhoDkSnH.js`, `dist/lifecycle-v1rKHV2C.js`);
  - `node:diagnostics_channel` (`agents@0.33.0 dist/diagnostics-BzvaX2UT.js`);
  - `cloudflare:workers`;
  - `node:fs`, from `@earendil-works/pi-ai@1.5.2 dist/utils/provider-env.js:19`. That is a lazy `require` inside a
    branch that runs only under Bun (`process.versions?.bun`, `:13`).
  - workerd provides all four under `nodejs_compat`. The artifact loaded and ran every scenario.
- **No unenv polyfills, no dynamic imports, no emitted WASM.**
- **Not in the graph**: pi-codemode, quickjs-wasi, `@silvia-odwyer/photon`, TypeBox, or any provider SDK (openai,
  `@anthropic-ai/sdk`, `@google/genai`, the Bedrock client). This holds although pi-durable 1.5.2 depends on codemode
  and photon (its `package.json`); the entry points `PiHarness` uses do not import them.

Verdict: no Node-only import.

### Question 1 verdict

Go at the edge's compatibility date `2026-07-22` with `nodejs_compat`, and no later date is needed. All 22 checks in
`evidence/q1-checks.json` pass. `evidence/q1-run-output.txt` and `evidence/q1-workerd-log.txt` are the console and
workerd output of the recorded run.

Caveat for reading the event log: the object's own event rows share its SQLite database with Pi's commits. chord runs
those commits inside `ctx.storage.transaction()` (`@earendil-works/chord@1.5.2 dist/sqlite/cloudflare.js:127-129`), so
an event row written while one is open commits or rolls back with it.

## Question 4: risk

Sources: the npm registry (release dates), `@earendil-works/pi-durable@1.5.2 CHANGELOG.md` and `README.md`, and the
`agents@0.33.0` docs.

### Release cadence

**pi-durable.** First on npm 2026-09-19 (0.0.1); 20 versions up to 1.5.2 (2026-11-10).

- The 1.x line in 40 days: 1.0.0 10-01, 1.0.1 10-03, 1.0.2 10-04, 1.0.3 and 1.0.4 10-05, 1.1.0 10-07, 1.2.0 10-12,
  1.3.0 10-15, 1.4.0 10-21, 1.5.0 11-02, 1.5.1 11-09, 1.5.2 11-10.
- Five minors in 32 days, then none in the 16 days to 2026-11-18. It releases in lockstep with pi-ai, chord and
  pi-agent-core.
- Breaking-change bullets per release (`CHANGELOG.md`): 1.0.3: 4, 1.0.4: 2, 1.1.0: 2, 1.2.0: 6, 1.4.0: 6, 1.5.0: 34.
  That is 54 in 40 days, including two patch releases. Semver is not a contract here; the README's banner says so:
  "**Experimental.** The API changes without notice between releases." (`README.md:3`).

**`PiHarness` (`agents`).** It arrived in `agents` 0.26.0 (10-02); there have been ten releases from 0.26.0 to 0.33.0:
0.26.0 10-02, 0.27.0 10-07, 0.28.0 10-09, 0.28.1 10-13, 0.29.0 10-20, 0.30.0 10-22, 0.30.1 10-23, 0.31.0 10-27, 0.32.0 10-29, 0.33.0
11-03. The docs index labels it Beta (`agents/docs/index.md:62`). `agents/lifecycle`, which hosts it, is stable;
"most capabilities built on it are still experimental" (`agents/docs/lifecycle.md:3`).

**The coupling decides the cost.**

- Since 0.29.0, each `agents` release peers on exactly one Pi minor, with a tilde: 0.29.0 `~1.3.0`, 0.30.0 to 0.32.0
  `~1.4.0`, 0.33.0 `~1.5.0` (pi-ai, pi-durable, and from 0.30.0 chord; 0.33.0 adds pi-schema). 0.26.0 to 0.28.1 took
  `^1.0.0`. They are optional peer dependencies: `agents@0.33.0 package.json:80-83` declares the four at `~1.5.0`, and
  `:109-119` marks each optional in `peerDependenciesMeta`.
- `agents` followed each Pi minor within five days: Pi 1.3 on 10-15, `agents` 0.29.0 on 10-20; 1.4 on 10-21, 0.30.0 on
  10-22; 1.5 on 11-02, 0.33.0 on 11-03.
- The guide states the rule: "pi-durable is experimental, and its API can change in minor releases, so `agents`
  supports one Pi minor at a time" (`agents/docs/harnesses/pi.md:17`). Following Pi therefore means moving `agents` and
  the four Pi packages together, at the pace of the slower.
- **A Pi minor is a one-way data migration.** "A new Pi minor can also store conversations in formats the previous one
  cannot read: after a conversation runs on Pi 1.5, rolling your Worker back to an `agents` version on Pi 1.4 leaves
  that conversation unreadable. Roll forward to fix a bad deploy instead." (`agents/docs/harnesses/pi.md:17`).
  pi-durable 1.4.0's changelog says the same of its SQLite storage: opening it migrates to schema version 2, and "a
  migrated database cannot be opened by 1.3.0 or earlier".
- That conflicts with our CD's escape hatch: "To deploy a different release instead — an older artifact, a re-deploy,
  a rollback — dispatch `CD` with … that `artifact_id`" (`docs/ops/deployment.md:472-474`). After a Pi-minor deploy,
  redeploying an older artifact makes the conversations that ran on the new minor unreadable.

### The surface we would use

- **`agents`**:
  - `PiHarness`: the constructor's `harness` factory and `defaults`; `submit`, `wait`, `abort`, `pending`, `messages`,
    `session(id).watch`, `entries`, `pi()`.
  - Installation on our `Agent` subclass through `this.lifecycle.use(harness)` (`agents/docs/harnesses/pi.md:59`).
- **pi-durable**:
  - `Harness.open` with `models`, `registry`, `onWake`, `settings` (`retry`, `restartLimit`, `afterFailedRun`,
    `progress.persistWithinMs`) and `onReport`.
  - `createRegistry` and `registry.install` (tools, prompt sections, hooks).
  - `ToolRegistration`: pi-schema `parameters`, `replay`, and `execute` returning `output`, `isError` and `usage`.
  - Per-entry usage and `harness.usage()`; the conversation view and its `pi.live` document; `inspect()`; and
    `ROOT_CONVERSATION_ID`.
  - Route (b) adds the `Storage` interface and `registerStorageConformance` (`/testing`). Eval adds `MemoryStorage`
    and `/storage/jsonl`.
- **pi-ai 1.5**: `createModels`, the provider objects (`xiaomiProvider`, `opencodeGoProvider`), and the message and
  `Model` types. **pi-schema**: its builders.

### Experimental parts

- All of pi-durable (the README banner), and `PiHarness` (Beta). Only `agents/lifecycle` is marked stable.
- The streaming surface moved under us. 1.5.0 removed `watchEvents()` and its agent-event types: the bullet at
  `CHANGELOG.md:76`, under `## [1.5.0] - 2026-11-02` (`:23`), "Breaking Changes". The README's table of contents still
  lists "Agent Events (Experimental)" (`README.md:27`), but no such section remains.
- The replacement is the conversation view, which `PiSession` exposes as `watch(window)`. The `session.events()` that
  the card and the spec name does not exist in `agents` 0.33.0:
  - `PiSession` (`agents@0.33.0 dist/harness/pi/index.d.ts:279`) declares `watch()` (`:329`) and no `events()`;
  - only a stale doc comment still says the host's glue is "built on `session.events()`" (`index.d.ts:184`).

### Cost of following releases

Of the five 1.x minors, four changed the surface above. Route (a) would have been hit by three of them (1.2, 1.4, 1.5);
route (b) by four.

- **1.1.0**: `Storage` must honour a new query `order` (route (b) only).
- **1.2.0**:
  - `ToolExecutionResult.content` became `output` (all seven tools).
  - Any `Storage` error now fails the session (route (b)).
  - Tool task inputs became tagged unions.
- **1.4.0**:
  - The SQLite storage migrates forward on open (rollback, above).
  - Crash-looping tasks are parked.
- **1.5.0**:
  - Tool schemas became pi-schema (all seven tools).
  - `Storage.commit` changed shape and `mintId`'s contract narrowed (route (b)).
  - `watchEvents()` was removed and the watch shapes changed (the stream projection).
  - `onReport` changed shape.
  - A model request in flight at a crash is no longer resent at once (settlement and recovery).
  - `pi.live` went to version 3 (the stream projection).

Estimate:

- One adapter PR per Pi minor, plus the matching `agents` bump. Most are small to medium; a 1.5.0-sized one is large.
- Every such PR re-runs all of the spec's seams, per its version rule.
- At October's pace (a minor about every six days), that is roughly one such PR a week. November has been slower.
- Each such deploy is forward-only.
- The spec's version rule, "pi-durable 和 pi 的其他包一样跟 latest，不钉住", costs more than this needs. The `agents`
  tilde peer already forces the Pi minor; following `agents`' supported minor, not Pi's latest, is the cheaper
  policy. That is the owner's call.

## Question 5: migration surface

Baseline 0.87.1 (the owner's 2026-11-18 decision skips 0.99.2), measured at 6c9fb45b6 with the October record's file
selection: `git grep -l -E "(from|import\()[[:space:]]*['\"]@earendil-works/pi-agent-core" -- '*.ts' '*.tsx'`.

- 189 files import pi-agent-core. The October record counted 188 at a26c4c7cc, of which 187 used names removed
  in 1.0.
- 158 of the 189 import a subpath that 1.x no longer exports. pi-agent-core 1.5.2 exports `.` and `./package.json`, no
  code subpath (corrected by the independent review; the count is unchanged). Files counted per specifier:
  `/harness/context` 126, `/harness/session` 81, `/node` 3, `/harness/session/testing` 3.
- 86 files import pi-ai, and 21 import chord.

| Package | Files importing pi-agent-core: production / test (lines) | What changes | Size |
|---|---|---|---|
| `packages/pi-session-neon` | 9 (447) / 13 (513) | `NeonStorage implements Storage` and `NeonSessionRepo` are 0.87.1 interfaces. Route (b): a pi-durable `Storage` backend under 1.5's `commit` and `mintId` contract, plus its conformance. Route (a): a projection writer keyed by `(session_id, seq)` instead. Either way, a migration in the Prisma chain for the new record shape. | L (route b) / M–L (route a) |
| `packages/agent` | 24 (837) / 57 (2,598) | Seven tools to `ToolRegistration`: pi-schema parameters, `output`, and the replay mapping (six `"safe"` stay, `translate_anime_title` `"never"` becomes `"unsafe"`). Also harness composition, hooks, prompt sections, pi-ai 1.5 models. | L |
| `workers/edge` | 23 (1,255) / 39 (2,602) | `SessionAgent` adopts `PiHarness` through `this.lifecycle.use()` (routes a, b), or `Harness.open` with our own wake (b′). Admission moves in front of `submit`. The turn budget becomes a host abort; today it is the 0.87.1 `before_request` hook (`src/agent/host/session-agent.ts:269`). Settlement reads per-operation usage from Pi's records instead of `readOperationCharges(storage: Storage, …)` (`src/agent/settlement/settlement-accounting.ts:34`). History and stream views (`src/agent/views/`) move to Pi's entries and `watch()`. Native models move to pi-ai 1.5. Bundle-smoke fixtures that alias 0.87.1 change, and the host and DB integration lanes are rewritten as equivalents. | XL |
| `packages/eval` | 10 (1,393) / 13 (869) | The in-process task moves from `MemorySessionRepo` to `MemoryStorage`. Prefix record and replay move from `NodeExecutionEnv` plus `JsonlSessionRepo` (`src/native/in-process-task.ts`, `prefix-record.ts`, `prefix-replay.ts`) to pi-durable's JSONL storage. The frozen prefix corpus, five JSONL sessions with the harness's `storageVersion` 1 in `fixtures/prefix-corpus`, is converted or re-recorded. 20 files import chord. | L |
| `apps/web` | 0 / 1 (21) | One unit-test helper | S |
| Root config | — | Catalog: pi-ai and chord to 1.5.x; add pi-durable and pi-schema; pi-agent-core removed (or latest if a consumer remains); the edge's 0.87.1 smoke aliases removed | S |
| `agents` | — | Already `^0.33.0` in the edge since #2047 (0bd0ffad8, 2026-11-18), up from 0.23.0, so the version step of the planned upgrade is done. Adopting `PiHarness` adds the four Pi peers at `~1.5.0`; from then on `agents` and Pi move together (question 4). | S now, recurring |

Production versus test is by path: files under `test/`, `integration-test/`, the edge's test lanes, `doubles/` or
`fixtures/`, and `*.test.ts`, count as test. Lines are whole files, an upper bound on what changes.

Sizes are judgments from the lines above plus the test rewrites the spec requires (equivalents, never deletions): S
under a lane day, M one to two, L three to five, XL more than five. Against the spec's provisional tickets:

1. Storage: L for route (b), M–L for route (a).
2. Agent construction: L, plus L for eval.
3. Edge host: XL.
4. Integration and cleanup: M.

Part B corrects these sizes and the pi-schema step: see [Re-cut migration tickets](#re-cut-migration-tickets).

### Can two pi-ai versions coexist in one package?

- **Installed side by side: yes.**
  - pnpm's isolated linker gives each dependency its own tree. pi-durable 1.5.2 pins pi-ai 1.5.2 exactly; pi-agent-core
    0.87.1 takes pi-ai `^0.87.1`, which a 0.x caret keeps within 0.87.
  - An importer can name both through npm aliases. The edge already does this:
    `pi-ai-smoke: npm:@earendil-works/pi-ai@0.87.1` and the matching `pi-agent-core-smoke` (`workers/edge/package.json`).
- **The peer slot is the constraint.**
  - `agents` takes pi-ai, chord, pi-durable and pi-schema as optional peers at `~1.5.0` (`agents@0.33.0
    package.json:80-83`, optional at `:109-119`). `agents/harness/pi` imports them at runtime
    (`agents@0.33.0 dist/harness/pi/index.js:6-10`), so a package that hosts `PiHarness` must install them.
  - pnpm binds a peer to the importer's own dependency of that exact name. Today the root lockfile binds the edge's
    `agents@0.33.0` to pi-ai and chord 0.87.1 (`pnpm-lock.yaml:17150`).
  - So the package that hosts `PiHarness` must carry pi-ai 1.5.x under its canonical name. Any 0.87.1 code left in it
    must reach its pi-ai through an alias.
- **Types don't cross.** pi-ai 1.5.2 brands `TranscriptContext` with a `unique symbol` (`dist/types.d.ts:565,574`),
  declared once per copy. A value typed by one copy is not assignable to the other's. Models, tools, messages and usage
  handed to pi must all come from 1.5.
- **Answer.** Two copies can sit in one package, but not under one name, and no pi value can pass between them.
  - `packages/agent` hands tools and models to the edge's harness, and `packages/pi-session-neon` hands it storage.
  - A package moved alone would therefore leave its consumer straddling both lines, through a throwaway alias layer.
  - So the migration cannot land package by package without that layer, and the spec's single integration branch
    stands: tickets 1–3 on one branch, ticket 4 merges.
  - Part A's `validation` probe loads pi-ai 0.87.1 (aliased as `pi-ai-0871`) and 1.5.2 side by side in one Node
    process. That confirms the install side, not the types.
  - Neither phase built the rest. An alias build plus typecheck would confirm it, if the owner wants to weigh
    a package-by-package path.

## Question 2: storage

Part A ran what needs no Postgres: the choice between routes (b) and (b′), case b0, the socket refusal, and the
choice of counting method. Part B ran the rest.

- Part B reached the shared test Postgres, already running on loopback, directly with `pg`, in databases of its own
  (`spike_pi_durable_*`, created from `template0` and dropped by each runner). It started no container.
- The one container lane was today's baseline: the edge's host test boots or reuses the server through testcontainers.
  The coordinator ran it.
- Each case names its command, run from `prototype/` with the re-run block's `sandboxed` function.
- The marks **[container]** below are part A's plan; the part B sections give what ran.

### Part A: the route decision

**Question.** Does `PiHarness`'s factory accept a Storage other than the one `_doOpen` prepares? And do its operation
calls follow that Storage?

**Method.** `q2/route.worker.ts` defines three Durable Object classes that differ only in the Storage the factory opens
Pi on.
- One request runs the same scenario on each, within one object lifetime, in workerd at the edge's settings.
- The model is faux at 200 tokens/s. One answer of 3,000 characters streams for about four seconds, so an abort lands
  mid-answer.
- Every answer is read twice: through `PiHarness`, and from the Storage Pi was opened on.
- 23 checks pass (`evidence/q2-route.json`).

| Call | The storage `PiHarness` passes in (control) | A wrapper delegating every call to it | `MemoryStorage` |
|---|---|---|---|
| First `submit` → `accepted` | `true` | `true` | `true` |
| `wait("op-1")` | `done`, with Pi's text | `done` | `unanswered`, reason `not_found`. Pi settled op-1 `done`. |
| Second `submit`, same id, other content | `accepted: false`; Pi ran only the first | the same | `accepted: true`. Pi still kept one submission, by its own request-id dedupe (`@earendil-works/pi-durable@1.5.2 dist/harness/submissions.js:173-180`). |
| `abort({ operationId: "op-2" })` mid-answer | `true`; Pi settles op-2 `unanswered`, reason `aborted` | the same | `false`; Pi answers op-2 `done` |
| `abort` of an id never submitted | `false` | `false` | `false` |
| `pending()` while op-2 streams | op-2 `running` | the same | op-2 `running`: it reads `pi.inspect()` |
| `sessions.list()` while op-2 streams | the root session | the root session | `[]` |

**What it shows.**
- **The factory accepts any Storage.** Pi opens on it and runs. Through the wrapper, Pi called `commit` 10 times in
  the recorded run (the check: more than zero). On `MemoryStorage`, Pi answered both operations.
- **`PiHarness`'s own reads do not follow it.**
  - `_doOpen` opens the object's SQLite store itself (`openPiSessionStore`, `agents@0.33.0
    dist/harness/pi/index.js:449`). It returns that store beside Pi whatever the factory used (`:467-470`).
  - Four calls read that store: `accepted` (`:310`), `abort(operationId)` through `withdraw` (`:266`), `wait()` through
    `_findSubmission` (`:485`), and `sessions.list()` (`:630-648`).
  - With another store, they answer from an empty one and raise no error:
    - a duplicate gets `accepted: true`;
    - `wait()` answers `not_found` at once;
    - `abort(operationId)` returns `false` while the run continues.
- **Phase 1's prediction holds, with two refinements.** `abort(operationId)` returns `false`, not a `not_found` value,
  and the operation runs on. `sessions.list()` is empty too. `pending()` and `messages()` go through Pi and stay right.
- **The wrapper behaves like the control.** What breaks the calls is where the data lives, not which object holds
  it. A commit-observing wrapper, such as route (a) might use, is accepted.
- **The declarations say the same.** The factory "Opens pi's `Harness` over the storage this object prepared"
  (`index.d.ts:178`), and the `storage` it is handed is "pi's storage over this object's SQLite" (`:115`).

**Decision: route (b′) for a Neon backend.**
- **Why not (b).** As the spec words it, (b) keeps `PiHarness` and swaps only the storage. Its operation API would
  then be wrong without an error, so way 4 holds for (b) on the operation calls.
- **Why not a hybrid.** `PiHarness` could be kept only for its wake, with `accepted`, `wait()` and `abort()`
  re-implemented against the backend through `harness.pi()`; those functions are about 40 lines (`index.js:263-318`,
  `:483-487`). But that relies on `PiHarness` reading nothing else from its own store. Its contract does not promise
  this (`index.d.ts:178`), and a release could change it.
- **What part B builds.** `SessionAgent` calls `Harness.open` on the backend and owns the wake (b′1–b′3 below). b1
  stays as it is. b2–b4, written for `PiHarness`, are not run.
- **Not shown in part A, closed in part B.** Whether `PiHarness`'s wake finishes an interrupted turn across an
  eviction on a store other than its own: [b3-alt](#part-b-b3-alt-piharnesss-wake-on-a-store-it-did-not-prepare) shows
  that it does, and why that leaves (b) out.
- **Route (a) is unaffected.** It keeps `PiHarness` on its own store, which is the control above, where the operation
  calls are right.

### Part A: case b0

`q2/conformance-control.test.ts` runs pi-durable's conformance cases (`createStorageConformance`) on a fresh
`MemoryStorage` per case, under `node:test`. It loops them the way
`packages/pi-session-neon/test/storage-conformance.db.test.ts:15-16` loops 0.87.1's suite.
- The assertions are `q2/conformance-assertions.ts`. It maps the suite's six assertions onto `node:assert`, with the
  semantics of the Vitest matchers that pi-durable's own adapter uses (`dist/testing/assertions.js:5-21`).
  `registerStorageConformance` would need a Vitest/Jest runner (`dist/testing/runner.d.ts:3-9`).
- **Result: 32 of 32 pass** (`evidence/q2-b0-conformance.txt`).
- **Negative control** (`q2/conformance-negative.test.ts`). The same cases, through the same adapter, must fail a
  defective storage, or the control proves nothing. Both defects are caught (`evidence/q2-b0-negative.txt`):
  - An empty request index fails 5 of 32, including "indexes request IDs per conversation and replaces complete
    submission records". This is what `PiHarness` reads in the `MemoryStorage` variant above.
  - A request index blind to the conversation fails that same case. This is two sessions' root conversations sharing
    one keyspace.
- The suite sees such a collision only inside one storage. A per-`SessionAgent` keyspace that collides across two
  objects is still b′1's to show.

### Part A: way 11 for sockets

`run/socket.ts` with `q2/socket.worker.ts`, run under the sandbox only (`evidence/q2-sockets.json`):

Times are the recorded run's.

- **Node.** A loopback connect succeeds in 15.3 ms. A connect to 192.0.2.1:5432 (TEST-NET-1, never routed) is
  refused in 3.8 ms, inside the check's 100 ms: `connect EPERM 192.0.2.1:5432 - Local (0.0.0.0:0)`.
- **workerd** (Miniflare, with the same `fetch` guard as every run):
  - The loopback `connect()` opens in 12 ms, and the runner's listener accepts it.
  - The connect to 192.0.2.1:5432 fails in 6 ms, inside the check's 1 s and far from the probe's 5 s timeout, with
    `Error: proxy request failed, cannot connect to the specified address`.
  - workerd's stderr names the cause: `workerd/api/sockets.c++:449: error: Socket proxy disconnected abruptly; e =
    kj/async-io-unix.c++:1518: failed: connect(): Operation not permitted; address = 192.0.2.1:5432`.
- **The guard saw neither socket.** workerd's `connect()` does not pass through `outboundService`. That is also how
  the edge's host lane reaches Postgres while it sets an `outboundService` for model requests
  (`workers/edge/host-integration-test/default-worker.ts:15-19`).

So for sockets, way 11 rests on the sandbox, not on the guard. The profile allows every loopback port except 7897, so
part B still checks that the only loopback port the workers reach is the test Postgres's.

Part B's answer to that check is by construction, not instrumented. The only socket client in the part B workers is
`pg` (through pg-cloudflare's `connect()`), and its only address is the DSN binding, the test server's loopback port.
Each object's connection names itself (`application_name` `pi:<session>`), and the wake runner reads
`pg_stat_activity` for it from Node before restarting (b′2).

### Part B: b3-alt, `PiHarness`'s wake on a store it did not prepare

**Question.** The card's literal (b) criterion: "the lifecycle wake finishes an interrupted turn with it (or the record
shows it does not)".

**Method.**
- `q2/b3-alt.worker.ts` hosts `PiHarness` as question 1 does, except for one thing. The factory opens Pi on a second
  SQLite store in the same object, `openDurableObjectSqliteStorage(ctx.storage, { prefix: "alt_" })`, not on the `pi_`
  store `_doOpen` prepares (`agents@0.33.0 dist/harness/pi/index.js:449`).
- `run/b3-alt.ts` runs question 1's eviction, once with `replay: "safe"` and once with `"unsafe"`:
  - the catalog call is held;
  - the wake job's heartbeat re-arm is durable before the kill;
  - workerd is SIGKILLed, and a new workerd starts over the same directory;
  - nothing is sent until the object has answered.
- 15 checks pass (`evidence/q2-b3-alt.json`).

**Result: the wake finishes the turn.**
- On B, with no request sent, a new instance reopened the alt store in the factory, the `pi-wake` job ran, and the
  turn finished. That took about 29.0 s from the kill in both runs, question 1's heartbeat path.
- Safe: the tool ran again (two catalog calls), and the model answered from its result. Unsafe: one call, and the model
  answered from the interrupted result.
- Read through Pi from the alt store, the operation settled `done`. All of Pi's rows are under `alt_`. The `pi_` tables
  exist (`_doOpen` still opens that store, which creates them) and are empty.

**Why.** The wake reads no store. `_wakeStep` calls `pi.resume()` and `pi.wake()`, and `_waitWhileActive` waits on
`pi.wake()` (`index.js:360-418`). `_doOpen` resumes whatever Harness the factory returned (`:447-462`). The job itself
lives in Lifecycle's own table, `cf_agents_jobs` (`dist/lifecycle-v1rKHV2C.js:396-415`).

**Why (b) stays out anyway.**
- In the same run, `PiHarness`'s `wait()` answered `unanswered`, reason `not_found`, for the operation Pi had just
  answered. It reads `PiHarness`'s own store (`_findSubmission`, `index.js:483-487`). Part A found the same for
  `accepted`, `abort(operationId)` and `sessions.list()`.
- So a host on (b) gets a working wake and a silently wrong operation API. To fix the API it would re-implement those
  calls against `harness.pi()`. That is part A's hybrid, which relies on `PiHarness` reading nothing else from its own
  store, something its contract does not promise (`index.d.ts:178`).
- The wake result changes why (b) is out, not whether it is. The obstacle is the operation API, not the wake.

### Counting method: decided in part A, run in part B

**Choice: `pg_stat_monitor`, counted on the server.**

- **Why it is available.** The coordinator ran a no-network container on the test image and read its
  `shared_preload_libraries` (`/usr/share/postgresql/18/postgresql.conf.sample:892`). `pg_stat_monitor` is preloaded,
  with pg_qualstats, pg_wait_sampling and others; `pg_stat_statements` is not. The cluster starts with no `-c`
  overrides (`packages/test-postgres/src/test-postgres-cluster.ts:81-86`), so the configuration is initdb's copy of
  that sample. The Dockerfile edits the same sample (`packages/test-postgres/Dockerfile:13-14`).
- **Why not the counting proxy.**
  - The baseline runs today's host test unchanged. That test builds its DSN from the cluster's mapped port
    (`workers/edge/host-integration-test/postgres.ts:13-14`) and hands it to the worker as `AGENT_SVC_DATABASE_URL`
    (`default-worker.ts:15`). Nothing redirects it to a proxy without editing files outside this directory.
  - A proxy also counts a multi-statement simple query as one message, and the test's setup sends two such strings
    (`postgres.ts:16-23`, `:27`).
- **The method, the same for today's store and every route.**
  1. Reset `pg_stat_monitor` before the run.
  2. Run the turn, or today's test.
  3. Sum `calls` over the rows of the measured database.
  4. Subtract what is not the turn's, identified by query text: today's test setup (`postgres.ts:16-23`, four
     statements; `:27`, three; `:28`, one) and its assertion queries; the prototypes' own setup and report reads.
- **What it counts.** Statements executed on the server, at top level. A pipelined batch of N statements counts N, and
  a statement counts once however many round trips it takes. **This counts statements, not round trips.**
- **The repository's own method does not apply.** It counts round trips by timing: time N identical operations
  against the real database and divide by the round-trip time (`docs/agents/database-and-migrations.md:59-65`). The
  spike may reach no remote database. The card and the spec compare statement counts, never timings: the test database
  is TCP, while production's Neon driver is WebSocket-only.
- **Confirmed in part B's first step, not assumed here.** Part A ran none of this.
  - `SHOW shared_preload_libraries` on the running cluster.
  - `CREATE EXTENSION pg_stat_monitor` in a database that is not measured; its view reports every database.
  - The names of its reset function and its columns on the image's version (`\dx+ pg_stat_monitor`,
    `SELECT * FROM pg_stat_monitor LIMIT 0`).
  - Its settings (`SELECT name, setting FROM pg_settings WHERE name LIKE 'pg_stat_monitor.%'`): top-level-only
    tracking, utility statements (`BEGIN`, `COMMIT`), bucket size and bucket count. Counts are summed across buckets.
- **One count at a time.** The reset is global, and the cluster is a reused shared container
  (`test-postgres-cluster.ts:73-87`). Part B counts with no other database suite running. For the prototypes, an owned
  cluster is an option (`:116-119`); today's test uses the shared one.
- **Part B's control** (`prototype/q2/count-control.ts`, written in part B and run before any measured count). One `pg`
  client, as a service role, in a fresh database, issues a known set of statements:
  - three parameterised statements through the extended protocol (a `SELECT $1::int`, an `INSERT`, an `UPDATE`): 3;
  - one transaction, `BEGIN`, an `INSERT`, `COMMIT`: 3;
  - one simple-protocol string of two statements, `SELECT 1; SELECT 2`, the shape of today's setup strings: 2;
  - one named prepared statement executed twice: 2;
  - one statement that fails, `SELECT 1/0`: 1 if `pg_stat_monitor` records failed statements; the control records
    which;
  - total 11, or 10 without the failed statement.
- **When the control passes.** The summed `calls` for that database must equal the known number exactly, twice, with
  a reset between. The reset and read queries must stay out of the count, which holds because they run from another
  database.
- **If it fails.** Part B reports why. It then falls back to the proxy for the prototypes, and today's test cannot be
  counted unchanged.
- **Part B result: the control passes, so `pg_stat_monitor` counts exactly** (`q2/pg-inspect.ts`,
  `q2/count-control.ts`, `q2/counter.ts`; `evidence/q2-pg-inspect.json`, `q2-count-control.json`).
  - The server is PostgreSQL 18.6. `pg_stat_monitor` 2.4 is in `shared_preload_libraries` and was created in the
    spike's counter database, `spike_pi_durable_counter`, never in the admin database. Its reset is
    `pg_stat_monitor_reset()`. The view `pg_stat_monitor` has `datname`, `query`, `calls`, `cmd_type_text`,
    `relations`, `application_name` and `elevel`.
  - Settings:
    - `pgsm_track = top`: top level only;
    - `pgsm_track_utility = on`: `BEGIN` and `COMMIT` are counted;
    - `pgsm_bucket_time` 60 s and `pgsm_max_buckets` 10: a count must end within about ten minutes of its reset;
    - `pgsm_normalized_query = off` and `pgsm_query_max_len` 2048.
  - The control counted exactly 11 in both passes, with a reset between, in two independent runs.
    - The failed `SELECT 1/0` is counted (`elevel` 21).
    - `SELECT 1; SELECT 2` counts 2.
    - A named statement executed twice counts 2.
  - After `DROP DATABASE`, the second pass's 11 rows still read by name. Today's host test drops its database before
    its runner reads, so this is what lets its count be read at all.
  - One deviation from the design: the control's client connects as `postgres`, not as a service role. The five
    service roles are `NOLOGIN` (`packages/test-postgres/src/service-roles.ts:52-66`), and every measured workload,
    today's host test included, connects as `postgres`.
  - Each count below is per object: every part B object opens its own connection under its own `application_name`,
    and `pg_stat_monitor` keeps that name per row.

### What starts a container

- `startTestPostgresCluster` boots or reuses a testcontainers `GenericContainer` over the local image
  `animichi-test-postgres:18-3.6-pgvector-0.8.6` (`packages/test-postgres/src/test-postgres-cluster.ts:80-87,158-160`).
  Every `*.db.test.ts`, every `workers/edge/host-integration-test` and `agent-db-test` file, and every case below that
  touches Postgres calls it.
- The image itself is built once with `docker build -f packages/test-postgres/Dockerfile -t
  animichi-test-postgres:18-3.6-pgvector-0.8.6 .`, the one step that needs the network for its base image
  (`packages/test-postgres/postgres-image.env`).
- No container is needed to build the prototype, for Pi's side of route (a) in workerd (the object's SQLite, as in
  question 1), or for running pi-durable's conformance suite on `MemoryStorage` as the suite's own control.

### Shared method (part B)

- **Where code goes.** Under `prototype/q2/`, with its own runners in `prototype/run/`. The prototype adds `pg` to its
  own `package.json`, so the lockfile hash changes and is re-recorded.
- **Reaching Postgres from workerd.** The Durable Object reaches the test Postgres the way the edge's host lane already
  does, through a DSN binding (`workers/edge/host-integration-test/default-worker.ts:15-17`, `AGENT_SVC_DATABASE_URL`).
  The edge builds that client with Prisma's runtime over a `postgres://` URL (`workers/edge/src/native-client.ts:14-16`).
- **Sandbox and guard.** That connection is a socket, not a `fetch`, so the outbound guard does not see it, and the
  sandbox is way 11's enforcement for sockets. Part A showed both ([way 11 for sockets](#part-a-way-11-for-sockets)).
  Part B still checks two things: the connection appears in `pg_stat_activity`, and the only loopback port reached is
  the test Postgres's.
- **Statements per turn, the same way for every store.** The counting method is
  [above](#counting-method-decided-in-part-a-run-in-part-b), validated first on part B's control. It counts statements
  on the server, not ORM log lines: `docs/agents/database-and-migrations.md:59-65` warns that `BEGIN`/`ROLLBACK` log
  lines are not statements.
- **Today's store, the baseline [container].**
  - The edge's existing one-turn host test, run alone and unchanged, with the counter around it:
    `node --import tsx --test --test-isolation=none --test-concurrency=1 --test-name-pattern "production chat tier boots the default SessionAgent" workers/edge/host-integration-test/default-host.test.ts`.
    That test is "production chat tier boots the default SessionAgent, executes its native respond tool and settles
    from real Neon usage" (`default-host.test.ts:9`).
  - Its fixed per-test statements in its own database are subtracted by query text. They are one trigger script of
    four statements, one `TRUNCATE`/`DELETE` string of three, one `DELETE`, and its assertion reads
    (`host-integration-test/postgres.ts:16-28`).
  - This needs a frozen root install (`pnpm install --frozen-lockfile` at the root), which changes no tracked file.
- **Like for like.** The baseline turn is one model request that calls the `respond` tool and settles. The route (a)
  and (b) runners script the same shape, one model request and one tool call, then settle. They do not use question
  1's two-request turn.

### Part B: today's store, the baseline

- **Run.** The coordinator ran `q2/baseline-count.ts` on 2026-11-18, 19:59:03–19:59:12Z, after a frozen root install.
  - It ran under the sandbox, with four variables testcontainers needs on this machine: `DOCKER_HOST` pointing at the
    local colima socket, `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, `TESTCONTAINERS_RYUK_DISABLED=true`
    and `WRANGLER_HIDE_BANNER=true`. Nothing was refused.
  - The runner reset the counter and ran the edge's host test unchanged and alone: exit 0, 8.2 s.
  - It then read the test's database, `native_host_contract_f7b06bea2df6`, the only one counted
    (`evidence/q2-baseline-count.json`; the test's output is in `q2-baseline-test-output.txt`).
- **310 statements**, all in that database:

| Part | Statements | How it was separated |
|---|---|---|
| The test's setup and assertions | 17 | By text: `host-integration-test/postgres.ts:16-28`, `default-host.test.ts:11-50` |
| Two history GETs | 8 | Both GETs' ownership check (`views/history.ts:19`), 2. The first GET's six storage reads: three `getValue`, two `scanValues`, one `scanBranch` (`history.ts:41-58`, `history-operations.ts:7-14`). The second GET answers 404 after its ownership check. |
| **The turn** | **285** | The rest |
| — the Pi session store (`pi_*`), with its 16 commits' `BEGIN` and `COMMIT` | **199** | `relations`. 16 commits: 16 `SELECT next_seq … FOR UPDATE`, 16 `UPDATE pi_sessions`. |
| — business tables (admission, quota, settlement, sessions, usage), with 9 transactions' `BEGIN` and `COMMIT` | 77 | `relations`. 25 transactions in all. |
| — Prisma's contract check: three client constructions, three statements each | 9 | `information_schema` and `prisma_contract.marker` |

- **Today's commit costs about 9.25 statements** (`packages/pi-session-neon/src/commit.ts:39-51`,
  `session-stats.ts:14-28`):
  - `BEGIN` and `SELECT next_seq … FOR UPDATE`;
  - a validation `SELECT` on `pi_records`;
  - the writes, one statement each: 36 over the 16 commits;
  - an ORM pre-select of `pi_sessions` and the `UPDATE pi_sessions`;
  - the session-stats aggregate, then `COMMIT`.

  148 of the store's 199 statements are its 16 commits; 50 are reads outside commits, and 1 creates the session.
- **Like for like.** The turn is cold: a fresh object, one model request answering through the `respond` tool, and
  settlement.
  - Each route's Pi-store statements are compared with the 199.
  - The business tables (77) are our own layers, which the migration keeps. They are reported, not compared.
  - The comparison is in statements, never in time: the test database is reached over TCP, while production's Neon
    driver uses only WebSocket.

### Route (b′): a Neon backend for pi-durable's `Storage`, with our own wake (part B)

Part A chose this route ([above](#part-a-the-route-decision)): the host calls `Harness.open` on the backend itself and
owns the wake. b2–b4, written for `PiHarness` on the backend, were not run.

**The backend** (`prototype/q2/pg-storage/`, 873 lines):
- It is a port of `SqliteStorage` (`@earendil-works/pi-durable@1.5.2 dist/storage/sqlite/`, about 1,200 lines of JS),
  query for query, over `pg`, with one change: `session_key` leads every key (`schema.ts`). Each `SessionAgent` thus
  has its own keyspace in shared tables.
- Records stay JSON text: `jsonb` would refuse `\u0000` and lone surrogates and reorder keys.
- A commit is four statements, whatever its number of batches (`commit.ts`):
  1. `BEGIN`;
  2. one state read. It locks the keyspace's metadata row `FOR UPDATE` and reads every claimed id, touched document,
     delta's latest version and created address. Durable's checks then run in memory, SQLite's line for line;
  3. one write statement of data-modifying CTEs, the metadata included;
  4. `COMMIT`.

  A copy (a fork) adds a flush and a read.
- One connection per open storage, and every call is serialised on it, so no read runs inside an open commit
  transaction. The `FOR UPDATE` also serialises a second process on the same key; pi-durable's own storages leave that
  to the host.
- Ids are minted in memory from `next_id`, which each commit persists, as in SQLite.
- It runs unchanged in Node and in workerd at the edge's date and flags. There `pg` connects through pg-cloudflare's
  `cloudflare:sockets` (`pg@8.23.0 lib/stream.js`).

**The host** (`prototype/q2/b-prime/host.ts`, entry `q2/b-prime.worker.ts`). It is an Agents SDK `Agent`, as
`SessionAgent` is, keyed by its name (the session id), reached through `getAgentByName` and RPC.
- It opens `PgStorage` under its own `application_name` and calls `Harness.open` on it.
- It owns the wake:
  - an interval heartbeat in `onStart`, today's pattern (`session-agent.ts:52`);
  - a one-shot `schedule(0, "wakeSession", …)` before Pi is handed an input (`session-agent.ts:141`, `:224-228`);
  - Pi's `onWake` re-arming that one-shot for an active Session or a sleep;
  - `wakeSession`, which calls `resume()` and waits while `pi.wake()` is active, as `PiHarness`'s `_waitWhileActive`
    does.

  Scheduling stays paused after `Harness.open` until `resume()` (`dist/harness/types.d.ts:830-835`), so after a restart
  only `wakeSession` moves a turn.

| Case | Result | Evidence |
|---|---|---|
| b0 | Part A: 32 of 32 on `MemoryStorage`; its negative control catches two defective storages | `q2-b0-conformance.txt`, `q2-b0-negative.txt` |
| b1 | **Pass**: 32 of 32 on the test Postgres, through the same adapter and loop, nothing skipped or changed, in one database with a fresh key per case. Plus two keyspace tests: two keys holding the same ids, request id and root each read back only their own; two storages on one key collide. One defect was found and fixed: calls after `close()` threw synchronously instead of rejecting. | `q2-b1-conformance.txt` |
| b′1 | **Pass** (9 checks): two objects, same ids, one turn each at the same time; the negative control collides | `q2-b-prime-isolation.json` |
| b′2 | **Pass** (11 checks): our own wake finishes the interrupted turn, safe and unsafe | `q2-b-prime-wake.json` |
| b′3 | A cold one-request turn: **56** statements, against today's 199 for the Pi store | `q2-b-prime-count.json` |

**b′1, isolation.**
- Two objects, `iso-a-…` and `iso-b-…`, each with its own keyspace and both with root conversation 1, submitted under
  the same operation id `op-iso` at the same time. Each turn started before the other ended. They ran faux at
  50 tokens/s with long answers, on question 1's resolve-then-answer turn.
- Each settled `done`, and each `messages()` holds only its own user message and answer. Every row of each keyspace
  belongs to its own turn: the other title appears nowhere.
- The same ids sit side by side: both keyspaces hold the same entry ids, root conversation 1, and one submission with
  request id `op-iso`. Each has 35 rows.
- No row was written by the other object. No transaction id appears in both keyspaces' row versions (`xmin`), and
  each keyspace's rows come from 7 transactions.
- Negative control: two objects on one session key (`shared-…~a`, `shared-…~b`) collide. The second object's
  submission is gone (`settled: null`), and its `messages()` show the first object's turn.

**b′2, our own wake.**
- Question 1's eviction, on a safe and an unsafe class. Before restarting, the runner read Postgres from Node: the
  submission was `placed` with no tool result, and the killed process's backend had left `pg_stat_activity` 80 ms
  (safe) and 108 ms (unsafe) after the kill. So the crash point landed where intended.
- On B, with no request sent:
  - a new instance was constructed and opened Pi;
  - the SDK ran the one-shot `wakeSession` job (payload `{ wake: "pi" }`), which resumed Pi;
  - then came the tool's rerun (safe) or the interrupted result (unsafe), and the answer, 29.2 s (safe) and 29.6 s
    (unsafe) after the kill.
- The two sessions are named `wake-safe` and `wake-unsafe`, with no random suffix: each run has a fresh database and a
  fresh persistence directory (`run/pg-workerd.ts:39-40`), so the names need no suffix to stay unique. A suffix in the
  logged `key` read as a credential to gitleaks' `generic-api-key` rule and blocked the commit.
- What woke it:
  - the one-shot was running when A died;
  - Lifecycle keeps a job's row until its callback returns, and arms a deadman alarm 30 s ahead before driving due
    jobs (`dist/lifecycle-v1rKHV2C.js:445`, `:589-609`, `:343-359`);
  - a one-shot is not single-flight (`dist/scheduler-FIHv2-kJ.js:546`), so the deadman re-drove it on B.
- Safe: two catalog calls. Unsafe: one, and the model answered from the interrupted result.

**b′3, statements per turn** (the object's own connection only; no other application wrote in the database):

| Turn | Statements | Commits (4 statements each) | Reads | Open |
|---|---|---|---|---|
| Cold, one request answering through `respond` (the baseline's shape) | **56** | 10 | 15 | 1 |
| Warm: the same shape, the session's second turn | 37 | 9 | 1 | 0 |
| An idle wake (the one-shot with nothing to do) | 0 | 0 | 0 | 0 |
| Cold, the same shape, the answer streamed at 50 tokens/s (about 2.2 s) | 72 | 14 | 15 | 1 |
| Cold, question 1's two-request turn | 68 | 13 | 15 | 1 |

- Against today's 199 for the cold turn's Pi store, 56 is under a third. The cold reads are Pi opening its stored
  state: the root conversation, documents by address, the newest entries, the request index and a scan of unsettled
  submissions (the rows are in the evidence).
- Progress persistence costs about one commit per second of streaming: 4 commits (16 statements) for a 2.2 s answer
  (`settings.progress.persistWithinMs`, 1,000 ms, `types.d.ts:1023-1032`). The baseline's model answers in one chunk; a
  real answer streamed for N seconds adds about 4N statements.
- An idle wake costs nothing: Pi's `wake()` and `resume()` are in memory.
- Business statements are not in these counts. They belong to our layers (admission, quota, settlement), the same in
  every route.

**The wake we would own, sized.**
- The prototype's wake is about 45 lines of `host.ts`: the heartbeat, the one-shot before each input, `onPiWake`,
  `wakeSession` and its wait loop.
- `PiHarness`'s own wake is about 175 lines (`index.js:141-170`, `:325-421`, `:436-482`). It handles four things the
  prototype does not:
  - a wake whose open fails, with a backoff up to 10 minutes, stored across restarts;
  - memory-limit resets;
  - a wait longer than one alarm's budget;
  - returning the job at once while tracking the wait (`trackAlarmWork`), so a turn longer than the 30 s deadman is
    not re-driven. The prototype's wait holds the job, so a turn longer than 30 s would be re-driven and would join the
    wait.
- Miniflare does not evict an idle object, so a wake that returned right after `resume()` would also pass locally. The
  kill tests prove the restart path, not eviction while idle.
- The edge already has the scheduler wiring (`session-agent.ts:52`, `:141`, `:146-160`, `:224-231`). The change is
  `wakeSession`'s body (resume Pi, wait while active, then the business scans it runs today) and `onWake`.
- Under (b′) the host also owns the three calls `PiHarness` would have provided: Pi's `submit` with a `requestId`,
  `harness.submission(id).wait()` and `abortSubmission()`.
- Estimate: M (one to two lane days) for the production wake and its tests, inside the edge-host ticket.

### Route (a): `PiHarness`'s SQLite, projected into Neon

Pi's store is authoritative, and the Postgres row is its projection. Crash points are SIGKILLs of workerd at a marker;
the runner sends no request until recovery has run. Commands: `sandboxed node run/route-a.ts --crash all`,
`--case isolation`, `--case count`.

**How it was built** (`prototype/q2/route-a.worker.ts`):
- `PiHarness` is hosted as in question 1, on its own SQLite store.
- Each turn Pi settles `done` is projected into `proj_turns`, keyed by `(session_id, seq)`: the session id the host
  stores, and Pi's submission id.
- The projection is recomputed from Pi's entries in the operation's own range: model, provider, per-call usage, tool
  calls and results, answer, status.
- **When it runs.** Inside `PiHarness`'s own wake job, after the step that finds Pi idle returns nothing, so that the
  job would complete. A subclass overrides `onJob` (`agents@0.33.0 dist/harness/pi/index.js:144-154`); the step is
  `_wakeStep` (`:360-381`).
  - The job has not completed while it projects, so a kill anywhere in the projection leaves it in Lifecycle's queue.
    After the restart it ran again, and that run re-projects the turn ([what drove recovery](#route-a-recovery)).
- A local note in the object's SQLite records each projected turn. The insert does nothing if the row exists, so a
  re-projection writes nothing twice.
- The write is `BEGIN`, `INSERT … ON CONFLICT DO NOTHING`, `COMMIT`, with crash markers:
  - a1, before it;
  - a2, before `COMMIT`;
  - a3, after `COMMIT` and before the note.

| Case | Result | Evidence |
|---|---|---|
| a1: after Pi's commit, before the write | **Pass**. No row before the restart; after recovery with no request, one row equal to the projection recomputed from Pi's store. Recovered 30.1 s after the kill. | `q2-route-a-crash-all.json` |
| a2: during the write | **Pass**. The transaction held before `COMMIT` rolled back with the connection, so there was no row; recovered as in a1, 30.0 s after the kill. | same |
| a3: after the write, before the note | **Pass**. The row had committed and the note was missing. The re-projection's insert found the row, so nothing was written twice, at the write's 3 statements. 30.0 s. | same |
| a4: two objects | **Pass**. Same operation id and same seq in both; each history, read by session id, holds only its own turn. | `q2-route-a-isolation.json` |
| a5: cost | **3 statements per turn** (`BEGIN`, the insert, `COMMIT`). The projection is 423 bytes for the one-request turn and 918 for question 1's turn. Measured at a3, re-projecting a turn costs the write's 3. A scan that finds nothing pending costs no Postgres statement, by construction: it reads only Pi's store and the note, both in the object's SQLite. | `q2-route-a-count.json` |

<a id="route-a-recovery"></a>

- **What drove recovery.** All three recoveries took about 30 s, and the runner sent no request.
  - Before driving due jobs, Lifecycle stores an alarm 30 s ahead (`dist/lifecycle-v1rKHV2C.js:594`). A had stored
    that alarm before it was killed.
  - B's object was constructed when that alarm fired: at a1, 30,075 ms after A's first log line, with A's job
    dispatched at 81 ms. The wake job then ran at once, and the projection landed 86 ms after the construction.
  - How B released the job A left marked running is not shown. B's log has neither of the lines Lifecycle prints for a
    running single-flight job, "Skipping job …" and "Forcing reset of hung job …" (`:601`, `:604`).
  - One candidate is PiHarness's open: it re-pushes the wake job when `pi.wake()` asks for one (`_wakeFor`,
    `index.js:350-353`), and a push clears the running flag (`lifecycle-v1rKHV2C.js:239-249`). Not confirmed.
- **Statements per turn.** 3 against today's 199 for the Pi store. It could be 1: the explicit transaction exists only
  to hold a2's marker.
- **What the count does not see.** Pi's own writes go to the object's SQLite. After one turn the object's database was
  147,456 bytes (whole pages; the same after question 1's turn).
- **The second copy.** The Postgres row repeats what Pi's SQLite holds, which the standing decision that the complete
  record lives in Neon did not foresee (spec, "方案"). The row holds the fields the card compares, not the full
  transcript, which stays in the object.
- **C1–C4 for route (a): not run.** Designing them turned up one finding: `PiHarness`'s wake resumes only what Pi has
  stored.
  - `submit` pushes the wake job and then hands the input to Pi (`_admit`, `index.js:325-338`). Each wake step resumes
    Pi and waits while Pi is active (`_wakeStep`, `:360-381`).
  - An operation admitted in Neon whose `submit` never ran (C1) or never committed (C2) is in no store `PiHarness`
    reads. Its wake finds Pi idle, and nothing resubmits the operation.
  - So a route (a) `SessionAgent` would keep a scan of its own for admitted operations: today's interval scan
    (`session-agent.ts:52`), beside `this.lifecycle.use(harness)`. Route (a) therefore owns part of a wake too.

### Admission against Pi's commit (C1–C4): route (b′) passes

One case per crash point, each a SIGKILL at a marker and a restart with no request. This mirrors today's
`workers/edge/host-integration-test/persistence-windows.test.ts` and `agent-db-test/recovery-scan.test.ts`. Command:
`sandboxed node run/b-prime-admission.ts --crash all` (or one point). All 17 checks pass
(`evidence/q2-b-prime-admission.json`).

**The layers under test** (`q2/b-prime/business.ts`, `host.ts` with `business`):
- Admission in front of Pi, in today's order (`session-agent.ts:134-143`): the admission row commits first, then the
  wake is armed, then Pi gets the input under the operation id.
- On every wake, the recovery scan (today's pattern, `session-agent.ts:146-160`):
  - an admitted operation that Pi has no submission for is submitted again under its id;
  - after the wait, an admitted operation that Pi has settled is settled. Settlement writes the charge and marks the
    admission settled in one statement, inserting at most once.
- The charge is the usage inside the operation's own entry range, from its placed input to its answer (`charge.ts`).
- The interval scan is shrunk to 2 s, as the edge's lane shrinks it (`FAST_RECOVERY_SCAN`).

| Point | Where the kill landed, proven from Postgres before the restart | Recovery, with no request | Settled after the kill |
|---|---|---|---|
| C1: after the admission commit, before `submit` (and before the wake is armed) | Admission `admitted`; no Pi submission; nothing settled | The scan submitted it again under its id; Pi ran it; settled | 2.1 s |
| C2: during `submit`: Pi's commit held before its `COMMIT` | Admission `admitted`; no submission and no entry: the held transaction rolled back with the connection | As C1 | 2.0 s |
| C3: after Pi's commit of the submission, before anything else (the next commit held) | Admission `admitted`; one submission; no tool result; nothing settled | No resubmission; Pi resumed the placed input; settled | 1.9 s |
| C4: after Pi settled, before settlement commits | Admission `admitted`; the submission `done`; nothing settled by us | No resubmission; settled | 30.2 s |

- Every point ends aligned: the admission is `settled`, Pi has one submission (`done`) with one user entry, and there
  is one settlement row.
- No double charge: each settled once (`banked` 1), charging exactly the operation's own usage (190 faux tokens),
  recomputed by the runner from the stored entries.
- In every case the killed process's two connections, Pi's and the business one, had left `pg_stat_activity` before
  the restart.
- The recovery time depends on where the kill falls, as in question 1:
  - about 2 s when the last alarm's re-arm, to the next 2 s scan, was durable;
  - about 30 s when the kill fell inside a running job: the job waits for Lifecycle's 30 s deadman alarm
    (`dist/lifecycle-v1rKHV2C.js:445`, `:594`) and its 30 s hung timeout (`:192`, `:599-605`). At C4 it fell inside
    the interval job; B's workerd log says "Forcing reset of hung job … (started 30s ago)".
  - An earlier run of the same four cases, on the host before its last opt-in additions, took 32.2 s at C1, 3.8 s at
    C2 and C3, and 30.6 s at C4, charging 126. Its output was overwritten by the recorded run.
  - Its 32.2 s at C1 fits neither case above: that kill was not inside a job. B started exactly 30 s after A's last
    alarm began, which is consistent with that alarm's 30 s pre-arm being the stored one, its re-arm about 50 ms before
    the kill not yet durable. Not confirmed.
- Route (a) was not run against C1–C4: see [route (a)](#route-a-piharnesss-sqlite-projected-into-neon).

## Question 3: business layer

One minimal prototype per semantic difference, each naming the layer of ours that covers it.
- Pi's side runs in workerd on the object's SQLite, as in question 1, with no container.
- Each case runs as `sandboxed node run/q3.ts --case <name>`. The worker is `prototype/q3/q3.worker.ts`, with its
  cases in `q3/q3-cases.ts`; the runner side is `run/q3.ts` and `run/q3-cases.ts`.
- Cases that call our real settlement or admission tables are marked **[container]**; they are part B's.

### Part A results

All 50 checks across the seven cases pass (`evidence/q3-<case>.json`; console output in `q3-<case>-run-output.txt`).
Figures quoted below are the recorded run's. Each one that a check bounds is given with that bound.

| Case | Result | Provider | Covering layer of ours |
|---|---|---|---|
| `admission` | **shown** | faux | Admission in front of `submit`: same id with another digest → 409 (`workers/edge/src/agent/admission/request-intent.ts:7-22`) |
| `budget` | **shown** | faux, 40 tokens/s; the aborted frame is faux's own | The host's turn budget (`workers/edge/src/agent/host/turn-budget.ts`, `turn-deadline.ts:13`), re-pointed at Pi's placed entry and `abort(operationId)` |
| `stream` | **shown**; the compaction boundary too | faux, 50 tokens/s | The stream projection and reconnect (`workers/edge/src/agent/views/watch-response.ts`, `snapshot-view.ts`, `message-chunks.ts`), re-pointed at `watch()` |
| `replay` | **shown**: no rerun, one reservation, nothing billed by Pi | faux | The tool's `execute`, where authorization and the reservation run (`packages/agent/src/tool-context.ts:22-27`) |
| `validation` | **no difference from today** | none: both validators called directly | None needed |
| `restart` | **shown** (three kills) | faux, 20 tokens/s | Settlement refunds for unanswered operations (today's `recovery-endings.test.ts`); settlement also decides how an aborted entry inside an operation is charged |
| `web-results` (brief item 4) | **shown** | faux; the retryable error is a scripted 503 frame | A `beforeRequest` hook in the last selected extension: synchronous, fail-closed (today's design) |
| `settlement` (part B) | **shown** | the ported double only | Settlement (`workers/edge/src/agent/settlement/settlement-accounting.ts:34`), re-pointed at the operation's own entry range |
| `selection` (part B) | **shown** | none for the selection | Admission plus the selection intent |

### Provider evidence

- **Abort frames: faux.** pi-ai 1.5.2's `fauxProvider` emits an `aborted` error frame when the signal aborts between
  deltas (`@earendil-works/pi-ai@1.5.2 dist/providers/faux.js:233-288`), which needs `tokensPerSecond`. `budget`'s
  aborted answer is that frame.
  - The aborted entries in `restart` are not frames. They are Pi converting the partial it had stored before the kill
    (`@earendil-works/pi-durable@1.5.2 dist/harness/generation.js:346-384`).
- **Streaming usage: faux, and it misleads.** Faux computes the whole answer's usage estimate before it streams
  (`faux.js:356`), and the partial carries it from the first frame (`:234`).
  - So `restart`'s aborted entries carry the whole answer's 154 output tokens after 144 and 152 of 613 characters had
    streamed.
  - What a real provider's partial carries as usage at the moment of a crash depends on when its adapter sets usage.
    Part B's `settlement` ran the double with usage only in its final frame: its aborted entry carries zero. pi-ai's
    Anthropic adapter sets input usage at the stream's start, so it would not ([`settlement`](#settlement-part-b)).
  - 0.87.1 records such an interrupted request with zero usage (`@earendil-works/pi-agent-core@0.87.1
    dist/harness/runtime/drive/recovery.js:4-26`).
- **4xx and usage only when asked: part B, on the ported double.** Faux reports every response as status 200
  (`faux.js:364`) and turns a throw into an error frame (`:395-399`), so it cannot throw a 4xx out of the adapter.
  - Part B ported the hand-written double (`workers/edge/test/doubles/pi-provider-double.ts`) to pi-ai 1.5.2's
    provider interface (`prototype/q2/b-prime/double.ts`, through `createProvider`).
  - The port keeps the original's three behaviours: usage only when asked (`:58-70` there), a 4xx thrown out of the
    adapter (`:202-210`), and the `aborted` frame on the signal.
  - It adds two: an error frame carrying usage, and a slow answer whose usage arrives only in its final frame.
  - `settlement` produced all its evidence with the double; faux is not used there.
- **Retryable errors.** `web-results` uses a faux error frame whose message, "503 service unavailable", pi-ai's
  classifier treats as retryable (`@earendil-works/pi-ai@1.5.2 dist/utils/retry.js:29-43`).

### `admission`

- **`PiHarness`, raw.** A second `submit` under one `operationId`, with other content, gets `accepted: false`, and Pi
  answers only the first ("Answer to: A").
- **pi-durable 1.5.2, re-read and run.** A known `requestId` returns the existing submission without comparing content.
  A submission of another type under it throws (`dist/harness/submissions.js:173-180`): the write under `op-raw` was
  rejected with "Request op-raw already identifies a submission of type input".
- **The covering layer, prototyped.** `admit` in `q3/q3-cases.ts` is shaped like `request-intent.ts:12-22`:
  - the same id with other content answers 409;
  - the same id with the same content is the existing admission, and its receipt says `accepted: false`;
  - the admission row is committed before Pi sees the input, as today (`request-intent.ts:24`).
- **Result.** Pi placed A and C only, and the faux model ran twice: B and D never reached it.

### `budget`

- **Pi has no turn deadline, so the host cut the turn.** The host read the start from Pi and aborted at start plus
  2,000 ms.
  - In the recorded run, the timer fired 2 ms late (the check allows 0–250 ms), and `abort(operationId)` returned
    `true`.
  - The answer had streamed 288 of 1,065 characters (the check: some, not all). The stored answer is `aborted` and
    partial.
  - The operation settled `unanswered`, reason `aborted`, and `pi.live.runFailure.reason` is `aborted`.
- **The start is the placed `pi.user` entry's `timestamp`.** Pi stamps it when it places the input
  (`dist/harness/inbox.js:76-81`); in the recorded run, 2 ms after the host's submit (the check: within 1 s). No other
  field holds a run's start:
  - `SubmissionRecord` has no time field (`dist/types.d.ts:451-538`);
  - `pi.live.run` has none either: at the abort its fields were `taskId`, `inputs`, `turns` and `first`
    (`dist/harness/live.d.ts:112-132`);
  - a task's `startedAt` (`types.d.ts:659-664`) belongs to one generation task, and the run hands over from task to
    task.
- **Today's layer.** `turn-budget.ts:36-48`, hooked at `session-agent.ts:269`, caps each model request's timeout at
  the budget left. It counts that budget from the operation's durable start, and expires the turn at a request
  boundary once it is spent. With pi-durable, the start becomes the placed entry and the cut becomes
  `abort(operationId)`.
- **Two duties the layer takes on.**
  - On a placed submission, `abort(operationId)` aborts the whole conversation's run (`agents@0.33.0
    dist/harness/pi/index.js:268-273`), which also withdraws queued inputs (pi-durable `README.md:727`). That is
    harmless while admission keeps one unresolved turn per session (`request-intent.ts:16-17`).
  - The timer lives in memory. After an eviction, the host must re-arm it from the stored start. Not shown in part A.

### `stream`

- **What `watch()` delivers.**
  - The first value is the newest 50 of the 60 seeded entries, with `before` set.
  - Each later change carries Chord ops on the view: `["s", path, value]`, `["a", path, text]` and `["d", path]`. The
    streaming answer arrives as `"a"` appends to `docs.pi.live.generation.message.content.0.text`.
  - Before the second watcher attached, the first had received five changes. In the recorded run, three of them
    carried the growing partial: 16, 56 and 92 characters (the check: at least three, never shrinking).
  - The second watcher, attached mid-answer, started with the partial so far as state (92 characters; the check: more
    than none). It got none of the earlier deltas, and received fewer changes.
  - Both watchers ended on the same view.
- **The operation's end.** It is the change that deletes `docs.pi.live.run` and `docs.pi.live.generation`. In this
  run, that same change appended the answer entry. `watch()` has no run-end or fault event.
- **Compaction.** One manual compaction showed first as `docs.pi.live.compactions` (trigger `manual`), then as a
  `pi.compaction` entry appended in place. Its `head` was the id of the answer entry, the last entry the summary covers
  (130 in the recorded run; not a check).
- **The covering layer, re-pointed at `watch()`.**
  - The first value replaces today's snapshot restore (`watch-response.ts:45-55`).
  - The ops on `pi.live.generation` become the text deltas that `message_update` events give today.
  - The end of a run becomes the change that deletes `pi.live.run`; today it is `run_end` or `fault` (`:70`).
  - One operation's entries are picked by its submission's `entry` and `answer` ids, because the window is
    conversation-wide. Today, `restoreMessages` picks them from the lane snapshot with `operationView`
    (`watch-response.ts:8`, `:46`).
- **A late re-attach starts from the current view in both.** Today's reconnect restores the snapshot and the
  streaming message (`watch-response.ts:45-55`). The granularity differs: Pi commits partials at most every 100 ms,
  and commits that land while a listener runs arrive folded into one change (pi-durable `README.md:525-527`).

### `replay`

- **The experiment.** `translate_anime_title` on `replay: "unsafe"`, with workerd SIGKILLed while its catalog call was
  held.
- **On workerd B:**
  - no `tool:start`, one catalog call, and one reservation, made inside `execute` before the kill;
  - the model received `<harness>[error] Tool translate_anime_title was interrupted and may have partially
    run</harness>` and answered from it, and the operation settled `done`;
  - `pi.usage()` has no `translate_anime_title` entry under `tools`: Pi bills the interrupted call nothing, and the
    reservation, ours, happened once;
  - recovery took about 29 s, question 1's heartbeat path.
- **Control for the billing check.** The same tool completing without interruption, on another object, is billed
  under `tools` with its 10 tokens, after one reservation (`control` in the evidence). So the missing entry above is a
  real zero, not a key that never appears.
- **The mapping.** The six `"safe"` tools stay `"safe"`: question 1 showed the rerun with `resolve_anime`. For an
  interrupted call, pi-durable's `"unsafe"` gives the outcome today's `"never"` gives: today's
  `translation-interruption.test.ts:34-39` asserts the same counts.

### `validation`

**No difference from today, for the inputs run.**
- **The experiment.** One schema object per tool, built with typebox 1.3.32 exactly as `packages/agent/src/<tool>.ts`
  builds it, goes to two validators (`q3/validation.ts`):
  - pi-ai 0.87.1's `validateToolArguments`, today's path: `Value.Convert`, then coercion
    (`@earendil-works/pi-ai@0.87.1 dist/utils/validation.js:280-301`);
  - pi-ai 1.5.2's, which pi-durable's tool task calls (`dist/harness/tool.js:261`) and which takes any JSON Schema
    (`@earendil-works/pi-ai@1.5.2 dist/utils/validation.js:40-48`).
- **Results, 9 rows.**
  - A number sent for each of the seven tools' eight string properties reaches `execute` as `"42"` under both.
  - `"500"` sent for `search_nearby`'s integer `radius_m` reaches it as `500` under both.
- **This refutes phase 1.** Phase 1 called coercion a semantic difference ([question 1](#abortsignalany-typeboxs-new-function-timers)).
  Today's path coerces the same way, before `execute`.
- **Covering layer: none needed.** Phase 1 named "the tool's own oRPC/Zod validator inside `execute`". But a tool's
  `execute` validates nothing itself (for example `resolve-anime.ts:13-17`). The oRPC validation runs in the client
  the tool calls: the catalog client validates requests and responses against the shared contract
  (`packages/agent/src/catalog-client.ts:23`). Under both versions it sees the arguments after coercion.
- **Side finding.** pi-durable 1.5.0's changelog says `ToolRegistration` takes any JSON Schema, TypeBox's included
  (`CHANGELOG.md:27`). So porting the seven tools' schemas to pi-schema is optional, and question 5's "pi-schema
  parameters" item may shrink. Not re-estimated here.

### `restart`

Three kills, each with no request sent after it:

- **No retry left** (`settings.retry.maxRetries: 0`).
  - The kill came 2.5 s into a streamed answer.
  - On workerd B there was no model request. The stored partial, 144 of 613 characters, became an aborted entry.
  - The run ended `unanswered`, reason `interrupted` ("The host stopped while the model was answering, on attempt 1"),
    and `onReport` received `task_interrupted`.
- **Retry left** (the default: three retries, first backoff 2,000 ms; `retry.js:114-118`, pi-durable
  `dist/harness/agent.js:4-9`).
  - On workerd B, the one model request came 2,063 ms after the instance started in the recorded run, not at once
    (the check: at least 1,950 ms).
  - The retry answered after the aborted partial.
- **Restart limit lowered to 1** (default 5; `agent.js:36-40`).
  - A replay-safe `resolve_anime` cut off once was not run again: "Tool resolve_anime was interrupted once; it is not
    run again".
  - It was reported as `task_interrupted`, reason `restart_limit`, and the model answered.
- **Today, read and not run.** 0.87.1 settles a request in flight at a crash from its committed frames "without
  another provider call", as an error message with zero usage (`recovery.js:4-55`). It then waits for the backoff
  while attempts remain, and otherwise fails the operation (`response.js:193-208`). That is the same no-resend
  semantics.
- **The difference, for part B's `settlement`.** pi-durable keeps the partial as an aborted entry with its usage;
  0.87.1 records zero. An operation charge drawn from the operation's entry range would include that aborted entry.

### `web-results`: the per-request rebuild of stored web results

Today, a context handler rebuilds each stored `web_search` result before every model request. It is registered last,
because 0.87.1 carries the previous messages past a handler that throws (`packages/agent/src/native-context-hooks.ts:10-20`
and `rendered-web-results.ts:28-31`, at 804b582e0).

- **The seam exists: `GenerationTask`'s `beforeRequest` hook.**
  - It runs "Before every request attempt, including recovery; the result is used for that request only"
    (`@earendil-works/pi-durable@1.5.2 dist/harness/types.d.ts:908`).
  - It has one call site, `generation.js:141-147`. The hooks are chained in the order of the conversation's selected
    extensions (`agent.js:187-196`); by default that is every installed extension, in install order (`README.md:243`).
- **When the seam throws, the model receives the messages from before that hook.** pi-durable reports the throw
  (`extension_error`) and skips it, leaving `messages` as they were (`scheduler.js:2482-2496`). 0.87.1's
  `transformContext` does the same (`@earendil-works/pi-agent-core@0.87.1 dist/harness/hooks.js:133-153`).
- **Prototype.** Two extensions: `status`, whose hook always throws, then `web-render`, the synchronous rebuild.
  - The rebuild ran on all 5 model requests over 3 turns: hook calls = faux calls = 5.
  - It read `details` from the stored tool-result message, where Pi keeps them (`dist/harness/tool.js:852-865`).
  - After the tool, and on turn 2's failed 503 attempt and its retry, the model received the rebuilt text.
  - With the rebuild throwing (turn 3), the model received the stored text, and the throw was reported.
  - The transcript keeps the stored text: the rebuild changes the request, not the record.
- **Covering layer: today's design carries over unchanged.** The rebuild is synchronous, never throws (it fails
  closed to a fixed notice), and runs last.
  - "Last" now means the last selected extension. A conversation's `configure({ extensions })` can reorder or drop
    it, so our layer must keep the rebuild's extension last in every conversation's selection.
- **Not covered in either version: compaction's summary request.** It does not pass through the seam:
  - pi-durable's `beforeRequest` has only the one call site, in generation;
  - 0.87.1's compaction calls `models.completeSimple` directly, outside `transformContext`
    (`dist/harness/compaction/compaction.js:69-72`, `runtime/drive/structural.js:629`; read, not run).

  So stored web text reaches a summarizer in both, and the move changes nothing there.

### `settlement` (part B)

**Question.** `harness.usage()` is the whole session's running total, and it counts failed and aborted attempts
(`@earendil-works/pi-durable@1.5.2 README.md:855-861`). We bank only completed turns, each by its own range. The case
shows four things:
- how one operation's charge is derived;
- that two completed turns are each charged only their own usage, with failed and interrupted attempts between them;
- what pi-durable records for an interrupted attempt;
- that the charges and the uncharged attempts add up to `usage()`.

**Method** (`run/q3-db.ts --case settlement`; 10 checks pass, `evidence/q3-settlement.json`). Route (b′) with its
covering layers, on the ported double (no faux). One session runs six operations through admission:
1. `op-1`, a completed turn: `translate_anime_title`, whose result reports 10 tokens, then the answer. The double reports
   2 tokens per model call.
2. `op-2`: the double throws a 4xx out of the adapter.
3. `op-3`: the double sends a failed attempt as an error frame that reports usage.
4. `op-4`: an answer streamed for 4.5 s, whose usage arrives only in its final frame.
   - workerd is SIGKILLed 2.5 s in. Before the restart, Postgres held the streamed partial: a progress commit.
   - With no request, the restarted object resumes; Pi retries after its backoff, and the turn completes.
5. `op-5`: a second completed turn, like op-1.
6. `op-6`: a completed turn after the session's model is switched to one whose compat does not ask for usage.

**The charge** is the usage of every model call and every tool result in the operation's own entry range, from its
placed input to its answer (`q2/b-prime/charge.ts`). An operation Pi settles `unanswered` banks nothing. The spike
measures; it does not choose this rule.

| Operation | Pi settled | Charged (tokens) | Inside its range |
|---|---|---|---|
| op-1 | done | 14 | two model calls (2 each) and the tool's 10 |
| op-2, 4xx thrown | unanswered | 0 | an error entry with zero usage: "400 Bad Request: the gateway rejected the request shape" |
| op-3, error frame | unanswered | 0 | an error entry carrying the frame's 2 tokens, outside every completed range |
| op-4, interrupted then completed | done | 2 | the aborted entry (12 words streamed, zero usage), then the retry's answer (2) |
| op-5 | done | 14 | its own two calls and its tool's 10 only |
| op-6, usage not asked | done | 10 | two model calls reporting nothing, and the tool's 10 |

- **Two completed turns, each charged its own usage.** op-1 and op-5 are 14 each, while `usage()` stood at 42 at the
  end. The second turn did not charge the first again.
- **The identity holds.** `usage()` total 42 = the stored entries' usage, 42 = the charges, 40 + the usage outside every
  completed range, 2 (op-3's error frame).
- **What pi-durable records for an interrupted attempt.** The stored partial becomes an aborted entry carrying whatever
  usage that partial had.
  - With the double, which reports usage only in its last frame, that is zero: the figure 0.87.1 records for every
    interrupted request.
  - An OpenAI-compatible gateway that sends usage after the content would leave the same zero. pi-ai's adapter asks
    for usage only when the model's compat allows (`@earendil-works/pi-ai@1.5.2 dist/api/openai-completions.js:572-574`),
    and sets the partial's usage only from a chunk that carries one (`:349-351`).
  - With faux, whose partials carry the whole answer's estimate from the first frame, it was 154 tokens (part A's
    `restart`).
  - pi-ai's Anthropic adapter fills the partial's input usage from `message_start`, "even if the stream is aborted
    early" (`dist/api/anthropic-messages.js:690-699`). An interrupted Anthropic request would therefore leave a nonzero
    figure.
  - Banking an operation's whole range charges that figure. Whether to is the owner's billing rule.
- **The failed attempts** are error entries in the transcript and in `usage()`, inside no completed operation's range.
  An error frame's usage is counted by Pi and charged to nobody, as today's settlement refunds an unanswered operation
  (part A, [`restart`](#restart)).
- **Covering layer:** settlement, re-pointed from `readOperationCharges(storage, …)`
  (`workers/edge/src/agent/settlement/settlement-accounting.ts:34`) at the operation's own entry range in Pi's entries
  (`charge.ts`), banking at most once (`business.ts`).

### `selection` (part B)

**Method** (`run/q3-db.ts --case selection`; 6 checks pass, `evidence/q3-selection.json`). Route (b′) with its covering
layers.
- A selection is admitted like a model turn (kind `selection`).
- It is handed to Pi as a display-only write under the operation id:
  `{ type: "write", entry: { kind: "animichi.selection", … }, requestId }`. Pi settles that `done` at once.
- Settlement then banks it.

**Results.**
- The first selection was admitted (202) and settled `done` at once, with no model request.
- The same id with the same content: the existing admission (200), and Pi returned the same submission; one selection
  entry.
- The same id with other content: 409 at admission. Pi never saw it.
- Settled through the same settlement: one row, `done`, 0 tokens.
- A model turn after it ran and settled as usual.
- **Not shown: a crash between a selection's admission and its write.** The prototype's recovery scan resubmits only
  model turns (`recoverAdmissions` skips kind `selection`, `q2/b-prime/host.ts:203`). Such a selection would stay
  admitted and never be settled. The production scan must resubmit it as the same write under its id (ticket 4b).

**Covering layer:** admission plus the selection intent, as today
(`workers/edge/host-integration-test/selection-intent-loss.test.ts`). Without our admission, Pi alone would return the
existing submission for other content without comparing it (part A, [`admission`](#admission)).

Compaction is not a difference to cover. In 0.87.1 and in pi-durable 1.5.2, neither compaction hook can replace the
messages being summarised (checked before this phase), so the move neither adds nor removes that capability.

- Our code registers no compaction hook. The only `compaction` in `workers/edge/src`, `packages/agent/src` and
  `packages/eval/src` is a comment, `workers/edge/src/agent/views/watch-response.ts:19`: "A native context snapshot
  stops at compaction; restore the immutable visible branch for old answers."
- The `stream` case recorded how a compaction boundary shows up in `watch()`: as `pi.live.compactions`, then a
  `pi.compaction` entry in place ([`stream`](#stream)).

## Overall: go

The card's rule: go overall only when questions 1 and 3 are go, at least one of routes (a), (b) and (b′) is go, and
questions 4 and 5 are answered.

| Part of the rule | Result |
|---|---|
| Question 1 | **go** (phase 1) |
| Question 3 | **go**: every semantic difference has a covering layer shown by a prototype. The replay mapping is shown by experiment: `translate_anime_title` on `"unsafe"` neither reruns nor is billed twice. Two completed turns are each charged only their own usage. |
| At least one route | **(b′) go**: conformance 32 of 32, isolation, our own wake, 56 statements per cold turn against today's 199, C1–C4 realigned. (a) passes storage and statements, with recovery against admission not run. (b) is out. |
| Questions 4 and 5 | **answered** (phase 1), with question 5 corrected [below](#re-cut-migration-tickets) |

So the spike reports **go**. Choosing to migrate, and choosing a route, are the owner's.

## Re-cut migration tickets

Cut for route (b′), the one route shown go on every criterion; the differences under (a) are noted. Question 5's
answer stands, so the packages cannot land one by one: two pi-ai lines cannot pass values between them. Tickets 1–4
build on one integration branch, and ticket 5 merges it. Sizes: S under a lane day, M one to two, L three to five, XL
more than five.

| # | Ticket | Package | Size | What it carries, from the spike |
|---|---|---|---|---|
| 1 | Neon `Storage` for pi-durable | `packages/pi-session-neon` | **L** | A `Storage` on the repository's driver, after `prototype/q2/pg-storage/` (873 lines over `pg`, a port of `SqliteStorage`). It keeps a `session_key` in every key, JSON text records, and a four-statement commit with the keyspace's metadata row locked `FOR UPDATE`. Its schema goes into the one Prisma chain. Proof: the 32 conformance cases on the test Postgres through the `node:assert` adapter (`q2/conformance-assertions.ts`), the two keyspace tests and the shared-key negative control. The 0.87.1 `NeonStorage`/`NeonSessionRepo` retire with ticket 5. |
| 2 | Agent construction on pi-durable | `packages/agent` | **M–L** (was L) | Seven tools to `ToolRegistration` with `output`. The replay mapping: six stay `"safe"`, `translate_anime_title` goes from `"never"` to `"unsafe"`. pi-durable 1.5.0 takes any JSON Schema object as `parameters`, TypeBox's included (`@earendil-works/pi-durable@1.5.2 CHANGELOG.md:27`), so porting the schemas to pi-schema is optional. The web-result rebuild moves to `GenerationTask.beforeRequest` in the last selected extension. Prompt sections, and pi-ai 1.5 models. |
| 3 | Eval on pi-durable | `packages/eval` | **L** (unchanged) | The in-process task on `MemoryStorage`; prefix record and replay on pi-durable's JSONL storage; the five frozen prefix sessions converted or re-recorded. |
| 4a | Edge host: Pi, our wake, admission, settlement | `workers/edge` | **L** | `SessionAgent` opens Pi with `Harness.open` on ticket 1's storage, keyed by its session id. `wakeSession` resumes Pi and waits while it is active, then runs today's business scans; Pi's `onWake` re-arms the one-shot. Admission commits before Pi's `submit` with a `requestId`; the recovery scan resubmits admitted operations Pi lacks. Settlement banks the operation's own entry range. Proof: the host and DB lanes rewritten as equivalents, b′2's two kills and C1–C4. The production wake is M of this (prototype about 45 lines; `PiHarness`'s own about 175, with backoff, memory-limit resets, waits longer than one alarm, and job hand-off). |
| 4b | Edge host: the views, the budget, selection | `workers/edge` | **L** | The stream projection and reconnect from `watch()`. History from Pi's entries. The turn budget as a host abort from the placed entry's timestamp, re-armed after an eviction (not shown by the spike). Selections as write submissions through admission; the recovery scan resubmits an admitted selection as the same write (not shown: the prototype's scan skips selections). Native models to pi-ai 1.5. Bundle-smoke fixtures. |
| 5 | Integration and cleanup | root config, all | **M** | Catalog: pi-ai and chord 1.5.x; add pi-durable and pi-schema; remove pi-agent-core and the edge's 0.87.1 smoke aliases. `agents` needs no bump (already `^0.33.0`); its four Pi peers at `~1.5.0` follow from the catalog. Merge the integration branch. |
| 6 | Release policy for Pi minors | `docs/ops`, CD | **S** | The owner's decisions below, written into the deploy runbook: following `agents`' supported Pi minor, and roll-forward only after a Pi-minor deploy. |

**Question 5's estimate, corrected by part B:**
- `packages/pi-session-neon`: L for route (b′), confirmed by a working backend that passes the suite unweakened. Under
  route (a) the storage ticket shrinks to M, a projection writer and one table. But route (a)'s edge ticket then
  carries `PiHarness` adoption and still needs today's interval scan for admission recovery.
- `packages/agent`: L becomes M–L, since the pi-schema port is optional.
- `workers/edge`: XL, now split into 4a and 4b (L each); the wake we own is sized at M within 4a.
- Statements: route (b′) cuts the Pi store's statements per cold one-request turn from 199 to 56. A warm turn costs
  37, and an idle wake none.

## For the owner

- **The route.**
  - (b′) is go on every measured criterion.
  - (a) passes storage and statements: 3 Neon statements per turn, but a second copy of each turn and Pi's own writes in
    the object's SQLite. Its recovery against admission was not run.
  - (b) is out: its wake works on another store, but its operation API does not.
- **The billing rule for an interrupted attempt.** The aborted entry inside a completed operation carries whatever
  usage the provider had streamed before the crash: zero for usage in the final frame, nonzero for providers that
  report early. Bank it, or exclude aborted entries?
- **Question 4's policy questions:** follow Pi latest or `agents`' supported Pi minor; and a Pi-minor deploy cannot be
  rolled back by redeploying an older artifact.
- **The spec names `session.events()`**, which `agents` 0.33.0 does not have; question 3 used `session.watch()`.
  Correcting the spec is its owner's call.

## Not done

The go stands on what was shown. These were not shown, and the tickets carry each.

- **Route (a) against C1–C4.** The brief made it conditional on time; part B sequenced the record first and stopped
  there, so this is not blocked by anything found. Its design is under
  [route (a)](#route-a-piharnesss-sqlite-projected-into-neon): the host must be an `Agent` that keeps today's interval
  scan beside `this.lifecycle.use(harness)`, because `PiHarness`'s wake resumes only what Pi has stored.
- **How route (a)'s restarted object released the job left running** ([what drove recovery](#route-a-recovery)).
- **Our wake under a turn longer than 30 s.** The prototype's wait holds the job, so Lifecycle would re-drive it and
  the new run would join the wait ([the wake we would own](#route-b-a-neon-backend-for-pi-durables-storage-with-our-own-wake-part-b)).
  Ticket 4a.
- **Eviction while idle.** Miniflare does not evict an idle object; the kill tests prove the restart path only.
- **The turn budget's timer after an eviction.** The timer lives in memory and must be re-armed from the stored start
  (part A, [`budget`](#budget)). Ticket 4b.
- **A selection admitted but not written** (a crash between the two): the prototype's scan skips selections
  ([`selection`](#selection-part-b)). Ticket 4b.
- **Production's clock.** Local workerd advanced `Date.now()` during synchronous work; production was not checked
  ([question 1](#abortsignalany-typeboxs-new-function-timers)). It matters to the turn budget.
- **A package-by-package path.** An alias build plus a typecheck would show whether one is possible
  ([question 5](#can-two-pi-ai-versions-coexist-in-one-package)). Only if the owner wants to weigh it.
- **Part B's records.** The `docs/iterations/README.md` index line the card's PR carries, and part B's spike-branch
  commit field above. Both are the coordinator's.
