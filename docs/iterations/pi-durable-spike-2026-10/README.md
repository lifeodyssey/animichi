# pi-durable spike: phase 1 record (2026-11-18)

Status: phase 1 of the spike in #1999, the first card of `docs/specs/2026-10-04-pi-durable-migration-spec.md`
("spike（第一张卡）"). Phase 1 answers question 1 (Workers, the minimum deliverable) by a recorded workerd run, answers
questions 4 and 5 at the desk, and writes the exact plan for questions 2 and 3, which phase 2 runs. Nothing here is a
migration decision; choosing to migrate and choosing a storage route are the owner's, after the full report.

Notation: repository files are `path:line` at 6c9fb45b6; npm packages are `package@version path:line`, the path
relative to the installed package; evidence files are relative to this directory.

## Record fields

The card's last criterion asks for these fields, so a reviewer can re-run every command.

| Field | Value |
|---|---|
| Baseline pi line on `main` at the start | 0.87.1: `@earendil-works/pi-agent-core`, `pi-ai` and `chord` (`pnpm-workspace.yaml` catalog at 6c9fb45b6). Owner decision, 2026-11-18: start the pi-durable migration directly and skip the 0.99.2 step (#1995), so 0.87.1 is the baseline the migration surface is measured from. |
| `agents` used | 0.33.0, the npm `latest` on 2026-11-18. The edge already declares `^0.33.0` (`workers/edge/package.json`), so the edge needs no `agents` version bump to get `PiHarness`. |
| pi-durable used | 1.5.2, the npm `latest`, with pi-ai, chord, pi-schema and pi-telemetry 1.5.2, which pi-durable pins exactly. |
| Runtime | Build: Wrangler 4.132.0 `deploy --dry-run` (the repository's catalog version and the edge bundle-smoke lane's method). Run: Miniflare 4.20260722.0, which runs workerd 1.20260722.1 (the repository's catalog Miniflare). Compatibility date `2026-07-22` and flags `["nodejs_compat"]`, read from `workers/edge/wrangler.toml:89-91` on every run. Node 24.18.0, pnpm 12.4.2. |
| Spike branch and commit | `spike/pi-durable`, created from origin/main at 6c9fb45b6. The commit carrying this record and the prototype: _filled when the coordinator commits and pushes_. |
| Prototype lockfile | `prototype/pnpm-lock.yaml`, SHA-256 `c0a6fed90e136bffd298a76ad30ae085e6dca6cdfe838c461fc65adc7bcc97ed` |
| Criteria per route | [Criteria](#criteria) |
| Overall go or no-go | Not yet decided: questions 2 and 3 are unanswered in phase 1 (planned below, not run). Question 1 is go. |
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
| 2 (a) | After each of three crash points, the Neon record equals the projection recomputed from Pi's store; the two-object case passes; statements per turn are no more than today; recovery is no weaker | **unanswered (phase 2)**: needs the test Postgres, a container lane | [Plan for question 2](#question-2-storage-plan-for-phase-2) |
| 2 (b) | The conformance suite, the two-object isolation case and `PiHarness`'s wake pass on a Neon backend; statements and recovery as above | **unanswered (phase 2)** | same |
| 2 (b′) | The conformance suite, the two-object isolation case and our own wake pass; statements and recovery as above | **unanswered (phase 2)**, run if (b)'s wake or `PiHarness`'s operation calls fail on the backend | same |
| 3 | Every semantic difference has a covering layer shown by a prototype; per-tool replay by experiment (`translate_anime_title` neither reruns nor double-bills); two completed turns each charged only their own usage | **unanswered (phase 2)** | [Plan for question 3](#question-3-business-layer-plan-for-phase-2) |
| 4 | Release cadence, API surface, experimental parts, cost of following releases | **answered** | [Question 4](#question-4-risk) |
| 5 | Per-package surface with sizes, including the `agents` upgrade; whether two pi-ai versions coexist in one package | **answered** | [Question 5](#question-5-migration-surface) |

## How to re-run

Every run of Node, Wrangler, Miniflare or workerd goes under a macOS sandbox with outbound network denied except
loopback, with proxy variables removed. The profile used is six lines, saved on the spike machine as
`/tmp/catalog-guard-baseline/no-network.sb`:

```text
(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote unix-socket))
(allow network-outbound (remote ip "localhost:*"))
(deny network-outbound (remote ip "localhost:7897"))
```

From the repository root:

```sh
cd docs/iterations/pi-durable-spike-2026-10/prototype
# Outside the sandbox: the only step that reaches the npm registry.
pnpm_config_strict_dep_builds=false pnpm install --ignore-workspace --frozen-lockfile
# A function, not a variable: zsh does not split an unquoted variable into words.
sandboxed() { sandbox-exec -f /tmp/catalog-guard-baseline/no-network.sb env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy "$@"; }
sandboxed node run/alarm-probe.ts   > ../evidence/q1-step0-run-output.txt 2>&1   # step 0 (about 3 s)
sandboxed node run/q1.ts            > ../evidence/q1-run-output.txt 2>&1         # 22 checks, exit 0 when all pass (about 70 s)
sandboxed node run/bundle-report.ts > ../evidence/q1-bundle-run-output.txt 2>&1  # the bundle's imports (about 10 s)
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
- Before the first wake ran, or before its re-arm committed: 36–56 ms. The stored alarm is still the due-now wake
  that `submit` pushed (`dist/harness/pi/index.js:325-348`), and workerd fires it as soon as it starts.
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
  - It also coerced `{ title: 42 }` to `"42"` and ran the tool with it. Coercion is a semantic difference for
    question 3: today the deployed tools run their own oRPC/Zod validators inside `execute`
    (`workers/edge/bundle-smoke/README.md`, "Native production entry boundary").
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

The Wrangler dry-run artifact of `src/q1.worker.ts`, the one `run/q1.ts` executes, is 991,226 bytes (220,674 gzip).
Its metafile (`evidence/q1-bundle.json`) shows:

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
  `^1.0.0`.
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
- The streaming surface moved under us. 1.5.0 removed `watchEvents()` and its agent-event types (`CHANGELOG.md`, 1.5.0
  "Breaking Changes"). The README's table of contents still lists "Agent Events (Experimental)" (`README.md:27`), but
  no such section remains.
- The replacement is the conversation view, which `PiSession` exposes as `watch(window)`
  (`agents@0.33.0 dist/harness/pi/index.d.ts:329`). The `session.events()` that the card and the spec name does not
  exist in `agents` 0.33.0; only a stale doc comment mentions it (`index.d.ts:184`).

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
- 158 of the 189 import a subpath that 1.x no longer exports. pi-agent-core 1.5.2 exports only `.`. Files counted per
  specifier: `/harness/context` 126, `/harness/session` 81, `/node` 3, `/harness/session/testing` 3.
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
  - `agents` takes pi-ai, chord, pi-durable and pi-schema as peers at `~1.5.0`. `agents/harness/pi` imports them at
    runtime (`agents@0.33.0 dist/harness/pi/index.js:6-10`).
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
  - Phase 1 did not build this. An alias build plus typecheck in phase 2 would confirm it, if the owner wants to weigh
    a package-by-package path.

## Question 2: storage, plan for phase 2

Not run in phase 1. Each case below names its command, run from `prototype/` with the re-run block's `sandboxed`
function, and marks **[container]** where it starts or reuses the test Postgres. Those steps need the owner to run the
lane: earlier, a permission check refused a writer a container-starting lane.

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

### Shared method

- **Where code goes.** Under `prototype/q2/`, with its own runners in `prototype/run/`. The prototype adds `pg` to its
  own `package.json`, so the lockfile hash changes and is re-recorded.
- **Reaching Postgres from workerd.** The Durable Object reaches the test Postgres the way the edge's host lane already
  does, through a DSN binding (`workers/edge/host-integration-test/default-worker.ts:15-17`, `AGENT_SVC_DATABASE_URL`).
  The edge builds that client with Prisma's runtime over a `postgres://` URL (`workers/edge/src/native-client.ts:14-16`).
- **Sandbox and guard.** That connection is a socket, not a `fetch`, so the outbound guard (a `fetch` handler) will
  not see it. For sockets, way 11 is the sandbox's loopback-only profile: any other destination fails with EPERM.
  Phase 2's first step confirms both. The connection must appear in `pg_stat_activity` and not in the guard, and the
  only loopback port reached must be the test Postgres's.
- **Statements per turn, the same way for every store.** The count is server-side, so it is the same for the
  production code and the prototype, and never a timing (the card; production's Neon driver is WebSocket-only, the
  test database is TCP).
  - First step of phase 2 **[container]**: the read-only `SHOW shared_preload_libraries`.
  - If `pg_stat_statements` is preloaded: `CREATE EXTENSION pg_stat_statements` in the measured database, then
    `pg_stat_statements_reset()` right before the turn's submit, and the sum of `calls` for that database right after
    it settles.
  - If it is not preloaded: a loopback TCP proxy in front of the container that counts the frontend protocol's `Query`
    and `Execute` messages per turn.
  - Either way the count is of statements on the wire, not ORM log lines (`docs/agents/database-and-migrations.md:59-65`
    warns that `BEGIN`/`ROLLBACK` log lines are not statements).
- **Today's store, the baseline [container].**
  - The edge's existing one-turn host test, run alone and unchanged, with the counter around it:
    `node --import tsx --test --test-isolation=none --test-concurrency=1 --test-name-pattern "production chat tier boots the default SessionAgent" workers/edge/host-integration-test/default-host.test.ts`.
    That test is "production chat tier boots the default SessionAgent, executes its native respond tool and settles
    from real Neon usage" (`default-host.test.ts:9`).
  - Its fixed per-test setup statements in its own database (one trigger script, one `TRUNCATE`/`DELETE` pair,
    `host-integration-test/postgres.ts`) are counted separately and subtracted.
  - This needs a frozen root install (`pnpm install --frozen-lockfile` at the root), which changes no tracked file.
- **Like for like.** The baseline turn is one model request that calls the `respond` tool and settles. The route (a)
  and (b) runners script the same shape, one model request and one tool call, then settle. They do not use question
  1's two-request turn.

### Route (b): a Neon backend for pi-durable's `Storage`

Prediction from the source, to confirm by case b3: `PiHarness` resolves `submit`'s `accepted` flag, `wait()` and
`abort(operationId)` through `storage.submissionByRequest(…)` on the storage it opened itself, the object's SQLite. Its
`_doOpen` returns that storage beside Pi (`agents@0.33.0 dist/harness/pi/index.js:447-471`), and it is read at
`:302-318`, `:263-278` and `:483-487`. A factory that opens Pi over a Neon backend instead would leave those reads on an
empty store: `wait()` would answer `unanswered`/`not_found`, and `accepted` would always be true. The wake itself reads
only `pi.wake()` and may still work.

| Case | What it shows | Command (phase 2) |
|---|---|---|
| b0 | The conformance suite's own control: pi-durable's cases on `MemoryStorage` pass under `node:test`. `createStorageConformance(options)` from `@earendil-works/pi-durable/testing` returns cases with `run()`. They are looped exactly as `packages/pi-session-neon/test/storage-conformance.db.test.ts:3,15-16` loops 0.87.1's suite. `registerStorageConformance` would need a Vitest/Jest-style runner with `expect` (`dist/testing/runner.d.ts:3-9`). | `sandboxed node --test q2/conformance-control.test.ts` |
| b1 **[container]** | The Neon backend passes the same suite on the test Postgres, with nothing weakened | `sandboxed node --test q2/neon-conformance.db.test.ts` |
| b2 **[container]** | Two-object isolation. Two Durable Objects, both with root conversation `"1"`, each opened on the backend keyed by its `SessionAgent` session id, run a turn at the same time. Each `messages()` and each set of rows holds only its own turn, and no row is overwritten (row versions compared). | `sandboxed node run/q2-route-b.ts --case isolation` |
| b3 **[container]** | `PiHarness`'s wake with the backend: question 1's two evictions (safe and unsafe, SIGKILL during the tool call) finish the turn with no request; then `wait()`, `abort(operationId)` and `accepted` are checked against the prediction | `sandboxed node run/q2-route-b.ts --case wake` |
| b4 **[container]** | Statements per turn on the backend | `sandboxed node run/q2-route-b.ts --case count` |

If b3's wake fails, or the operation calls fail as predicted, route **(b′)**: `SessionAgent` calls `Harness.open` on the
backend directly and wakes it with the Agents SDK scheduler, as the edge does today (`schedule(…, "wakeSession", …)`;
the pattern in `workers/edge/bundle-smoke/tool-replay-recovery.worker.ts`).

- Cases b′1–b′3 **[container]** repeat b2–b4 with that wake: `sandboxed node run/q2-route-b-prime.ts --case
  isolation|wake|count`.
- b1 carries over unchanged.
- The record adds the size of the wake we would own.

### Route (a): `PiHarness`'s SQLite, projected into Neon

Pi's store is authoritative. After Pi commits a completed turn, the object writes that turn's record to Neon, keyed by
`(session_id, seq)` with the `SessionAgent` session id. The write is idempotent, so recovery can rewrite it. Crash
points are injected by SIGKILLing workerd at a marker, and the runner sends no request until recovery has run.

| Case | What it shows | Command (phase 2) |
|---|---|---|
| a1 **[container]** | Crash after Pi's commit and before the Neon write | `sandboxed node run/q2-route-a.ts --crash before-write` |
| a2 **[container]** | Crash during the Neon write: the counting proxy holds the transaction's `COMMIT`, workerd is killed, and Postgres rolls back the open transaction when the connection drops | `sandboxed node run/q2-route-a.ts --crash during-write` |
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

## Question 3: business layer, plan for phase 2

One minimal prototype per semantic difference, each naming the layer of ours that covers it. Pi's side runs in workerd
on the object's SQLite, as in question 1 (no container). Cases that call our real settlement or admission tables are
marked **[container]**. Each runs as `sandboxed node run/q3.ts --case <name>`.

### Provider evidence

The record will say which provider produced each path.

- **Abort frames: faux.** pi-ai 1.5.2's `fauxProvider` emits an `aborted` error frame when the signal aborts between
  deltas (`@earendil-works/pi-ai@1.5.2 dist/providers/faux.js:221-258`). The abort only lands mid-stream with
  `tokensPerSecond` set.
- **Usage: faux, but only half the path.** Faux always attaches estimated usage (`:160-165`), so it cannot model a
  gateway that sends usage only when asked.
- **4xx: the double.** Faux scripts error frames (`:212-213`) and never throws a 4xx out of the adapter.
- So the usage-when-asked and 4xx paths need the repository's hand-written double,
  `workers/edge/test/doubles/pi-provider-double.ts`, ported to pi-ai 1.5's provider objects.

### Cases

| Case | Semantic difference | Covering layer of ours |
|---|---|---|
| `admission` | `PiHarness`'s `submit(input, { operationId })` treats the same id as one submission and never compares content (`agents@0.33.0 dist/harness/pi/index.js:302-318`). Expected from that source, and to be shown: after "A" and then "B" under one id, Pi runs only "A", and the second receipt says `accepted: false`. Also expected: pi-durable's `requestId` rejects a different submission type under the same id. The October record read that in 1.0.2; it is not yet re-read in 1.5.2. | Admission in front of `submit`: the `x-turn-id` digest answers 409 on a different digest (`workers/edge/src/agent/admission/request-intent.ts:9-26`) |
| `budget` | Pi has no turn deadline. The host aborts the operation at the budget, reading the turn's start from Pi; the prototype pins which field: the submission's placement or `pi.live.run`. Slow faux streaming makes the abort land mid-answer; the operation must settle `unanswered`/`aborted` with an aborted frame. Local workerd's clock advanced during synchronous work (question 1), so the budget is measured across awaits. | The host's turn budget, `TURN_DEADLINE_MS` (`workers/edge/src/agent/host/turn-deadline.ts:13`) |
| `settlement` **[container]** | `harness.usage()` is the whole session's running total and counts failed and aborted attempts (`@earendil-works/pi-durable@1.5.2 README.md:855-861`). Each assistant entry carries its own `usage`: question 1's turn recorded `totalTokens` 75 on the tool-call request and 132 on the answer (`evidence/q1-turn.json`, `transcript`). The prototype derives one operation's charge from the assistant entries inside that operation's own entry range. With two completed turns in one session, the second is charged only its own usage. A failed attempt in between (a faux error frame) appears in `usage()` and not in any completed turn's charge. | Settlement (`readOperationCharges`, `workers/edge/src/agent/settlement/settlement-accounting.ts:34`), re-pointed at Pi's per-entry usage, banking only completed turns |
| `stream` | The AI SDK stream comes from `session.watch(window)`, not the spec's `session.events()`, which `agents` 0.33.0 does not have. The first value is the newest window (50 entries, growing to 100) with `pi.live`; each change carries Pi's operations (`agents/docs/harnesses/pi.md:202,227`). The prototype attaches a second watcher mid-answer and records that it starts from the current view, without the earlier deltas, compared with our reconnect. | The stream projection and reconnect (`workers/edge/src/agent/views/watch-response.ts`, `snapshot-view.ts`, `message-chunks.ts`) |
| `selection` **[container]** | A selection turn (no model) as a display-only write submission with a request id; pi-durable 1.2.0 settles those `done` at once. The same id twice yields one entry, through the same admission as model turns. | Admission plus the selection intent (`workers/edge/host-integration-test/selection-intent-loss.test.ts` is today's case) |
| `replay` | Per-tool mapping: the six `"safe"` tools stay `"safe"`; `translate_anime_title` goes from `"never"` to `"unsafe"`. Experiment, as question 1 did with `resolve_anime`: interrupted on `"unsafe"`, `translate_anime_title` must hand the model an interrupted result and not run again. The reservation made inside `execute` and the catalog count must each be 1, and Pi's per-tool usage must count the attempt once. Today's case is `packages/agent/integration-test/translation-interruption.test.ts`. | The tool's `execute`. Authorization and quota stay inside it, because replay paths skip hooks (spec, "迁移的不变量") |
| `validation` | pi-schema coerces arguments before `execute`: `{ title: 42 }` arrived as `"42"` (question 1). Each tool is called with a number where its schema says string, and the result is compared with today's validators. | The tool's own oRPC/Zod validator inside `execute` |
| `restart` | A model request in flight at a crash is not resent at once; it counts as a failed attempt under `settings.retry` and, with none left, ends `unanswered` with reason `interrupted`. A task cut off five times in a row ends (`agents/docs/harnesses/pi.md:273,277`). Whether today's 0.87.1 recovery resends such a request is not yet checked; the case compares both against `recovery-endings.test.ts`. | Settlement refunds for unanswered operations; today's `workers/edge/host-integration-test/recovery-endings.test.ts` |

Compaction is not a difference to cover. In 0.87.1 and in pi-durable 1.5.2, neither compaction hook can replace the
messages being summarised (checked before this phase), so the move neither adds nor removes that capability.

- Our code registers no compaction hook. The only `compaction` in `workers/edge/src`, `packages/agent/src` and
  `packages/eval/src` is a comment, `workers/edge/src/agent/views/watch-response.ts:19`: "A native context snapshot
  stops at compaction; restore the immutable visible branch for old answers."
- The `stream` case should still record how a compaction boundary shows up in `watch()`.

## What blocks phase 2

- **Container lanes.** Question 2 entirely, and question 3's `settlement` and `selection` cases, need the test
  Postgres, which testcontainers starts. The owner runs those lanes.
- **The test image.** `animichi-test-postgres:18-3.6-pgvector-0.8.6` must exist locally; building it needs the network
  for its base image.
- **The counting method.** Whether the image preloads `pg_stat_statements` is unknown, because phase 1 did not touch
  Docker. Phase 2's first step answers it, or falls back to the counting proxy.
- **The baseline count** needs a frozen root install, to run the edge's own host test unchanged.
- **Route (b) through `PiHarness`** is predicted to break `wait()`, `abort(operationId)` and `accepted`. If case b3
  confirms it, (b′) is the route a Neon backend would take, and the record must size the wake we would own.
- **The spec names `session.events()`**, which `agents` 0.33.0 does not have. Question 3 uses `session.watch()`;
  correcting the spec is its owner's call.
- **Policy questions for the owner, raised by question 4:**
  - Following Pi latest versus following `agents`' supported Pi minor.
  - A Pi-minor deploy cannot be rolled back by redeploying an older artifact.
- **Not done in phase 1.** The `docs/iterations/README.md` index line the card's PR carries, and the spike-branch commit
  field above. Both are the coordinator's.
