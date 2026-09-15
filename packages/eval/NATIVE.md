# Native in-process evaluation

The native command uses the public `logfire/evals` SDK and the production
`createPilgrimageHarness` composition. Every task invocation creates its own Pi
`MemorySessionRepo` session, returns the native `LaneSnapshot`, and closes the
harness and repository in `finally`; `Dataset.evaluate` owns repetition and
concurrency. There is no gateway, staging login, agent database, old run store,
transcript converter, importer, or lifecycle registry in this path.

Run a three-case smoke before the complete held-out set:

```sh
EVAL_SMOKE=1 pnpm --filter @animichi/eval eval:native
pnpm --filter @animichi/eval eval:native
```

The default dataset is `agent_eval_heldout_v1` (all 33 cases). `EVAL_SMOKE=1`
selects exactly the first three while retaining the source count in the plan
and report. `EVAL_REPEAT` and `EVAL_MAX_CONCURRENCY` map directly to
`Dataset.evaluate`; `EVAL_REPEAT` defaults to 1 and task retries are disabled
with `retryTask: { retries: 0 }`, so a failed attempt is never silently
replaced. The repeat sampling semantics are recorded as `sampling: iid` in the
native report metadata. `EVAL_DRY_RUN=1` prints the validated plan and stops
before any binding is required, which is how the documented command is
exercised by a test without a credential.

The command requires one provider credential and a real catalog origin. `EVAL_PROVIDER` names
the binding explicitly and is never inferred or fallen back to: `xiaomi` (the default) reads
`MIMO_API_KEY` and serves the published Xiaomi catalog at `https://api.xiaomimimo.com/v1`, while
`opencode-go` reads `OPENCODE_API_KEY` and serves the published OpenCode Go catalog at
`https://opencode.ai/zen/go/v1`. Both publish `mimo-v2.5`, which is the default `EVAL_MODEL`;
override it with `EVAL_MODEL`. Neither the provider table nor the credential variable is probe-
based: a missing variable for the selected binding stops the run before any provider traffic.
OpenCode Go refuses a request that carries no session information (HTTP 400
`MissingSessionID`), so that binding sends one `x-opencode-session` identifier per run — the
same routing header Pi's own OpenCode Go client sends — while the Xiaomi binding sends none.

```sh
EVAL_PROVIDER=opencode-go OPENCODE_API_KEY=... CATALOG_API_URL=https://catalog.example.com \
  pnpm --filter @animichi/eval eval:native
MIMO_API_KEY=... CATALOG_API_URL=https://catalog.example.com \
  pnpm --filter @animichi/eval eval:native
```

`CATALOG_API_URL` must be HTTPS, or local HTTP (`localhost`, `127.0.0.1` or
`::1`) for a local catalog Worker; credentials, a query string and a fragment
are refused, and the configured origin is the only host a rewritten catalog
request can reach. The production catalog tools and `web_search` use their real
transports. Provider egress is allowlisted per provider by
`packages/agent/src/provider-fetch.ts`, which is where a binding's permitted host
is declared. No live Neon, staging credential or local deployment is used.

`EVAL_DATASET` must name one of the six frozen sets the loader can express as
a prompt task: `agent_eval_v3`, `agent_eval_heldout_v1`, `injection_g1_v1`,
`input_guard_v1`, `long_context_v1`, `phase1c_selection_v1`. `runtime_journey_v1`
(392 cases) and `translation_v1` (65 cases) are preserved corpus sets whose
cases still carry journey expectations and translation fields instead of a
prompt and locale; asking for one says exactly that rather than reporting it as
a typo.

The official `@pydantic/logfire-node@0.18.21` preload is installed by the
package script. With no `LOGFIRE_TOKEN` it prints `Logfire uploader
unconfigured; native report artifacts remain available.` and still writes the
native `EvaluationReport` artifact. Set `EVAL_REPORT_PATH` to choose the JSON
path; otherwise the artifact is written to `native-<dataset>.json` in the
operating system's temporary directory. The artifact is the SDK report itself
and includes model, tested commit, repeat, sampling, source/selected counts,
native tool observations, and per-call Pi cost metrics.

Known cost is summed from native `pi.cost.total`, never re-priced from
aggregate tokens. `actual_spend_status` is `measured` only when every reported
case recorded a priced call and no attempt failed, `partial` when some cases
were priced, and `unmeasured` when none were. A provider outage still emits a
zeroed usage row, so a zeroed row does not count as measured: an outage cannot
be reported as a confident $0.

## Corpus accounting (three separate claims)

1. **Source preservation.** The eight canonical datasets in
   `apps/agent/src/animichi/tests/eval/datasets/` hold 1,208 cases with 1,208
   distinct IDs (662 `agent_eval_v3` + 546 siblings); the frozen copy in
   `datasets/canonical/` is what `test/native-source-agent-eval-v3.test.ts`
   pins, including the 1:1 ID mapping of the 662 converted cases.
2. **Runnable production binding.** Six sets are frozen in `fixtures/` and
   loadable. `agent_eval_v3` reports its 23 session-preseed and 12 selection-prefix
   shapes as needing their owning native task extension instead of dropping
   them. `runtime_journey_v1` and `translation_v1` have no native task or
   expectation migration yet, so no loader can run them.
3. **Actual evaluated coverage.** No real-model run of the native corpus is
   verified. E1 is the 33-case held-out set this card runs; it is a subset of the
   corpus, never the total. See the evidence boundary below.

## Evidence boundary

The local implementation proof is model-free: `pnpm --filter @animichi/eval
test:native` exercises the production composition through deterministic HTTP
and provider fixtures. It is not evidence of real-model quality, deployed
authorization, or quota behaviour.

A real two-to-three-case smoke and a full 33-case E1 run must be recorded
separately, with the exact model, tested commit, repeat/sampling settings,
outcomes and actual spend. The command refuses to start when the selected
binding's credential or `CATALOG_API_URL` is missing, and `NativeRunPorts` is a
test-only seam: the documented command always supplies the published provider
and real egress.
