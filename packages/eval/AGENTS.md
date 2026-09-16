# packages/eval — AGENTS.md

Node-only native Pi tasks and Logfire evaluations. This package must never enter a Worker
bundle. Root rules: `../../AGENTS.md`; accepted target:
`../../docs/specs/2026-09-09-agent-on-pi-harness-spec.md`.

## Native task

`src/native/in-process-task.ts` creates a fresh native `MemorySessionRepo` and session for
each attempt. It calls production `createPilgrimageHarness` from `@animichi/agent/harness`
and returns the actual `LaneSnapshot`. Callers supply production model/tool configuration;
`Dataset.evaluate` owns repetition. Do not introduce a task executor facade, replacement
session model, HTTP transcript converter or staging seed adapter.

`src/native/attempt-observations.ts` records unchanged native `after_tool` arguments/results
and usage events as Logfire attributes. Missing usage remains explicitly unmeasured instead
of becoming fabricated zero spend, and a provider outage's zeroed usage row does not count as
a priced call. The task closes its harness and repository after success,
failure or cancellation; cleanup uses the native Context without the cancelled AbortSignal.

The task and tests use public Pi/Chord 0.85.1 and Logfire 0.22.5 APIs. Production composition
tests execute the real seven-tool harness with deterministic HTTP/provider fixtures. Tests
cover fresh attempts, model and paid-tool usage, rejected/failed/aborted/suspended outcomes,
native cancellation and resource closure. `src/native/native-run.ts` is the documented
composition root; `NativeRunPorts` exists only so those tests can supply deterministic
provider and catalog egress, and the documented command never passes it. These are local
behavioral controls, not evidence of real-model quality or deployed authorization and quota
behavior, and `NATIVE.md` keeps source preservation, runnable binding and evaluated coverage
as three separate claims.

## Recorded prefix corpora (#1558)

`fixtures/prefix-corpus/` holds recorded native prefix sources: for each case a frozen
format-4 session produced by the production harness, plus a `Dataset`-format manifest whose
case inputs carry `prefix` (the frozen source) and whose metadata carries `recording`
(provenance), `prefix_state` (the pending selection, its revision, its durable search
reference and the application scalars the case needs) and `expected_next_action`.

`src/native/prefix-corpus.ts` loads a corpus with the official `Dataset.fromObject` and
refuses a case whose declared source is missing — never a prompt that silently drops its
prefix. `src/native/prefix-replay.ts` copies the frozen bytes into a scratch
`JsonlSessionRepo`, opens and `fork({ scope: "tree" })` them; the application scalars are
the tree fork's, because a branch fork drops every non-`pi.*` value, and list elements are
the SDK's documented tree-fork gap — no copier is added. `src/native/prefix-task.ts`
runs the production harness on a tree fork for corpora whose suffix is a model call, and
`src/native/expected-action.ts` judges that suffix against `expected_next_action` using the
native `after_tool` observations and the committed `animichi.selection` domain entry. `src/native/prefix-cases.ts` derives the
case plans from `datasets/canonical/phase1c_selection_v1.json` (the inputs may be reused;
the trajectories may not).

The committed corpus was recorded deterministically: `provider: faux` and
`catalog: deterministic-case-fixture` are in its provenance, so it is never mistaken for a
real-model recording. The recorder canonicalizes every session-minted identifier and clock
reading before it freezes bytes (`src/native/prefix-canonical.ts`), so a frozen source is
zero-entropy and a re-record of the same commit rewrites the same bytes; a value the
canonicalizer does not classify is refused rather than rewritten. A real-model recording and
a real evaluation run of these cases are separate, authorization-gated work.

## Commands

- `pnpm test`: Node tests through tsx.
- `pnpm run test:native`: the native task, production composition and resource tests.
- `pnpm run typecheck`: strict TypeScript 7, including dependency declarations.
- `pnpm run lint`: type-aware oxlint with warnings denied.
- `pnpm run eval:record-captures`: record a prefix corpus with the production harness; `EVAL_RECORD_MODE=deterministic` records the committed fixture without provider or catalog egress, and the default path needs the selected binding's credential and `CATALOG_API_URL`.
- `pnpm run eval:prefix-selection`: replay `phase1c_selection_v1`'s deterministic selection from its recorded forks against the real catalog (no model call).
- `pnpm run eval:native`: the documented real in-process run (`NATIVE.md`). `EVAL_PROVIDER`
  selects the published provider binding explicitly (`xiaomi` by default, else `opencode-go`) and
  never falls back; it refuses to start without that binding's credential and `CATALOG_API_URL`,
  and is never run without explicit authorization.

The Python fixture export and its drift gate are gone (#1603). `fixtures/` are frozen bytes
with no regeneration path; the canonical sets they were exported from now live in
`datasets/canonical/`, and nothing in this package shells out to `uv`, Python or apps/agent —
`pnpm test` runs on Node alone.

The old `eval:staging`, `eval:gate` and HTTP prefix-capture commands are retired with their
obsolete consumers. Independent correctness/assertions and the pass^k layer, recorded
same-repository prefixes, complete production suite rosters and real-model baselines remain
their owning Eval Stories (#1558–#1560). They are not supplied by this minimum consumer
closure. Never run paid evaluations without explicit authorization.

## Preserved inputs and oracles

`src/gate/` retains independent statistical utilities. The remaining pure `src/gate-run/`
modules retain their source behavior until an Eval Story replaces or retires them.
`fixtures/` retains Python-exported datasets and statistical oracle material. These files
are source inputs and expected values, not completed native suite rosters or successful runs.
`datasets/canonical/` holds the frozen canonical datasets the strata and the
`agent_eval_v3` source migration read; `PINS.json` declares the pydantic-evals version they were
exported with, so the package has no path into apps/agent at runtime or in tests.

Keep the original input-guard, injection and translation cases and their canonical copies in
`datasets/canonical/`.
Do not reduce coverage by relabeling a migrated subset as the full corpus. Source migration,
retirement decisions and their evidence belong to the full Eval work, separate from deletion
of the obsolete runtime consumers. Root type, coverage and test-quality rules still apply.
