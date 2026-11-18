# pi-durable spike: record (phase 1 and phase 2 part A, 2026-11-18 UTC)

Status: the spike in #1999, the first card of `docs/specs/2026-10-04-pi-durable-migration-spec.md` ("spike（第一张卡）").

- **Phase 1** answered question 1 (Workers, the minimum deliverable) by a recorded workerd run, and questions 4 and 5
  at the desk. It also wrote the exact plan for questions 2 and 3.
- **Phase 2, part A** ran everything that needs no Postgres:
  - the choice between routes (b) and (b′);
  - case b0;
  - question 3's container-free cases, plus a seventh, the per-request rebuild of stored web results;
  - the sandbox refusing sockets;
  - the counting method that part B will use.
- **Part B** runs the Postgres-backed cases: question 2, and question 3's `settlement` and `selection`.

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
| Spike branch and commit | `spike/pi-durable`, created from origin/main at 6c9fb45b6. Phase 1: 608a77efc. Part A: _filled when the coordinator commits and pushes_. |
| Prototype lockfile | `prototype/pnpm-lock.yaml`, SHA-256 `4451ccee2b3a388894fd4a7cfc361e806a34e4d2a8f718ff7acbdc69690298ab` (part A). Phase 1's was `c0a6fed90e136bffd298a76ad30ae085e6dca6cdfe838c461fc65adc7bcc97ed`. Part A added two dev dependencies for the `validation` case: `pi-ai-0871` (`npm:@earendil-works/pi-ai@0.87.1`) and `typebox` 1.3.32 (the repository's catalog version). The lockfile gained 80 lines and changed none: pi-ai and pi-telemetry 0.87.1, `@anthropic-ai/sdk` 0.124.0, openai 6.40.0, typebox 1.3.27 (pi-ai 0.87.1's exact pin, as in the root lockfile, `pnpm-lock.yaml:12290`) and 1.3.32. |
| Criteria per route | [Criteria](#criteria) |
| Overall go or no-go | Not yet decided. Question 1 is go. Question 3's container-free cases each have a covering layer, shown. Question 2 (every route) and question 3's `settlement` and `selection` need the test Postgres (part B). |
| Re-cut migration tickets | Not cut. The card says the tickets are cut from the full report and the owner's decision, which need questions 2 and 3. Question 5 below is their input. |

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
| 2 (a) | After each of three crash points, the Neon record equals the projection recomputed from Pi's store; the two-object case passes; statements per turn are no more than today; recovery is no weaker | **unanswered (part B)**: needs the test Postgres, a container lane | [Question 2](#question-2-storage) |
| 2 (b) | The conformance suite, the two-object isolation case and `PiHarness`'s wake pass on a Neon backend; statements and recovery as above | **not pursued** (part A): with a Storage other than its own, `PiHarness`'s `accepted`, `wait()`, `abort(operationId)` and `sessions.list()` answer from its own empty store, so way 4 holds for its operation calls. The wake on another store was not run. | `evidence/q2-route.json` |
| 2 (b′) | The conformance suite, the two-object isolation case and our own wake pass; statements and recovery as above | **the route part B measures** for a Neon backend. Its conformance control (b0) passes on `MemoryStorage`, 32 of 32, and the suite catches two defective storages. | `evidence/q2-b0-conformance.txt`, `q2-b0-negative.txt` |
| 3 | Every semantic difference has a covering layer shown by a prototype; per-tool replay by experiment (`translate_anime_title` neither reruns nor double-bills); two completed turns each charged only their own usage | **container-free cases shown** (part A): `admission`, `budget`, `stream`, `replay` (no rerun, one reservation, nothing billed for the interrupted call), `validation` (no difference from today), `restart`, and the web-result rebuild. Each names its covering layer. **`settlement` and `selection`: part B.** | [Question 3](#question-3-business-layer) |
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
choice of counting method. Everything marked **[container]** starts or reuses the test Postgres and is part B's.

- Each case names its command, run from `prototype/` with the re-run block's `sandboxed` function.
- The container steps need the owner to run the lane: earlier, a permission check refused a writer a container-starting
  lane.

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
- **Not shown.** Whether `PiHarness`'s wake finishes an interrupted turn across an eviction on a store other than its
  own. `MemoryStorage` cannot show it, since it is lost with the object.
  - The card's acceptance criterion for (b) asks that the wake be shown working on the backend, "or the record shows it
    does not". Not running b3 leaves that clause open. Whether that is acceptable is the coordinator's call.
  - An alternate-prefix SQLite store in the same object could close it without Postgres
    (`openDurableObjectSqliteStorage(ctx.storage, { prefix })`, pi-durable `README.md:877-885`).
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

### Route (b′): a Neon backend for pi-durable's `Storage`, with our own wake (part B)

Part A chose this route ([above](#part-a-the-route-decision)). `SessionAgent` calls `Harness.open` on the backend directly.
It wakes the backend with the Agents SDK scheduler, as the edge does today (`schedule(…, "wakeSession", …)`; the
pattern is in `workers/edge/bundle-smoke/tool-replay-recovery.worker.ts`).

| Case | What it shows | Command |
|---|---|---|
| b0 | Done in part A: the suite's own control on `MemoryStorage`, 32 of 32, with its negative control | `sandboxed node --test q2/conformance-control.test.ts` |
| b1 **[container]** | The Neon backend passes the same suite on the test Postgres, through the same adapter, with nothing weakened | `sandboxed node --test q2/neon-conformance.db.test.ts` |
| b′1 **[container]** | Two-object isolation. Two Durable Objects run a turn at the same time. Both have root conversation `"1"`, and each is opened on the backend keyed by its `SessionAgent` session id. Each `messages()` and each set of rows holds only its own turn, and no row is overwritten (row versions compared). | `sandboxed node run/q2-route-b-prime.ts --case isolation` |
| b′2 **[container]** | Our own wake finishes an interrupted turn on the backend: question 1's two evictions (safe and unsafe, SIGKILL during the tool call) each finish with no request sent | `sandboxed node run/q2-route-b-prime.ts --case wake` |
| b′3 **[container]** | Statements per turn on the backend, by the counting method | `sandboxed node run/q2-route-b-prime.ts --case count` |

- b2–b4, written for `PiHarness` on the backend, are not run.
- The record adds the size of the wake we would own. Under (b′) the host also owns the three calls the route probe
  showed `PiHarness` getting wrong on another store (`accepted`, `wait()`, `abort(operationId)`). They are Pi's
  `submit` with a `requestId`, `harness.submission(id).wait()` and `abortSubmission()`.

### Route (a): `PiHarness`'s SQLite, projected into Neon

Pi's store is authoritative. After Pi commits a completed turn, the object writes that turn's record to Neon, keyed by
`(session_id, seq)` with the `SessionAgent` session id. The write is idempotent, so recovery can rewrite it. Crash
points are injected by SIGKILLing workerd at a marker, and the runner sends no request until recovery has run.

| Case | What it shows | Command (part B) |
|---|---|---|
| a1 **[container]** | Crash after Pi's commit and before the Neon write | `sandboxed node run/q2-route-a.ts --crash before-write` |
| a2 **[container]** | Crash during the Neon write: the object stops at a marker before the transaction's `COMMIT`, workerd is killed, and Postgres rolls back the open transaction when the connection drops. Part A's counting method has no proxy to hold the `COMMIT`. | `sandboxed node run/q2-route-a.ts --crash during-write` |
| a3 **[container]** | Crash after the Neon write committed, before the object notes it | `sandboxed node run/q2-route-a.ts --crash after-write` |
| a4 **[container]** | Two-object case: two objects (both root `"1"`) project a turn at the same time, and each history read by session id returns only its own turns | `sandboxed node run/q2-route-a.ts --case isolation` |
| a5 **[container]** | Statements per turn and bytes per turn of the projection; the cost of the recovery scan | `sandboxed node run/q2-route-a.ts --case count` |

After a1–a3, each completed turn's Neon record must equal the projection recomputed from Pi's store, compared on model,
provider, per-call usage, tool calls and results, answer and status. Route (a) keeps a second copy of the record,
which the standing decision that the complete record lives in Neon did not foresee (spec, "方案"); the spike only
measures.

### Admission against Pi's commit, both routes **[container]**

One case per crash point, each a SIGKILL at a marker and a restart with no request.

- **C1**: after the admission commit, before `submit`. Recovery finds an admitted operation with no Pi submission and
  submits it again with the same `operationId`, which Pi keeps as one submission.
- **C2**: during `submit`.
- **C3**: after Pi's commit, before anything else.
- **C4**: after Pi settles, before settlement commits.

After recovery, the admission row, Pi's submission status and the settlement row must agree, with no double charge.
Command: `sandboxed node run/q2-admission.ts --crash c1|c2|c3|c4`. This mirrors today's
`workers/edge/host-integration-test/persistence-windows.test.ts` and `agent-db-test/recovery-scan.test.ts`.

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
| `settlement` **[container]** | **part B** | faux plus the ported double | Settlement (`workers/edge/src/agent/settlement/settlement-accounting.ts:34`) |
| `selection` **[container]** | **part B** | faux | Admission plus the selection intent |

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
  - What a real provider's partial carries as usage at the moment of a crash was not checked.
  - 0.87.1 records such an interrupted request with zero usage (`@earendil-works/pi-agent-core@0.87.1
    dist/harness/runtime/drive/recovery.js:4-26`). Part B's `settlement` case must not read faux's figure as a real
    one.
- **4xx and usage only when asked: no part-A case runs them.** The hand-written double
  (`workers/edge/test/doubles/pi-provider-double.ts`) was not ported, because nothing in part A needs it.
  - Faux reports every response as status 200 (`faux.js:364`) and turns a throw into an error frame (`:395-399`), so it
    cannot throw a 4xx out of the adapter.
  - Part B's `settlement` case should port the double for both paths: the failed attempt between two completed turns,
    as a 4xx thrown out of the adapter (`pi-provider-double.ts:202-210`), and usage only when asked (`:58-70`).
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

### Part B cases **[container]**

| Case | Semantic difference | Covering layer of ours |
|---|---|---|
| `settlement` **[container]** | `harness.usage()` is the whole session's running total and counts failed and aborted attempts (`@earendil-works/pi-durable@1.5.2 README.md:855-861`). Each assistant entry carries its own `usage`: question 1's turn recorded `totalTokens` 75 on the tool-call request and 132 on the answer (`evidence/q1-turn.json`, `transcript`). The prototype derives one operation's charge from the assistant entries inside that operation's own entry range. With two completed turns in one session, the second is charged only its own usage. A failed attempt in between appears in `usage()` and not in any completed turn's charge. Part A adds three inputs. Run that failed attempt both as a faux error frame and as a 4xx thrown out of the adapter, which needs the ported double; add usage only when asked, also from the double. Add a turn that completes after an interrupted attempt, whose aborted entry lies inside the operation's range with usage that 0.87.1 records as zero ([`restart`](#restart)). | Settlement (`readOperationCharges`, `workers/edge/src/agent/settlement/settlement-accounting.ts:34`), re-pointed at Pi's per-entry usage, banking only completed turns |
| `selection` **[container]** | A selection turn (no model) as a display-only write submission with a request id; pi-durable 1.2.0 settles those `done` at once. The same id twice yields one entry, through the same admission as model turns. | Admission plus the selection intent (`workers/edge/host-integration-test/selection-intent-loss.test.ts` is today's case) |

Compaction is not a difference to cover. In 0.87.1 and in pi-durable 1.5.2, neither compaction hook can replace the
messages being summarised (checked before this phase), so the move neither adds nor removes that capability.

- Our code registers no compaction hook. The only `compaction` in `workers/edge/src`, `packages/agent/src` and
  `packages/eval/src` is a comment, `workers/edge/src/agent/views/watch-response.ts:19`: "A native context snapshot
  stops at compaction; restore the immutable visible branch for old answers."
- The `stream` case recorded how a compaction boundary shows up in `watch()`: as `pi.live.compactions`, then a
  `pi.compaction` entry in place ([`stream`](#stream)).

## What part B needs

- **Container lanes.** Question 2 entirely, and question 3's `settlement` and `selection` cases, need the test
  Postgres, which testcontainers starts. The owner runs those lanes.
- **The test image.** `animichi-test-postgres:18-3.6-pgvector-0.8.6` must exist locally; building it needs the network
  for its base image.
- **The counting method is chosen: `pg_stat_monitor`.** Part B's first step confirms the extension on the running
  cluster and runs the control ([counting method](#counting-method-decided-in-part-a-run-in-part-b)). The count needs a
  solo run: the reset is global, and the cluster is shared.
- **The baseline count** needs a frozen root install, to run the edge's own host test unchanged.
- **The route is chosen: (b′).** Part B builds the Neon backend with our own wake (b1, b′1–b′3) and sizes that wake.
  b2–b4 are not run. The `PiHarness`-wake hybrid stays open; it could be checked first on an alternate-prefix SQLite
  store, with no Postgres.
- **`pg` joins the prototype** for the question 2 runners, and the lockfile hash is re-recorded.
- **`settlement` needs the ported double** (4xx, usage only when asked), and must decide how an interrupted attempt's
  aborted entry is charged.
- **The spec names `session.events()`**, which `agents` 0.33.0 does not have. Question 3 uses `session.watch()`;
  correcting the spec is its owner's call.
- **Policy questions for the owner, raised by question 4:**
  - Following Pi latest versus following `agents`' supported Pi minor.
  - A Pi-minor deploy cannot be rolled back by redeploying an older artifact.
- **Not done.** The `docs/iterations/README.md` index line the card's PR carries, and part A's spike-branch commit
  field above. Both are the coordinator's.
