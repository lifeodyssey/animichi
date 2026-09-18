# CI parallelism mechanisms for a task-runner adoption in `lifeodyssey/animichi`

Scope: replace three hand-written "which packages does this change affect" implementations with
a task runner (owner-decided: Turborepo), without losing the wall-clock parallelism that today
comes from GitHub Actions fanning affected packages out to one job per package on separate
runners. Repository is not changed by this research; this file is the sole output.

Status: complete. Internal-repo forensics (§0, grounding Q3 and part of Q4) are primary-source
against this repo's own files and the cited CI run. External option-space research (§1, Q1, Q2,
Q4) is primary-source against each tool's own docs/source/issue-tracker, fetched or queried
2026-09-18, with URLs inline throughout. Anything not resolved to that standard is listed in
"Claims not verified" at the end rather than asserted.

---

## 0. Internal facts, verified against this repo and this run (2026-09-18)

All of the below is primary-source: either `file:line` in the working tree, or `gh run view` /
`gh api` output from the actual run the task cites (`35312913725`, head SHA
`0a06d848c62b5373f8f5c60f639e6882544b9d09`).

### 0.1 The three hand-written "affected" implementations

1. **`scripts/local-gates/pre-push-affected.sh`** (repo root, pre-push git hook gate). Computes
   the changed-file set from `git diff --name-only --no-renames "$base"...HEAD`, lists workspace
   projects with `pnpm ls -r --depth -1 --json`, and does its own **prefix-join** between changed
   paths and project directories — it does **not** use pnpm's own `--filter "...[<ref>]"` selector.
   The file's header comment states why: "pnpm's own `[<ref>]` selector answers nothing from a
   worktree nested inside the repo (pnpm/pnpm#12626)." This repo runs one git worktree per card
   (per `AGENTS.md`'s Harness section), so every local run of this gate is nested and would hit
   that bug if it used pnpm's selector directly.
2. **`.github/workflows/pr-verification.yml`**, `plan` job → `affected` job matrix
   (`name: CI / affected (${{ matrix.package }})`). Computes the affected set with
   `pnpm ls -r --depth -1 --json --filter "...[$merge_base]"` where `merge_base` is
   `git merge-base "$BASE_SHA" "$HEAD_SHA"` (PR base / merge-group base), subtracts
   `animichi-cloudflare-worker` and `animichi-e2e` only — the root project, which owns no test
   scripts, and the e2e project, whose `test` is the browser lane (`pr-verification.yml:165` at the
   cited SHA, `:189` on `main` today) — and re-adds `edge-worker` unconditionally when
   `.github/workflows/**` changed (comment: several of its tests "extract shipped shell blocks and
   RUN them"). **`@animichi/agent` is not subtracted**; it runs in the affected matrix like any other
   package (its coverage upload is guarded at `pr-verification.yml:216`). The matrix itself is
   GitHub's own `fromJSON(needs.plan.outputs.packages)` mechanic — see §1/Q1(c) below.
3. **`.github/workflows/cd.yml`** — **not reproducible at the cited SHA; treated as withdrawn.**
   This slot describes a "Select the affected packages" step: a third, independently-written
   `pnpm ls ... --filter "...[$BASE_SHA]"`, with `BASE_SHA` being the SHA of the last run that reached
   a green staging smoke, then a `deployable` allow-list. That file is gone — `cd.yml` at `0a06d848`
   is 377 lines with no `pnpm ls` in it, and the only workflow that invokes `pnpm ls` is
   `pr-verification.yml` (`:157`, `:163`). CD now selects a sealed release snapshot by artifact ID
   (`ruby .github/scripts/release/resolve.rb`, then hydrate). The step was deleted by `60e36d973`
   ("ci(delivery): deploy selected release artifacts", 2026-09-11), and in its last revision it
   subtracted `animichi-cloudflare-worker`, **`@animichi/agent-python`** (the retired Python agent)
   and `animichi-e2e` — which is where the `@animichi/agent` in #2 above appears to have come from.
   No figure in this report is derived from that step.

**Both call the same underlying pnpm primitive** (`pnpm ls -r --depth -1 --json[--filter
"...[ref]"]`). They diverge on exactly three things, not on selection algorithm:
   - **base-ref semantics**: merge-base (CI) vs.
     pushed-remote-sha-if-ancestor-else-HEAD~1 (pre-push).
   - **subtraction/allow-list policy**: which projects are "not really a package" for this
     purpose — root and e2e in CI. (The CD arm of this bullet went with the `cd.yml` step noted
     above.)
   - **pnpm/pnpm#12626**: the pre-push gate cannot use the `[<ref>]` selector at all from a
     nested worktree, so it reimplements the same selection with `grep` over `pnpm ls` output.

This directly informs Q4 (§4 below): unifying "selection algorithm" gains little, because the two
implementations that exist already share one; what's hand-written per-call is the base-ref and the
policy list, which are business decisions no tool supplies.

### 0.2 The measured run, reconciled exactly

`gh run view 35312913725 --repo lifeodyssey/animichi --json jobs` (retrieved
2026-09-18) gives per-job `startedAt`/`completedAt`. Reconciling against the task's numbers:

| Job | Start | End | Duration |
|---|---|---|---|
| `CI / affected (edge-worker)` | 05:58:45 | 06:04:29 | **344 s** |
| `CI / repository contracts` | 05:58:27 | 06:03:32 | **305 s** |
| `CI / affected (web)` | 05:58:54 | 06:03:41 | **287 s** |
| `CI / browser` | 05:58:45 | 06:02:31 | **226 s** |
| (8 other `affected (*)` jobs) | — | — | 64–172 s each |
| Workflow (`createdAt`→`updatedAt`) | 05:58:23 | 06:04:36 | **373 s** |

Sum of the 12 `affected (*)` matrix job durations = **1652 s exactly** (142+54+172+85+344+152+124+
68+86+287+64+74), reproducing the task's figure to the second. All four "longest jobs" durations
also match exactly. This confirms the task's numbers are accurate and gives a verified baseline.

**Critical-path correction (this matters for Q3): `repository contracts` and `browser` are not
part of the 1652 s figure and are not on the critical path.** They are separate lanes in the same
workflow, run in parallel with the 12-job matrix, and both **finish before** `affected
(edge-worker)` does (06:03:32 and 06:02:31 vs. 06:04:29). Empirically, per the run's own job
timestamps, `affected (edge-worker)` is the last non-aggregator job to complete — 06:04:29 is the
latest `completedAt` of any job except the two final required-check aggregator jobs ("Security",
gated only by the six quick security jobs and done at 05:59:22; "PR Verification", which starts at
06:04:32 — 3 s after edge-worker completes — and finishes at 06:04:35). Wall clock decomposes as:
366 s (workflow creation → edge-worker completion) + 7 s (final aggregator tail) = 373 s. **The
100% single-runner regression is driven by the sum (1652 s); the fan-out's wall clock is driven
by the max (344 s, edge-worker). Ratio: 1652/344 = 4.80×** — this is the number a "reduce the
work" strategy has to beat, not the 373 s wall clock.

### 0.3 Q3 groundwork: which of the four longest jobs is reducible, and by how much

**`CI / repository contracts` (305 s) contains one real, confirmed, fixable bug — but it is not
on the critical path, so fixing it buys 0 s of wall clock today.**

Per-step timestamps from the job's own log (`gh run view 35312913725 --job 105498448576 --log`):
a single `run:` step invokes ~59 separate `ruby *.test.rb` contract-test files sequentially
(each its own process). 58 of them complete in well under a few seconds each (minitest's own
"Finished in N.NNNNNNs" lines confirm this). One does not: `Run options: --seed 13925` starts at
`2026-09-18T06:00:30.4196473Z` and its `Finished in 135.440791s, ...` line lands at
`2026-09-18T06:02:45.8588700Z` — a **measured 135.44 s**, matching the task's "~142 s" estimate
closely enough to be unambiguously the same phenomenon (report the measured figure, not the
estimate).

Tracing the file (fetched at the run's own commit via `gh api
repos/lifeodyssey/animichi/contents/.github/test/release-schema-gate.test.rb?ref=0a06d848…`):
`ReleaseSchemaGateTest#request_environment` sets `BUNDLE_POLL_SECONDS=0` and
`STALE_BUNDLE_ATTEMPTS=2` to keep the "stale prisma bundle" retry path in
`.github/scripts/release/schema-preflight.sh` fast — but does **not** set
`UNAVAILABLE_POLL_SECONDS` or `UNAVAILABLE_ATTEMPTS`, the pair that governs the *other* retry
branch in the same script (the "migrator answered 503" branch):

```sh
unavailable_attempts="${UNAVAILABLE_ATTEMPTS:-10}"
unavailable_poll_seconds="${UNAVAILABLE_POLL_SECONDS:-15}"
...
  echo "::notice::just-published migrator is not answering preflight yet, attempt $unavailable_attempt/$unavailable_attempts, sleeping ${unavailable_poll_seconds}s..."
  unavailable_attempt=$((unavailable_attempt + 1))
  sleep "$unavailable_poll_seconds"
```

`test_unavailable_ledger_is_not_success` sets `PROBE_STATUS = '503'`, which drives this exact
branch with the un-overridden defaults: 9 real `sleep 15`s before the 10th attempt fails closed =
135 s, to the second. This is a genuine, low-risk, one-line fix (add `'UNAVAILABLE_POLL_SECONDS'
=> '0'` to `request_environment`, the same Ruby hash that already zeroes `BUNDLE_POLL_SECONDS`) —
the code path under test cares about attempt-count exhaustion, not wall-clock duration. **But**: per
§0.2, `repository contracts` (305 s) finishes at 06:03:32, 57 s before edge-worker's 06:04:29.
Fixing this bug changes `repository contracts` to ≈170 s and changes the workflow's wall clock by
**0 s**. It is worth fixing for CI compute cost and for margin (if edge-worker's time ever drops
below ~248 s, or contracts' non-buggy 170 s ever grows, this bug becomes gating) — but it is not
today's bottleneck, and should not be reported as one.

**`CI / affected (edge-worker)` (344 s) — the one plausible-looking "bug" here turned out, on
inspection, to be deliberate.** The single largest individual test in this job's log
(`06:04:08.1078017Z ✔ an operation accepted after create remains pending during retry and
completes from its native deadline wake (62986.271333ms)`, i.e. ≈63.0 s) is defined in
`workers/edge/host-integration-test/recovery-endings.test.ts`. The repo has a documented seam
(`workers/edge/host-integration-test/wake-cadence.ts`) for exactly this kind of test:
`FAST_RECOVERY_SCAN = { TEST_WAKE_INTERVAL_MS: "2000" }`, overriding the production 30 s cadence
in `workers/edge/src/agent/host/wake-interval.ts` (`WAKE_INTERVAL_MS = 30_000`, added for issue
#1731 "so a database-backed test lane arms its own faster cadence instead of waiting out
production's half minute"). The immediately preceding test in the same file *does* use it
(`businessWorker(context, FAST_RECOVERY_SCAN)`, runtime 4.28 s per the log). The 63 s test does
not — it calls `businessWorker(context, { TEST_RETRY: "true" })` only. This looked, before
checking, exactly like the same class of bug as the contracts job. It is not: `wake-cadence.ts`'s
own comment explains the design intent directly — "Only a case whose proof is that the recurring
scan itself recovers work passes it [FAST_RECOVERY_SCAN] ... A case about admission,
interleaving, exclusivity or recovery ordering keeps the production cadence, because an extra
scan tick can drive its operation inside a window that case assumes quiet." This specific test's
own assertions (`unexplainedWakes(snapshot.schedules) == []`) would be invalidated by a faster
cadence — using production timing is the point of the test, not an oversight. **Verdict: not
reducible without deciding the test is wrong, which the evidence does not support.**

The other ~250 s of edge-worker's 344 s is, per the same log, dozens of tests each taking 2–10 s,
overwhelmingly against a real Neon Postgres connection (`pool.query(...)` calls visible
throughout `recovery-endings.test.ts`) inside a real `workerd` runtime — this is latency-bound
work (network round-trips to a real database, real Durable Object alarm scheduling), not
CPU-bound work. A bigger/faster CI runner does not shorten a network round-trip.

`CI / browser` (226 s)'s single long step is confirmed (from its own log) to be
`animichi-e2e`'s real `playwright test` run across 11 spec files plus `edge-worker`'s
`test:native-browser`, i.e. genuine browser automation (Chromium launches, accessibility scans,
Core Web Vitals capture) — not investigated line-by-line beyond confirming this, since nothing in
it looks anomalous.

`CI / affected (web)` (287 s) runs one chained `lint && typecheck && test && build` step for the
largest package in the repo. Not decomposed further — no claim is made about what dominates it.

**Net for Q3**: of the four longest jobs, exactly one contains a confirmed, fixable, real bug
(contracts' 135 s), and it is off the critical path. The one item on the critical path
(edge-worker) that looked like a plausible bug is, on direct inspection of the code and its
design comment, deliberate. Reduction, on the evidence actually available in this run, recovers
approximately 0 s of wall clock. Distribution recovers 4.80×. These are demonstrated, not assumed,
to be complementary rather than substitutable — full argument in §3 (Q3) below, which also covers
the counterfactual arithmetic for what *would* happen to the critical path if a reducible cost
were later found on it.

---

## 1. The option space

| Option | Distributes across machines? | Cost | Requires | Risks |
|---|---|---|---|---|
| (a) Nx Agents / Nx Cloud DTE | Yes — but **requires Nx Cloud**, confirmed by the task's own given fact #2 ([nx.dev/docs/features/ci-features/distribute-task-execution](https://nx.dev/docs/features/ci-features/distribute-task-execution)) | Paid SaaS: Hobby free tier (50,000 credits/mo, 5 contributors, 10 concurrent CI connections); Team $29/mo + $29 included usage, overage $5.50/10,000 credits, +$19/contributor, +$2.25/concurrent CI connection; Enterprise custom. 500 credits per CI pipeline execution ([nx.dev/pricing](https://nx.dev/pricing), [nx.dev/docs/reference/nx-cloud/credits-pricing](https://nx.dev/docs/reference/nx-cloud/credits-pricing)) | `npx nx-cloud start-nx-agents`, `.nx/ci-config.yaml` with `distribute-on: 3 linux-medium-js` (given fact #2); full migration to Nx's own project graph | Vendor/cost dependency; irrelevant here — no paid services is a hard constraint |
| (b) Single runner + remote cache (turbo's official CI story) | No (by definition) | A remote-cache backend: Vercel's own hosted Remote Cache, a self-hosted implementation of the same open protocol, or a third-party provider (Depot's cache product confirms Turborepo support — [depot.dev/products/cache](https://depot.dev/products/cache)) | `turbo run <task> --affected` on one runner + cache config; this is turbo's own documented default CI shape (given fact #1, independently re-confirmed against [turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci) — no mention of "matrix," "ls," or "distribute" anywhere on that page) | Cache-poisoning class (CVE-2025-36852/CREEP) applies per given fact #4; more fundamentally, **irrelevant to this repo's wall clock regardless of poisoning risk** — the critical path (edge-worker's real PostGIS `test:integration`) is explicitly non-cacheable per the stated constraints, so a working cache wouldn't shrink it on the PRs that touch it |
| (c) Generate GitHub matrix from task-runner's own affected output, keep GH fan-out | Yes (GitHub-hosted runners) | $0 on this repo (public, free minutes) | A JSON-emitting affected/selection command + `fromJSON` matrix; full git history in the checkout | Output-shape stability (Q2); 256-job matrix cap ([docs.github.com/.../reference/limits](https://docs.github.com/en/actions/reference/limits): "A job matrix can generate a maximum of 256 jobs per workflow run"); empty-array-is-a-hard-error, not a skip ("Matrix vector does not contain any values" — [github.com/orgs/community/discussions/27096](https://github.com/orgs/community/discussions/27096); this repo already hit this and guards it, `pr-verification.yml`'s `affected` job `if:` condition) |
| **moonrepo `moon ci --job <i> --job-total <n>`** | **Yes** — native, deterministic multi-machine sharding, confirmed at [moonrepo.dev/docs/guides/ci](https://moonrepo.dev/docs/guides/ci): "you can utilize moon's built in parallelism by passing `--job-total` and `--job` options ... moon will only run affected targets based on the current job slice," with a worked GitHub Actions example (`strategy.matrix.index: [0,1]` → `moon ci --job ${{ matrix.index }} --job-total 2`) | $0 — built into the open-source CLI, no hosted service | Migrating project/task config to moon's own format (`moon.yml` per project + workspace config) — a materially bigger lift than pointing an existing selector at a `plan` job | Shard-balancing algorithm (round-robin vs. cost-aware) not established from docs consulted; still a full tool migration, not a drop-in |
| Lage (Microsoft) | No — `--since` only narrows work per job; no shard/index flag exists in its CLI reference | Free/OSS | `lage.config.js` pipeline graph; remote cache needs your own Azure Blob/S3 | No shard concept at all — a matrix must be entirely hand-rolled on top of it |
| Rush + Cobuilds | Partial — "cooperative," not scheduled: N identical pipeline copies race on shared cache locks, no central assignment of work to machines | Free (local cache) or Azure/S3 cloud cache + **a Redis server** for Cobuilds | `rush-project.json` per package; Cobuilds needs Redis + cloud build cache; **you still write the GH Actions matrix that creates the N machines** | Explicitly labeled experimental by Rush itself; cache-config bugs invisible on one machine "surface with cobuilds" per Rush's own docs |
| Wireit (Google) | No | Free/OSS | `wireit` block per `package.json` script; GH Actions mode = one extra cache-setup step | Same shape as Lage: prevents redundant work on machines you already provisioned, never assigns which machine runs what |
| Bazel / Pants / Buck2 + REAPI (BuildBuddy, EngFlow, Buildbarn, Buildfarm, NativeLink) | **Yes — genuine, server-side, cross-machine action distribution, confirmed for all three from their own docs** | REAPI servers: BuildBuddy free tier 100GB cache transfer/80 cores, paid pay-as-you-go, enterprise custom; EngFlow free tier capped at **1 machine/32 cores** (i.e. not really distributed until paid), enterprise custom "hundreds to thousands of machines"; Buildbarn/Buildfarm/NativeLink self-hostable OSS | A full BUILD-file rewrite of every package in a Starlark-family DSL (Bazel: `rules_js`/Aspect; Pants: BUILD + dependency inference, TS support "still experimental"; Buck2: `BUCK` files, no first-party pnpm-workspace ruleset found) | Distribution is a property of the REAPI **server**, not the client — three build systems, one shared mechanism; migration is a rewrite, not a config swap; Pants labels its own remote execution "still experimental" |
| Nx without Nx Cloud (`nx show projects --affected --json` → matrix) | Yes, but **not an Nx-documented recipe** — `--json` is a real, working flag confirmed straight from Nx's own source (`packages/nx/src/command-line/show/command-object.ts:67-69`) and confirmed shipped by an Nx maintainer on [nrwl/nx#21602](https://github.com/nrwl/nx/issues/21602), but it does not appear on the live CLI reference page ([nx.dev/docs/reference/nx-commands](https://nx.dev/docs/reference/nx-commands) lists `--affected`, `--base`, `--type`, `--sep` for `show projects` — no `json`), and Nx's own official `@nx/workspace:ci-workflow` generator template only ever emits a single-job `nx affected` workflow with Nx Cloud as its one commented-out scale-out line | $0 (OSS CLI) | Same shape as this repo's option (c) today: a hand-assembled `plan`-style job running `nx show projects --affected --json` into `fromJson()` — the pattern exists only in community writeups (e.g. issue #21602, third-party repo `aligent/workflows`), not in Nx's docs | Undocumented flag (could be de-prioritized/changed without the visibility a documented flag gets); this is "option (c) again," not a new mechanism |
| `nx-set-shas` | N/A (base-SHA helper, not distribution) | Free (GitHub Action) | `uses: nrwl/nx-set-shas@v5` | None specific — but see Q4: it exists as a standalone, well-maintained tool specifically because base-SHA computation is a real, recurring problem no task runner solves for you |
| CI runner vendors: Depot, Blacksmith, WarpBuild | No — "replaces the runner, not the orchestrator"; you author the matrix, they just make each cell faster/bigger | Depot: $0.006/min after included minutes, tiers $20–200+/mo; Blacksmith: ~$0.004/min (x64), 3,000 free min/mo; WarpBuild: $0.004–0.064/min, uncapped concurrency ("a 30-entry matrix claims 30 machines" — matrix still user-authored) | Point workflow at vendor runner labels; no task-runner-specific product beyond generic/Docker-layer cache (Depot separately sells a Bazel/Turborepo/Go/etc.-compatible remote *cache*, not execution) | None distribute one invocation automatically; this row addresses option (b)'s cache story, not (c)'s distribution story |
| CI runner vendor: Namespace | **Yes, but Bazel-only** — "Namespace runs your Bazel actions on workers it keeps running for your workspace, so a build can spread across many workers" via Bazel's own REAPI with Namespace as the backend. Turborepo integration is cache-only (no execution-splitting language found) | Team $100/mo (100k unit-min), Business $250/mo (250k unit-min), pay-as-you-go available; Bazel-specific: cache hits $0.10/1,000, CAS storage $0.20/GB-mo, RE billed per minute | Bazel itself as the task runner (see Bazel row) to reach the distribution behavior; the Turborepo path only gets a remote cache | Only relevant to this repo if Bazel were also adopted — otherwise it is the same "runner vendor" story as the row above |

---

### Correction to given fact #4

The task states Nx said the CREEP cache-poisoning vulnerability class is tool-agnostic,
"Turborepo included." Checked directly against Nx's own primary sources (2026-09-18):

- Deprecation notice
  ([nx.dev/docs/reference/deprecated/self-hosted-cache-packages](https://nx.dev/docs/reference/deprecated/self-hosted-cache-packages)):
  "`@nx/s3-cache`, `@nx/gcs-cache`, `@nx/azure-cache`, and `@nx/shared-fs-cache` are deprecated as
  of 2026-05-21. The CREEP vulnerability (CVE-2025-36852) affects all four packages. The flaw is
  in their design and cannot be patched."
- The disclosure blog post
  ([nx.dev/blog/cve-2025-36852-critical-cache-poisoning-vulnerability-creep](https://nx.dev/blog/cve-2025-36852-critical-cache-poisoning-vulnerability-creep))
  states "a severity score of 9.4 (Critical)" — Nx's own text never uses the word "CVSS." GitHub's
  structured advisory record for this CVE (GHSA-rrr2-jcr8-7q3x) lists severity as "critical" but
  its `cvss.score` field is `null` — so the 9.4 figure's exact provenance (whose CVSS calculation)
  is not established from the sources checked.
- A second post
  ([nx.dev/blog/creep-vulnerability-build-cache-security](https://nx.dev/blog/creep-vulnerability-build-cache-security))
  does state the class is tool-agnostic: "Other build systems and other remote cache solutions for
  Nx we are aware of are also vulnerable to the CREEP vulnerability," and "This can be done with
  absolutely any tool (WebPack, Javac etc)." **But Turborepo is never named in either post** — the
  string "Turborepo" appears on that page only as unrelated blog-index metadata embedded in the
  page's JSON payload, not in prose about the vulnerability.

**Verdict**: the substance of given fact #4 holds — real CVE, real deprecation, genuinely
tool-agnostic vulnerability class, so the risk this poses to option (b) (§1 table) stands
regardless. But the specific quoted attribution "Turborepo included" was not found in Nx's own
sources and should not be repeated as something Nx said. Flagging this because the task explicitly
invited scrutiny of facts 1–4, and this is the one place scrutiny changed something (a specific
quote), not the substance.

---

## 2. Question 1 — is there a fourth option?

Yes. Enumerating the space surfaces a genuine fourth mechanism, plus the fact that this repo
already runs a hand-rolled version of the third.

**moonrepo's `moon ci --job <index> --job-total <n>`** is native, deterministic, multi-machine
work-splitting, built into the open-source CLI, no hosted service required. Confirmed at
[moonrepo.dev/docs/guides/ci](https://moonrepo.dev/docs/guides/ci) (2026-09-18): "you can utilize
moon's built in parallelism by passing `--job-total` and `--job` options... moon will only run
affected targets based on the current job slice," with a documented GitHub Actions example:

```yaml
strategy:
  matrix:
    index: [0, 1]
steps:
  - run: 'moon ci --job ${{ matrix.index }} --job-total 2'
```

This is architecturally distinct from (a)/(b)/(c): the CI matrix is **static** (a fixed shard
count declared once, e.g. `[0, 1]`), and moon's own scheduler decides at run time which affected
targets land in which shard — the CI YAML never has to know package names, so there is no `plan`
job and no dynamic `fromJSON`. It distributes across machines (yes, one GitHub runner per shard),
costs nothing beyond adopting moon, and needs no paid service. The cost is elsewhere: it requires
migrating project/task configuration into moon's own format (`moon.yml` per project + workspace
config) — a materially bigger lift than pointing an existing selector at a `plan` job. How moon
balances shards (round-robin vs. cost-aware bin-packing) was not established from the docs
consulted alone; listed under unverified claims.

**This repo already implements a hand-rolled version of option (c), with pnpm as the selector,
not any task runner** — see §0.1, implementation #2 (`pr-verification.yml`'s `plan` → `affected`
matrix job). This reframes the question: "does option (c) work" is not open — it demonstrably
does, in production, today, at 12 matrix jobs (well under GitHub's 256-job cap). The real
question is narrower and is answered in Q4: should the *selector* inside that already-working
mechanism change from `pnpm ls --filter "...[ref]"` to something turbo-native.

**Nx without Nx Cloud is the same mechanism as (c), and Nx does not document it as a supported
recipe either.** `nx show projects --affected --json` is a real, working flag — confirmed directly
from Nx's own source (`packages/nx/src/command-line/show/command-object.ts:67-69`) and confirmed
shipped by an Nx maintainer on
[nrwl/nx#21602](https://github.com/nrwl/nx/issues/21602) (a user asking for exactly this, for "a
CICD pipeline in Github Actions... matrix strategies") — but it does not appear on the live CLI
reference page, and Nx's own official `@nx/workspace:ci-workflow` generator template emits only a
single-job `nx affected` workflow with Nx Cloud's `start-nx-agents` as its sole, commented-out,
scale-out option. The GH-matrix pattern using this flag exists only in community writeups (the
same GitHub issue; a third-party repo, `aligent/workflows`). This matters for framing: it is
independent confirmation that option (c) — hand-assembling a `plan`+matrix job around an
affected-JSON flag — is not a gap in any one tool's maturity; it is consistently the
do-it-yourself layer across the entire ecosystem, Nx included, not something this repo is missing
by using pnpm instead of a "real" task runner.

Option (c)'s own mechanics are GitHub's, not any task runner's, and are all confirmed
primary-source: `fromJSON()` converts a job-output string into an iterable matrix
([docs.github.com/.../using-a-matrix-for-your-jobs](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs),
pattern: `matrix: color: ${{ fromJSON(needs.define-matrix.outputs.colors) }}`); a matrix is capped
at **256 generated jobs per workflow run**
([docs.github.com/.../reference/limits](https://docs.github.com/en/actions/reference/limits)) —
this repo runs 12, nowhere near the cap; and an empty-array matrix is a **hard workflow error**,
not a silent skip ("Matrix vector does not contain any values" — GitHub's own community forum,
[github.com/orgs/community/discussions/27096](https://github.com/orgs/community/discussions/27096);
this repo already hit this in practice and guards it with an explicit `if:` on the `affected`
job — `if: ${{ needs.plan.result == 'success' && needs.plan.outputs.packages != '[]' }}`).

**Everything else in the space either doesn't distribute, or distributes only by adopting an
entirely different build system.** In order of how close each comes to a real fourth option:

- **Bazel, Pants, and Buck2 all do real, server-side, cross-machine distribution** via the Remote
  Execution API (REAPI) — confirmed directly from each project's own docs: Bazel
  ("[Remote execution](https://bazel.build/remote/rbe) of a Bazel build allows you to distribute
  build and test actions across multiple machines, such as a datacenter"), Pants
  ("[Remote execution](https://www.pantsbuild.org/dev/docs/using-pants/remote-caching-and-execution/remote-execution)
  allows Pants to offload execution of processes to a remote server that complies with... 'REAPI'"
  — but "Remote execution support is still experimental," Pants' own words), and Buck2
  ("[built on Bazel's remote execution API](https://buck2.build/docs/users/remote_execution/)").
  Distribution here is a property of the REAPI **server**, not the client — BuildBuddy and EngFlow
  sell it hosted (EngFlow's free tier is capped at 1 machine/32 cores, i.e. not actually
  distributed until paid; BuildBuddy's free tier reaches 80 cores); Buildbarn, Buildfarm, and
  NativeLink are self-hostable open source. The cost that rules this out here is adoption, not
  money: all three require rewriting every package's build description in a Starlark-family DSL
  (`BUILD`/`BUCK` files) — for a pnpm/TS shop this means, at minimum, adopting Aspect's `rules_js`
  for Bazel, which ships [its own migration guide](https://docs.aspect.build/guides/rules_js_migration/).
  This is a rewrite, not a config swap, and it is the same conclusion the task's own framing
  anticipated — recorded here because it is now confirmed rather than assumed.
- **Namespace** (a CI runner vendor, see below) is the one third party found to offer genuine
  single-invocation, multi-machine splitting matching the Nx Agents pattern — but it is Bazel's
  own REAPI mechanism with Namespace as the backend
  ("[Namespace runs your Bazel actions on workers it keeps running for your workspace, so a build
  can spread across many workers](https://namespace.so/docs/bazel/execution)"); its Turborepo
  integration is a remote **cache**, not execution-splitting. It only becomes relevant here if
  Bazel is also adopted, which the point above already rules out on adoption cost.
- **Rush's "Cobuilds"** (https://rushjs.io/pages/maintainer/cobuilds/) is the closest thing to a
  distribution feature among the JS-ecosystem task runners, and is explicitly labeled
  **experimental** by Rush itself: N identical `rush build` invocations run on N CI-provisioned
  machines and cooperate through a shared build cache with Redis-based locking — "a lightweight
  solution for distributing work across multiple machines... allowing them to share work via
  Rush's build cache." This is cooperative cache-racing, not a scheduler: nothing assigns which
  machine runs which package, and **the GH Actions matrix that creates the N machines still has
  to be hand-written**, same as option (c). It also still requires standing up a Redis server.
- **Lage** (Microsoft) and **Wireit** (Google) both do dependency-graph-aware execution with
  caching (local disk, or a remote cache — Azure Blob/S3 for Lage, the GitHub Actions cache
  service for Wireit) but neither has any shard/index concept in their CLI reference docs
  ([Lage](https://microsoft.github.io/lage/docs/reference/cli/),
  [Wireit README](https://github.com/google/wireit)) — a second search pass with different
  keywords ("distributed," "shard," "multiple machines") confirmed the absence for Wireit rather
  than just failing to find it. Both are single-machine tools whose caching *reduces* what a
  hand-rolled matrix has to redo across machines, but supply no distribution mechanism themselves.
- **Third-party CI runner vendors** (Depot, Blacksmith, WarpBuild) sell faster/bigger/cheaper
  individual GitHub Actions runners (roughly $0.003–$0.13/min depending on OS/vCPU) — they
  "replace the runner, not the orchestrator": the matrix is still authored by us, they just make
  each cell of it faster. None was found to offer automatic splitting of one task-runner
  invocation across their machines. Depot separately sells a remote build **cache** compatible
  with Turborepo, Bazel, Go, and others (https://depot.dev/products/cache) — relevant to option
  (b) (single runner + remote cache), not to distribution.
- **Turborepo has discussed distributed/multi-machine execution twice, on its own GitHub
  Discussions, and never planned it**: "[RFC] Remote workers"
  ([discussions/7491](https://github.com/vercel/turborepo/discussions/7491), verified via the
  GitHub GraphQL API to be the same content as the converted original issue #1953 — identical body
  and `createdAt`) remains filed under "Ideas" with no roadmap commitment; "Distributed task
  execution" ([discussions/7766](https://github.com/vercel/turborepo/discussions/7766), opened
  March 2024) is still unanswered. A discussions-search for `"remote execution"` turned up nothing
  else relevant. This directly corroborates given fact #1 (no distributed execution, and now with
  the specific evidence of *why* — it was proposed by the community, twice, and never adopted).

## 3. Question 2 — how stable is `--dry=json`?

The premise needs revising before the stability question can be answered as posed: **`--dry=json`
is not the only, or even the best-documented, mechanism for "which packages are affected, as
JSON."** Turborepo ships two purpose-built alternatives, both confirmed directly from
[turborepo.dev](https://turborepo.dev) on 2026-09-18, that are a smaller, more intentional
contract than parsing per-task dry-run output:

- **`turbo ls --affected`** ([turborepo.dev/docs/reference/ls](https://turborepo.dev/docs/reference/ls)):
  "Automatically filter to only packages that are affected by changes on the current branch." The
  `--affected` flag itself carries no experimental marking. Combined with `--output=json`
  ("Format to output the results. `json` or `pretty` (default)") it produces the affected-package
  list as JSON — but **`--output=json` is explicitly marked experimental** in the docs (an
  experimental badge sits directly on that flag). So the *filtering* half is documented as
  stable; the *JSON-serialization* half is explicitly not yet.
- **`turbo query`** ([turborepo.dev/docs/reference/query](https://turborepo.dev/docs/reference/query)):
  a GraphQL interface over the package/task graph, with an `affected` shorthand. Docs describe its
  JSON output as "identical to what you'd get from a raw query," returning an
  `affectedPackages.items` array with package metadata and change reasons. No experimental badge
  was found on `query` itself in the fetched page (the only badge found anywhere in this research
  was on `ls`'s `--output` flag) — a positive-but-soft signal, not a stated stability guarantee,
  and it should be cross-checked against turbo's changelog before being relied on.
- For completeness, the flag the task named: **`--dry` / `--dry-run`**
  ([turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run)) accepts
  `--dry=json` ("Specify `--dry=json` to get the output in JSON format"), with no experimental or
  stability disclaimer found on that flag in the fetched page.

Given this, the honest Q2 answer has two layers:

1. **If the CI glue is rewritten to consume `turbo ls --affected --output=json` (or `turbo
   query`'s affected shorthand) instead of `--dry=json`**, the contract shrinks from a full
   per-task dependency/hash/env-var graph to a package list — and one layer of it (`--affected`
   itself) is documented as stable today, while the JSON-serialization layer is explicitly
   experimental. Realistic posture: pin the turbo version and contract-test the JSON shape in CI
   (which this repo already does for its own workflow shape via `test_ci_workflow_contract.rb` —
   the same discipline extends naturally), not assume forward compatibility across turbo minors.
2. **Independently re-verified claim #1** (turbo's own CI docs don't document matrix/multi-runner
   patterns) directly against
   [turborepo.dev/docs/crafting-your-repository/constructing-ci](https://turborepo.dev/docs/crafting-your-repository/constructing-ci)
   on 2026-09-18: the word "matrix" does not appear on the page at all, and neither does "ls" or
   "distribute." The claim holds. The page *does* separately mention `turbo query affected` — but
   only as a way to **skip work within the single-runner model** ("Using `turbo query affected`,
   you can skip lengthy container preparation steps like dependency installation"; "If you only
   need a binary 'affected or not' signal, use `--exit-code`"), never as a matrix-generation
   recipe. So turbo's own official guidance does not, today, show how to turn `ls --affected` or
   `query affected` into a CI matrix — that recipe, if it is to exist, would have to be
   assembled by us, the same way `pr-verification.yml`'s `plan` job assembles one today from pnpm.
   Re-checked the experimental badge's exact scope too: it sits specifically on the `--output`
   flag under the `ls` shorthand (confirmed on both the standalone
   [`reference/ls`](https://turborepo.dev/docs/reference/ls) page and the `ls` shorthand section
   of [`reference/query`](https://turborepo.dev/docs/reference/query)) — no other experimental
   marker was found on `query` itself, `query affected`, or `--affected`. So precisely: JSON
   serialization is experimental; the affected-filtering logic is not.
3. **`--dry=json`'s shape did break, silently, across the 1.x→2.0 boundary — confirmed by diffing
   the project's own committed integration-test fixtures**, not just reading prose:
   [v1.13.4's `dry-json/monorepo.t`](https://github.com/vercel/turborepo/blob/v1.13.4/turborepo-tests/integration/tests/dry-json/monorepo.t)
   vs.
   [v2.0.0's](https://github.com/vercel/turborepo/blob/v2.0.0/turborepo-tests/integration/tests/dry-json/monorepo.t).
   Per-task: `resolvedTaskDefinition.outputMode` renamed to `outputLogs`; per-task `dotEnv` and
   `globalCacheInputs.globalDotEnv` removed; `envMode`'s default flipped `"loose"`→`"strict"` for
   the same field name. These correspond to entries the
   [v2.0.0 release notes](https://github.com/vercel/turborepo/releases/tag/v2.0.0) mark
   **"Breaking"** (PR
   [#8149](https://github.com/vercel/turborepo/pull/8149),
   [#8181](https://github.com/vercel/turborepo/pull/8181),
   [#8182](https://github.com/vercel/turborepo/pull/8182)) — but every one is framed in the
   changelog as a `turbo.json` *config-schema* change; none is described as a `--dry`/JSON-output
   change. A CI script parsing those exact fields via `--dry=json` would have broken with no
   changelog entry telling it why. The top-level envelope keys are unchanged across the boundary;
   the break is nested inside `tasks[]`/`globalCacheInputs`. **No stability promise exists
   anywhere**: `turborepo.dev/docs/reference/run` calls the per-task field list itself
   "non-exhaustive," and the published `@turbo/types` `DryRun` TypeScript interface is marked "not
   complete" in its own source and is byte-identical between the two version tags — it never
   tracked the real shape either. This resolves the stability question the task asked as
   originally framed: **`--dry=json` is not a stable contract, has broken before, and is not
   instrumented to tell a consumer when it breaks again.**
4. **The tool most likely to consume `--dry=json` for exactly this purpose — `turbo-ignore` — is
   itself deprecated.** Its source
   ([`packages/turbo-ignore/src/ignore.ts`](https://github.com/vercel/turborepo/blob/main/packages/turbo-ignore/src/ignore.ts))
   literally runs `turbo run <task> --filter="<workspace>...[<ref>]" --dry=json` and parses
   `JSON.parse(stdout).packages` — direct confirmation that `--dry=json` was, in fact, an official
   consumption pattern. But the tool self-reports as deprecated
   ([turborepo.dev/docs/reference/turbo-ignore](https://turborepo.dev/docs/reference/turbo-ignore)):
   "turbo-ignore is deprecated... Use `turbo query affected` instead," a replacement shipped in
   [Turborepo 2.9](https://turborepo.dev/blog/2-9). Vercel's own migration path away from
   `--dry=json` and toward `query affected` is now independently confirmed, not just inferred from
   the experimental-badge placement in §3 above.
5. **No official CI-matrix recipe exists for either mechanism.** Both
   [`docs/guides/skipping-tasks`](https://turborepo.dev/docs/guides/skipping-tasks) and
   [`docs/crafting-your-repository/constructing-ci`](https://turborepo.dev/docs/crafting-your-repository/constructing-ci)
   (independently re-fetched, §3 above) show `turbo query affected` used only for pass/fail
   skip-decisions on a single runner, never for generating a matrix. The only thing found that
   does this is a small third-party GitHub Marketplace action,
   ["Turbo Changed"](https://github.com/marketplace/actions/turbo-changed)
   (`trampoline-cx/action-turbo-changed`, 45 stars), whose own README hardcodes
   `turbo run build --dry-run=json` and exposes an `affectedWorkspaces` output "useful for running
   matrix jobs" — i.e. the one third party doing this in public is using the mechanism Vercel is
   actively deprecating.

## 4. Question 3 — is the framing wrong? (reduce vs. distribute)

See §0.3 above for the full evidence trail (file:line and log-line citations). Headline answer,
stated plainly:

- Reduction found exactly one confirmed bug (135.44 s, contracts job), and it sits off the
  critical path — 0 s of measured wall-clock benefit today.
- The one edge-worker item that looked like a second instance of the same bug (63 s) is
  deliberate by the repo's own design comment — not reducible without relitigating a test that
  is currently correct.
- The remaining ~250 s of edge-worker is latency-bound (real Neon round-trips, real Durable
  Object alarms), not CPU-bound — a faster/bigger runner would not shorten it, and no caching
  strategy applies to a `test:integration` run that must hit a live database.
- Distribution (parallel fan-out across 12 runners) recovers 4.80× (1652 s summed → 344 s
  longest). Reduction recovers ≈0% of the measured critical path this run. **"Make the tests
  faster" is not a substitute for distribution on this evidence; it is, at best, a secondary,
  independent lever that should still be applied (fix the contracts bug — it is real, it is free,
  it just isn't urgent for wall clock).**
- Counterfactual, for completeness: edge-worker (starts 05:58:45, ends 06:04:29) currently has
  48 s of slack over the next-latest job, `affected (web)` (starts 05:58:54, ends 06:03:41). Any
  future cut to edge-worker larger than 48 s would make `web` the new critical path, at which
  point wall clock would be ≈ web's finish (06:03:41) + the same ~7 s aggregator tail ≈ 325 s
  measured from workflow creation — a reduction from 373 s to ≈325 s (≈13%), *if* such a cut
  existed. None was found to exist on this run's evidence.
- One structural point this arithmetic makes concrete, and which holds under every option in §1,
  not just the status quo: the workflow's final required-check job ("PR Verification") is gated
  on the affected fan-out **as a unit** — it started 3 s after `affected (edge-worker)`'s
  `completedAt`, i.e. it waits for the slowest matrix member, whatever produced the matrix. That
  is invariant across (c) with any selector (pnpm today, turbo tomorrow) and across moonrepo's
  static-shard variant — the aggregator still waits for the slowest shard. It is **not** invariant
  under (b): collapse the matrix into one runner and the aggregator waits for the sum, 1652 s, not
  the max, 344 s. This is the mechanism behind the 4.80× figure, stated as a property of the
  workflow graph rather than just an arithmetic ratio.

## 5. Question 4 — clean single declared graph without the CI risk

Partial answer from §0.1: the three existing implementations do not diverge on *selection
algorithm* — all three already call the same pnpm primitive. They diverge on base-ref semantics
(three different definitions of "before"), on policy allow/deny lists (business decisions, not
tooling), and on one hard blocker: pnpm/pnpm#12626 (nested-worktree `[<ref>]` selector returns
nothing), which is why the pre-push gate cannot use pnpm's own selector and hand-rolls a
grep/prefix-join instead.

**Turbo's own `--affected` does not remove the base-ref hand-writing, it just relocates it.**
Confirmed from [turborepo.dev/docs/reference/run](https://turborepo.dev/docs/reference/run)
(2026-09-18): `--affected` defaults to `--filter=...[main...HEAD]`, but is overridable with
`TURBO_SCM_BASE` and `TURBO_SCM_HEAD` environment variables (example given in the docs:
`TURBO_SCM_BASE=development turbo run build --affected`). This means turbo can be pointed at any
base ref, but **something still has to compute that ref** — merge-base for CI,
pushed-remote-sha-or-HEAD~1 for pre-push (the CD base-ref walk this sentence used to list is
withdrawn with §0.1's third implementation). Swapping the selector from `pnpm ls --filter
"...[ref]"` to `TURBO_SCM_BASE=<ref> turbo ls --affected` changes which CLI receives the
already-computed ref; it does not remove the code in `pr-verification.yml`'s `plan` job that
computes it. Point (1) from §0.1 stays hand-written under any tool.

**Independent corroboration that base-ref computation is a real, recurring, ecosystem-wide problem
rather than this repo's own tooling debt**: `nx-set-shas`
([github.com/nrwl/nx-set-shas](https://github.com/nrwl/nx-set-shas), README confirmed 2026-09-18)
exists as a standalone, separately-maintained GitHub Action for exactly this one problem, because
Nx itself does not solve it either. It walks GitHub's own Actions API to find "the commit SHA of
the last successful CI run" on the base branch for `push` events (falling back to `HEAD~1` with a
logged warning if none is found — the identical `HEAD~1` fallback shape as the pre-push gate in
§0.1, independently arrived at), or "the commit SHA from which the PR originated" for
`pull_request` events. That a well-maintained, widely-used, official
Nx-organization tool exists solely to compute a base SHA is strong evidence that no monorepo task
runner — turbo included — makes this part go away; it only changes which CLI the computed ref is
handed to. This directly corroborates the conclusion above, from a second, independent tool.

A second, previously-unknown-to-us gotcha from the same page: turbo's affected detection warns
"If the checkout is too shallow, then all packages will be considered changed," recommending
`--filter=blob:none --depth=0`. This repo's CI checkouts already use `fetch-depth: 0`
(`pr-verification.yml`'s `actions/checkout` step), so this is already satisfied operationally for
the CI lane; it would need the same check for the pre-push/local case (normally moot, since local
clones are rarely shallow, but worth stating rather than assuming).

**Turbo does have a documented history of worktree-related git-root bugs in its change-detection
layer — but the specific failure mode found is the inverse topology of pnpm/pnpm#12626, which is
mild evidence in favor of point (3) actually being removable.** PR
[#11974](https://github.com/vercel/turborepo/pull/11974) (merged 2026-02-23, shipped same-day in
canary `v2.8.11-canary.27`) fixed `git_root` resolving to the *main* worktree instead of the
*current* one, which broke path-anchored hashing/`--affected` detection — but specifically for a
linked worktree **outside/sibling to** the main checkout; per the same fix's own characterization,
**worktrees nested inside the main repo were already the working case before this fix**. That is
the opposite layout from pnpm/pnpm#12626 (which breaks specifically on worktrees nested *inside*
the repo — this repository's own layout, one worktree per card, per §0.1). A second, narrower bug
recurred in PR [#13503](https://github.com/vercel/turborepo/pull/13503) (merged 2026-07-28): the
fast-path git-index reader was hardcoded to `<git_root>/.git/index`, silently degrading to slower
`git` subprocess calls in any linked worktree — a performance regression, not an incorrect result.
Separately, and relevant to caching rather than affected-detection: issue
[#13651](https://github.com/vercel/turborepo/issues/13651) — closed via a docs-only PR, not a code
fix — describes a cache built in one worktree replaying absolute-path outputs into another, which
is a live risk for this repo's one-worktree-per-card model if turbo's *cache* (not its selector) is
adopted across cards.

**Conclusion for Q4**: on the evidence found (which is git-history archaeology reported by a
research pass, not independently re-diffed here — treat with the same care as any secondhand
account), turbo's git-ref selector's known bug history does not obviously reproduce pnpm's
specific nested-inside-worktree failure; if anything, nested-inside was turbo's *working* case.
That makes it plausible point (3) from §0.1 could be removed by switching the pre-push gate to a
turbo-native selector — but this is exactly the kind of claim the report's own method section
requires verifying empirically before relying on it, not inferring from a changelog. It is also
the reason the recommendation below proposes measuring agreement before switching anything, rather
than assuming turbo fixes this. Point (1) (base-ref computation) and point (2) (policy lists)
remain hand-written under any tool, as already established.

## 6. Recommendation

**Decision criterion**: given the constraints (solo maintainer, KISS is load-bearing, a false
green is strictly worse than a slow gate, no paid services, wall-clock is the only cost that
matters), the criterion is *how much hand-written code each option removes, versus merely
relocates* — a change that moves hand-written logic from one file to another, or that trades a
known, working mechanism for an equivalent one plus a new tool to pin and a new experimental flag
to contract-test, is not worth the migration risk on this repo, regardless of elegance.

Applying it:

- §0.1 established that the three existing "affected" implementations already share one selection
  primitive (`pnpm ls -r --depth -1 --json[--filter "...[ref]"]`). They diverge on three things:
  base-ref semantics, policy allow/deny lists, and one real tooling bug (pnpm/pnpm#12626, forcing
  the pre-push gate off the shared selector entirely).
- §5 (Q4) established that turbo's `--affected` still needs a base ref supplied via
  `TURBO_SCM_BASE`/`TURBO_SCM_HEAD` — **adopting turbo does not remove the base-ref computation**
  in any of the three call sites; it relocates which CLI receives an already-computed ref.
  Policy allow/deny lists are business logic no tool supplies. So turbo can remove, **at most**,
  the third divergence (pnpm/pnpm#12626's nested-worktree bug). Turbo's own worktree-bug history
  (PR #11974) suggests nested-inside-repo worktrees — this repo's own layout — were its *working*
  case even before that fix, which is mild evidence the divergence is removable; but that finding
  is secondhand git-history archaeology in this report (§5, "Claims not verified"), not something
  independently re-diffed here, so it is evidence to test, not to act on directly.
- §2 (Q1) established that every option that *does* offer more than this either requires a full
  build-system rewrite (Bazel/Pants/Buck2, and Namespace's real distribution is Bazel's mechanism
  wearing a different vendor's name), a full migration to a different tool's own project format
  with no dynamic-matrix win over what exists today (moonrepo — genuinely native sharding, but at
  the cost of moving every package's task definitions into moon's config), or is simply option (c)
  again with a different selector and the same shape (Nx without Cloud). None of these clears the
  bar the criterion sets: none removes more hand-written code than it costs to adopt.
- §3 (Q2) established that turbo's own JSON-affected-output path (`--output=json` under both `ls`
  and `query`) is explicitly experimental today, while the affected-filtering logic underneath it
  is not. Wiring CI's merge gate — the one place a false green is catastrophic — to an
  experimental flag fails the "false green is the worst outcome" constraint on its own, independent
  of everything else.

**Recommendation**: adopt Turborepo scoped to what it is documented to be for — a single-machine
task graph with caching for the **local/dev-loop** (`turbo.json` declaring the existing
lint/typecheck/test/build scripts, run via `turbo run <task>` on a laptop) — and leave the CI
merge-gate's package-selection mechanism exactly as it is (pnpm-driven option (c), already
working, already proven at 4.80× over a single-runner alternative) until `--output=json` leaves
experimental status or is independently contract-tested the way this repo already contract-tests
its own workflow shape (`test_ci_workflow_contract.rb`). Do not adopt moonrepo, Nx, any REAPI
build system, or any third-party runner vendor for this problem — each was ruled out above on the
same criterion, not on unfamiliarity.

**First reversible step**: add a `turbo.json` that declares the existing per-package scripts with
no `dependsOn: ["^build"]` (there is none today, per the stated constraints) and `cache: false` on
the packages already known to be non-cacheable (the ones touching `test-postgres`'s real PostGIS
container and any lane touching the schema-preflight retry path). Do not touch any workflow file
yet. Then, as a side, additive CI step (not gating anything), run
`TURBO_SCM_BASE="$merge_base" turbo ls --affected --output=json` alongside the existing `plan` job
— reusing the exact `merge_base` variable `plan` already computes (§0.1), not turbo's bare
`main...HEAD` default, since a `merge_group` event or a `main` that has advanced past the PR's
base would otherwise make the two sides compare against different base refs and manufacture a
disagreement that is an artifact of the harness, not a finding about either tool. Diff turbo's
package list against `plan`'s `pnpm`-derived one across a run of PRs. Agreement is the evidence
needed to flip the one line in `plan` from `pnpm ls --filter "...[$merge_base]"` to the
turbo-native equivalent; disagreement finds a real bug in one tool or the other before it can
produce a false green — at zero cost to the merge gate either way, and fully reversible by
deleting `turbo.json`. Run the same `turbo ls --affected` invocation once from inside an actual
nested card worktree, by hand, before touching `pre-push-affected.sh` — this is the direct,
first-party test of the one open question in §5 (whether turbo's selector actually tolerates this
repo's one-worktree-per-card layout), and it costs nothing to run.

**Side finding, unrelated to the architecture question but free to act on**: the contracts job's
135.44 s bug (§0.3 / release-schema-gate.test.rb missing `UNAVAILABLE_POLL_SECONDS=0`) is real,
low-risk, and a one-line fix. It does not affect today's wall clock (it is off the critical path),
so it is not part of this recommendation, but there is no reason to leave it unfixed.

## Claims not verified

- **moonrepo's shard-balancing algorithm.** Confirmed that `--job`/`--job-total` exists and does
  native sharding (§2), but not confirmed *how* moon assigns affected targets to shards
  (round-robin, cost-aware bin-packing, or something else) — not established from
  `moonrepo.dev/docs/guides/ci` alone; would need moon's source or a deeper docs pass.
- **"Empty matrix array is a hard error" is sourced from GitHub's own community discussion forum**
  (github.com/orgs/community/discussions/27096: "Matrix vector does not contain any values"), not
  from GitHub's official reference docs, which were checked twice and did not state this
  explicitly. Treat as strongly corroborated (it matches this repo's own production experience,
  encoded in `pr-verification.yml`'s `if:` guard) but not docs-tier.
- **Namespace's specific runner vCPU/RAM tiers** were reported by the research subagent as
  "blog-sourced, not confirmed in official docs" — the pricing and Bazel-RE-distribution facts
  are docs-sourced and solid; the exact machine specs are not.
- **Turborepo's worktree-bug history (§5) is git-history archaeology reported by a research pass,
  not independently re-diffed by me.** The PR numbers, dates, and the "nested-inside was the
  pre-fix working case" characterization are specific enough to treat as solid, but this report
  did not itself open PR #11974's diff — flagged per the same standard applied to everything else
  (verify, don't infer), one level removed.
- **`turbo query`'s experimental status**: no experimental marker was found on the command itself
  after two direct fetches of its reference page (only on the `ls` shorthand's `--output` flag) —
  an absence-of-evidence finding, not a positive stability guarantee from Vercel. Treat as "not
  marked experimental in the docs consulted," not "confirmed stable."
- **Nx's `nx show projects --affected --json` is a real, working, source-confirmed flag that is
  absent from Nx's own live CLI reference page.** An undocumented flag can be changed or removed
  without the visibility a documented one gets; this is a real (if probably minor) adoption risk
  for anyone building the same recipe on Nx, noted for completeness since it's this report's
  closest parallel to what this repo already does with pnpm.
- **The CREEP/CVE-2025-36852 "Turborepo included" attribution** — see the dedicated correction
  section after §1: the vulnerability class is confirmed tool-agnostic by Nx's own words, but the
  specific phrase attributing it to Turborepo by name was not found in either Nx source checked.
