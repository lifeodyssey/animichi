# CI parallelism field evidence: turborepo/Nx + GitHub Actions in real public monorepos

## Method

Every claim below was read directly from a repository's own `.github/workflows/*.yml` (or a script
that workflow invokes) via `gh api` / `curl -sL raw.githubusercontent.com/...`, or from GitHub's
Actions-runs API for wall-clock timing. Each quote is tagged `owner/repo · path · sha · date read`.
Dates are 2026-09-18 unless a different read date is given. No file in `lifeodyssey/animichi` was
read for or changed by this research.

Wall-clock figures measured first-hand here are `updated_at − run_started_at` per run, which excludes
queue time; a few rows sourced from delegated research passes used `updated_at − created_at`, which
includes queue time and can inflate an outlier badly (a requeued run shows up as an apparent 60-minute
job). Where the two methods disagreed, the `run_started_at` figure was re-derived directly and is the
one quoted.

## Comparison table

| Repo | Stars | Task runner | Fans out across jobs? | Matrix computed from | Remote cache | Wall clock |
|---|---|---|---|---|---|---|
| **vercel/turborepo** (Rust CI) | 31,102 | Turborepo (own tool) | Yes — by OS × shard, one job per task/target type, **not** by package | Hand-written list (`os: [macos/ubuntu/windows]`, `shard: [1,2]`), sharded by cargo-nextest's own `--partition hash:N/M` | Yes — official `vercel/setup-turborepo-remote-cache-action` | ~6–17 min typical (n=25 sample; median ~9 min) |
| **vercel/turborepo** (JS CI) | 31,102 | Turborepo (own tool) | Only across an OS×Node-version grid (8 cells); **no per-package matrix** | Hand-written OS/Node grid; inside each cell, turbo's own `--affected` flag prunes packages within one invocation — never parsed into a GH matrix | Yes, same action | 3.9–5.2 min |
| **PostHog/posthog** | 39,843 | Turborepo (orchestrating a Django/pytest suite) | **Yes — the one confirmed genuine matrix generated from turbo's own affected/dry-run output** | `turbo run backend:test --dry-run=json` (task inventory) **+** `turbo query affected --tasks ... --base ... --head ...` (change detection) → ~1,478-line custom bin-packing script → `matrix` job output → `fromJson(...)` matrix | Not found in this workflow file | Bimodal: 0.5–1.1 min when nothing backend-relevant changed; 0.5–22.6 min on ordinary PRs; **19.7–45.3 min** for the full, un-narrowed matrix on `event=schedule` runs of `ci-backend.yml` (workflow `2111769`), measured `updated_at − run_started_at` — the draft's `n=12` does not reproduce, see §1 |
| **nrwl/nx** (own repo) | 29,352 | Nx (own tool) | Yes — Nx Cloud Distributed Task Execution (DTE); GitHub Actions defines **no** agent-count matrix at all | `.nx/workflows/dynamic-changesets.yaml` maps *diff size* (a heuristic, not a package list) to an agent-count table, read by `--distribute-on`, a file **outside** `.github/workflows/` entirely | Yes — Nx Cloud (`nxCloudId` in `nx.json`) | single `main-linux` job: 9.2–58.8 min (n=8) |
| **lerna/lerna** | 36,053 | Nx (Lerna is Nx-maintained, uses Nx on itself) | Yes — Nx Cloud DTE via a **hand-written fixed-size agent pool** in the GH matrix | `matrix.agent: [1..8]` is static; Nx Cloud's own hosted scheduler assigns real task-graph nodes to those 8 generic agents, invisible to the YAML | Yes — Nx Cloud (`NX_CLOUD_ACCESS_TOKEN`) | `main` job: 5.5–15.5 min (n=8) |
| **TanStack/query** | 50,324 | Nx | Nx Cloud (confirmed `nxCloudId` in `nx.json`) | Not fully re-derived — cited here only as a 4th large confirmed Nx Cloud user | Yes — Nx Cloud | not measured |
| **storybookjs/storybook** | 91,091 | Nx | Nx Cloud (confirmed `nxCloudId` in `nx.json`) | Not fully re-derived — cited as a 5th large confirmed Nx Cloud user | Yes — Nx Cloud | not measured |
| **microsoft/rnx-kit** | 1,734 | Nx, **not** on Nx Cloud | Job-per-task-type (Build / Build Android / Build iOS) + an unrelated OS×Node matrix; `nx affected` used only as a boolean skip-gate | N/A — no matrix built from affected output | No | PR runs 9.8–51.6 min (n=8) |
| **angular/angular** | 101,010 | **Not Nx** — Bazel + Bazel Remote Build Execution | N/A, ruled out as an Nx example | N/A | Yes, via Bazel RBE, a different system | not measured |
| **callstack/react-native-builder-bob** | 3,228 | Turborepo | No — single job; `--dry=json` used only as a cache-hit boolean gate | N/A (the common false-positive pattern for "does anyone use `--dry=json`") | Not confirmed | not measured |
| **medusajs/medusa** | 36,363 | Turborepo `^1.6.3` (pre-v2) | Yes (D) — 4 unit-test shards + 3+3 package-integration (fast/slow) + 4 HTTP-integration + 4 module-integration = 18 parallel Jest `--shard=i/n` jobs, all `needs: setup` | 100% static `shard_index`/`group` arrays, hand-written | Yes — confirmed via live job log ("Remote caching enabled") | reported ~11–13 min avg (not independently re-timed by me) |
| **withastro/astro** | 62,660 | Turborepo | Yes (B) — one job per task type, plus a coarse OS×Node×suite matrix (not per-package) | Static arrays; "affected" scoping is a bespoke `scripts/turbo-run-affected.js` wrapper around turbo's own `[gitrange]` filter syntax — scope-narrowing, not matrix generation | Yes | push ~12–20 min; PR ~17–27 min |
| **trpc/trpc** | 40,608 | Turborepo | Yes (B: build/typecheck) + one real matrix (e2e only), a **hard-coded list of 19 example-app directories** | Hard-coded array; notably the `test` (unit/integration) job bypasses turbo entirely and calls bare `vitest` | Yes for same-repo PRs | whole `main.yml` 11–18 min |
| **RSSNext/Folo** | 38,973 | Turborepo | No — single job, `turbo run format:check typecheck lint` then `turbo run test` | N/A | No Vercel Remote Cache; generic `actions/cache` on `.turbo/` | reported median ~5 min (not independently re-timed by me) |
| **vercel/next.js** | 142,333 | Turborepo present, but **not used for test orchestration** | Yes — ~35–37 hand-authored named jobs, several internally sharded with **static** `group: [1/N..N/N]` lists | Zero `fromJson`-computed matrices found; every matrix is a static literal array; the skip-gate is Graphite's stacked-PR optimizer, unrelated to turbo | Yes, but `turbo run` appears only twice in the whole file (Rust-adjacent tasks) | push ~21–46 min; PR sample 21–46 min (n=10) |
| **shadcn-ui/ui** | 124,090 | Turborepo present (`turbo.json`), but **`turbo run` never invoked in CI** | Yes, via 7 hand-written jobs (one per task type: lint/format/tsc/test/react-test/helpers-test/browser-test) | N/A — no matrix at all | No — zero `TURBO_TOKEN`/`TURBO_TEAM`/`TURBO_API` anywhere | code-check 3.9–5.2 min; test ~14.7–15.3 min; browser ~1.8–2.4 min |
| **t3-oss/create-t3-turbo** | 6,108 | Turborepo, canonical thin usage | Yes — 3 jobs (lint/format/typecheck), one per task type; **no build or test job at all** | N/A | Yes — `TURBO_TEAM`/`TURBO_TOKEN` at workflow scope, written as a teaching example | 0.6–1.1 min |
| **calcom/cal.com** | 48,535 | Turborepo | Yes — Shape B (per-task-type reusable `workflow_call` jobs) + Shape D (8-way e2e shard, 4-way e2e-api-v2 shard) | Static shard array (`shard: [1..8]`); whole e2e/integration tier gated behind a `ready-for-e2e` **PR label** | Yes, in most (not all) workflow files | full-fanout PR runs 6.8–19.8 min; label-absent (path-filter-skipped) runs ~0.5–0.9 min |
| **documenso/documenso** | 15,070 | Turborepo | **No** — single sequential job for the whole Postgres/Redis/Minio/Gotenberg e2e suite | N/A | Partial (`vars.TURBO_TEAM`, not all files) | `ci.yml` 4.0–5.2 min; `e2e-tests.yml` (unconditional on every PR) 20.7–27.4 min (n=12, `updated_at − run_started_at`) |
| **payloadcms/payload** | 44,809 | Turborepo present, but CI test scripts bypass it | Yes — Shape C+D, two independently `fromJson`-generated matrices (int + e2e) | **Hand-written list executed as a TypeScript config file** (`node .github/workflows/int.config.ts`, 14 databases × 3 shards) — mechanically identical to PostHog's `fromJson` pattern, but the content is static, not turbo/nx-derived | Not confirmed (no `TURBO_TOKEN`/`TURBO_TEAM` found in `main.yml`) | full-fanout runs ~24–27 min; path-filter-skipped runs ~5–8 min |
| **supabase/supabase** | 109,935 | Turbo present (`turbo.jsonc`) but bypassed for orchestration — only `typecheck.yml` invokes it, sequentially, in one job | Yes — but via ~15 independently-triggered **workflow files**, one per app/package, never a matrix | Native `paths:` filters per workflow file (plus occasional `dorny/paths-filter`); one vestigial single-element `matrix: test_number: [1]` that is not real fan-out | **No** — zero `TURBO_TOKEN`/`TURBO_TEAM`/`TURBO_API` anywhere in the repo | `typecheck.yml` 2.8–3.1 min; `studio-unit-tests.yml` 7.3–10.0 min |
| **modrinth/code** | 2,375 | Turborepo (`turbo.jsonc`) | **No** (Shape A) — a single `Lint and Test` job; turbo's own internal task graph (`"concurrency": "100%"`) supplies all parallelism | N/A — `--dry-run=json` here is classification (a): a cache-status gate deciding whether to `docker compose up` services **in that same job** | Yes — Namespace Cloud, confirmed live in the job log, but **internal branches only**; fork PRs fall back to uncached `ubuntu-latest` | Bimodal on push: **1.7–1.9 min on cache hit vs 12.6 min on miss**; PR 6.5–37.2 min |
| **midday-ai/midday** | 15,017 | Turborepo — but this CI is a **stub**, not live practice (see note below) | N/A — the one job holding every turbo lint/build/typecheck/test call *and* the repo's only Postgres service is hard-disabled with `if: false` | `--affected --dry-run=json` → five boolean per-service `if:` gates (classification (a)); no `strategy.matrix` anywhere | Configured (`TURBO_TOKEN: ${{ secrets.VERCEL_TOKEN }}`) but inert and log-unverifiable (GitHub returned HTTP 410 for the only checkable run) | production.yml 7.7–9.7 min; staging.yml 6.6–15.7 min — **no successful run since 2026-05-07** |
| **n8n-io/n8n** | 205,135 | Turborepo (`turbo.json`) | **Yes — the heaviest fan-out in this survey**: Shape B (typecheck/lint/backend/nodes) + Shape C/D (2-way vitest shards, a 20-way Playwright shard, a dynamic Postgres-major DB matrix) | Three genuine `fromJSON` matrices, every one generated by a **bespoke Node script** (`distribute-tests.mjs`, `db-test-matrix.mjs`); `--affected`/`--dry-run` confirmed **absent** from every file under `.github/workflows` | Yes — but via `rharkor/caching-for-turbo`, a runner-local GitHub-Actions-cache shim using the literal placeholder token `turbogha`, not Vercel or Nx Cloud | PR 16.1–29.3 min; `merge_group` (full DB matrix) 17.6–23.5 min; master push (carries no DB job at all) 9.8–13.3 min |

## Quoted YAML — the load-bearing examples

### 1. PostHog/posthog — the one confirmed matrix generated from turbo's own affected/dry-run output

`PostHog/posthog · .github/workflows/ci-backend.yml · sha 9bf14b08f389 · read 2026-09-18` (branch `master`, 39,843 stars)

The job graph is `turbo-discover` (runs a discovery script) → `build-product-test-matrix` (needs
`turbo-discover`, turns its output into a matrix `include:` list) → `turbo-tests` (needs
`build-product-test-matrix`, actually fans out):

```yaml
    turbo-discover:
        needs: changes
        # Skipped on master push: the merge queue already ran the full matrices for
        # every landed commit, and the hourly scheduled run keeps master coverage.
        if: needs.changes.outputs.backend == 'true' && github.event_name != 'push'
        runs-on: depot-ubuntu-24.04
        timeout-minutes: 20
        name: Discover product tests
        env:
            TURBO_SCM_BASE: ${{ github.event_name == 'pull_request' && format('{0}^1', github.sha) || '' }}
        outputs:
            matrix: ${{ steps.discover.outputs.matrix }}
        steps:
            - name: Discover products to test
              id: discover
              run: |
                  # turbo-discover.js uses Turbo's Git affectedness to detect
                  # changed products. Non-isolated product changes trigger the
                  # full suite (all products + Django).
                  RESULT=$(node .github/scripts/turbo-discover.js)
                  echo "matrix=$(echo "$RESULT" | jq -c '.matrix')" >> $GITHUB_OUTPUT

    build-product-test-matrix:
        name: Build product test matrix
        needs: [turbo-discover]
        if: >-
            !cancelled() &&
            needs.turbo-discover.result == 'success' &&
            needs.turbo-discover.outputs.matrix != '[]' &&
            needs.turbo-discover.outputs.matrix != ''
        runs-on: depot-ubuntu-24.04
        outputs:
            include: ${{ steps.build.outputs.include }}
        steps:
            - name: Build product matrix include list
              id: build
              env:
                  PRODUCT_MATRIX_JSON: ${{ needs.turbo-discover.outputs.matrix }}
                  RUN_NEW_EVENTS_SCHEMA: ${{ contains(github.event.pull_request.labels.*.name, 'test-new-events-schema') || github.event_name == 'workflow_dispatch' }}
              run: |
                  if [[ "$RUN_NEW_EVENTS_SCHEMA" == "true" ]]; then
                      schema_modes='[false, true]'
                  else
                      schema_modes='[false]'
                  fi
                  include=$(jq -cn --argjson matrix "$PRODUCT_MATRIX_JSON" --argjson schema_modes "$schema_modes" '
                    [ $matrix[] as $entry | $schema_modes[] as $new_events_schema | $entry + {"new-events-schema": $new_events_schema} ]
                  ')
                  echo "include=$include" >> "$GITHUB_OUTPUT"

    # Runs product tests in parallel — one matrix job per group
    # Each job gets its own runner + Docker stack, so no shared DB conflicts
    turbo-tests:
        needs: [changes, turbo-discover, detect-snapshot-mode, build-product-test-matrix, get_clickhouse_versions]
        if: >-
            !cancelled() &&
            (github.event.pull_request.draft != true ||
             startsWith(github.head_ref, 'trunk-merge/') ||
             contains(github.event.pull_request.labels.*.name, 'run-ci-backend')) &&
            needs.build-product-test-matrix.outputs.include != '[]' &&
            needs.build-product-test-matrix.outputs.include != ''
        runs-on: depot-ubuntu-24.04
        timeout-minutes: 40
        strategy:
            fail-fast: false
            matrix:
                include: ${{ fromJson(needs.build-product-test-matrix.outputs.include) }}
        steps:
            - name: Start services
              env:
                  COMPOSE_FILE: docker-compose.dev.yml:docker-compose.profiles.yml
                  COMPOSE_PROFILES: temporal,azure
                  CLICKHOUSE_SERVER_IMAGE: ${{ needs.get_clickhouse_versions.outputs.local_image }}
              run: |
                  bin/ci-wait-for-docker launch --background --down \
                    db redis7 clickhouse zookeeper kafka objectstorage \
                    temporal elasticsearch objectstorage-azure
            - run: |
                  turbo run backend:test $leg_filters --concurrency=1 --output-logs=full --force --log-order=stream $leg_args
```

The actual turbo invocations, from `PostHog/posthog · .github/scripts/turbo-discover.js · sha 9bf14b08f389`:

```js
const TURBO_BIN = './node_modules/.bin/turbo'

function runTurbo(args) {
    return execFileSync(TURBO_BIN, args, TURBO_EXEC_OPTS)
}

function affectedArgs(taskName) {
    const args = ['query', 'affected', '--tasks', taskName]
    if (process.env.TURBO_SCM_BASE) args.push('--base', process.env.TURBO_SCM_BASE)
    if (process.env.TURBO_SCM_HEAD) args.push('--head', process.env.TURBO_SCM_HEAD)
    return args
}

// --- Main ---
allTestTasks = parseTurboTasks(runTurbo(['run', 'backend:test', '--dry-run=json']))
if (!legacyChanged) {
    contractTasks = parseTurboTasks(runTurbo(['run', 'backend:contract-check', '--dry-run=json']))
}
...
affectedTestTasks = queryAffectedTasks('backend:test')     // -> runTurbo(affectedArgs('backend:test'))
affectedContractTasks = queryAffectedTasks('backend:contract-check')
```

PostHog uses **two different turbo subcommands together**, not one: `turbo run backend:test
--dry-run=json` supplies the full task/dependency **inventory** (every product that has a
`backend:test` script, structurally — this is what the cost model needs to reason about, whether or
not anything changed), and `turbo query affected --tasks backend:test --base <sha> --head <sha>`
supplies the **change-detection filter** (which of those tasks the current diff actually touches).
`turbo query affected` is a genuine, native turborepo CLI subcommand — I confirmed this by reading
turborepo's own Rust source (`vercel/turborepo · crates/turborepo-lib/src/commands/query.rs`,
`crates/turborepo-lib/src/cli/mod.rs`, sha `2c49c231c172`): `QuerySubcommand::Affected` is a real
enum variant that builds a `{ affectedTasks { ... } }` / `{ affectedPackages { ... } }` GraphQL query
against turbo's own query engine — this is not a PostHog-specific shim, it is turbo's built-in
affected-detection query surface, invoked via the ordinary local binary at
`./node_modules/.bin/turbo`. Neither subcommand's output goes straight into the GitHub matrix,
though: a ~1,478-line custom script (`turbo-discover.js`) takes both results, applies a cost model
built from historical test-duration data (`.test_durations`, refreshed several times a day by a
separate scheduled workflow), bin-packs small products together and splits large ones into
pytest-split shards, and only the resulting plan becomes the `matrix` job output that
`build-product-test-matrix` turns into `strategy.matrix.include`. This is the closest thing found
anywhere in this survey to "generate a GitHub matrix from `turbo run --dry=json`," and it required
PostHog to write substantial custom orchestration to do it — nothing here is an out-of-the-box
turbo/GitHub Actions feature, and the suite it orchestrates is Python/Django (pytest), not
TypeScript — turbo is being used purely as a change-detection/task-graph oracle sitting on top of a
pnpm workspace, one step removed from "a TS test suite fanned out this way."

Container handling (workflow id `2111769`, wall clock sampled 2026-09-18): every matrix entry gets
its own runner and its own Docker Compose stack (Postgres `db`, `redis7`, `clickhouse`, `zookeeper`,
`kafka`, object storage, `temporal`, `elasticsearch`) — shape (C) for this suite specifically, not
shape (B). But it is heavily gated: skipped entirely on master push (`if: ... && github.event_name
!= 'push'`, relying on the merge queue's `trunk-merge/**` run plus an hourly `schedule:` run for
master coverage), skipped on draft PRs unless labeled `run-ci-backend`, narrowed to only affected
products on an ordinary PR, and has kill-switches (`DISABLE_BACKEND_TEST_SELECTION`,
`SKIP_PRODUCT_TESTS`) that fall back to the **full** matrix — never fail silently — on any selector
error. Sampling `event=schedule` runs directly: **19.7–45.3 minutes**, i.e., what the full,
un-narrowed product matrix costs when nothing is skipped. The table row above and this paragraph are
one sample — every `event=schedule` run of `ci-backend.yml` (workflow `2111769`) created on
2026-09-08/09, measured `updated_at − run_started_at`. Neither the table's `n=12` nor this
paragraph's original "10 successful runs, 19.7–42.4" reproduces against that query: re-reading it on
2026-09-18 returns **48 runs, 26 of them successful**, spanning the same **19.7–45.3** minutes — the
45.3-minute run is a *success* (2026-09-08T04:32Z), so 42.4 cannot be the successful maximum. Both
sample counts are therefore marked **unverifiable** (the run IDs were never recorded) while the two
endpoints are checkable and are kept. Ordinary
PR runs range far lower (0.5–22.6 min over 20 sampled non-merge-queue runs) because most PRs don't
touch backend/product code at all, or touch only a few products.

### 2. vercel/turborepo's own CI — hand-written matrices, `--affected` inside one invocation, never a package matrix

`vercel/turborepo · .github/workflows/turborepo-test.yml · sha 2c49c231c172 · read 2026-09-18` (branch `main`, 31,102 stars) — the Rust-core side:

```yaml
  rust_test:
    name: Rust testing on ${{ matrix.os.name }} (shard ${{ matrix.shard }}/2)
    runs-on: ${{ matrix.os.runner }}
    strategy:
      fail-fast: false
      matrix:
        os:
          - { name: macos, runner: macos-15-xlarge }
          - { name: ubuntu, runner: ubuntu-latest-8-core-oss }
          - { name: windows, runner: windows-latest-8-core-oss }
        shard: [1, 2]
    env:
      TURBO_CACHE: ${{ (github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository) && 'remote:rw' || 'local:rw' }}
    steps:
      - uses: vercel/setup-turborepo-remote-cache-action@49d7b1b46ba4c9251e1977986bfe18336feabc8f # v1.1.0
        with:
          team: ${{ vars.TURBO_TEAM }}
      - name: Run tests
        run: turbo run test --filter=turborepo-crates --env-mode=loose --log-order=stream -- --partition hash:${{ matrix.shard }}/2
```

`vercel/turborepo · .github/workflows/test-js-packages.yml · sha 2c49c231c172` — the JS-package side, the workflow that answers this survey's central question for turborepo's own code:

```yaml
  js_packages:
    name: "(${{matrix.os.name}}, Node ${{matrix.node-version}})"
    strategy:
      fail-fast: false
      matrix:
        os:
          - { name: ubuntu, runner: ubuntu-latest }
          - { name: macos, runner: macos-latest }
        node-version: [18, 20, 22, 24]
    env:
      TURBO_CACHE: ${{ github.event.pull_request.head.repo.full_name == github.repository && 'remote:rw' || 'local:rw' }}
    steps:
      - uses: vercel/setup-turborepo-remote-cache-action@49d7b1b46ba4c9251e1977986bfe18336feabc8f # v1.1.0
        with:
          team: ${{ vars.TURBO_TEAM }}
      - name: Run tests
        # @turbo/repository has its own native build matrix in the Test workflow.
        run: |
          TURBO_API= turbo run check-types test build package-checks --affected --filter="./packages/*" --filter="!@turbo/repository" --color --env-mode=strict
```

Two hand-written matrices, both keyed on OS (and, for `rust_test`, a literal `shard: [1, 2]`
consumed by cargo-nextest's own `--partition hash:N/M`) — never on package name, and never computed
from `--dry`/`query`/`ls --affected`. The one real per-package mechanism, `--affected` in the JS
workflow, prunes packages **inside a single `turbo run` invocation** — it never produces a GitHub
matrix. This is turborepo's own answer, for its own code, to the exact question this survey asks: no
package matrix, no dry-run-to-matrix pipeline, just a hand-written OS/Node grid plus `--affected`
narrowing one job's scope. Wall clock: JS side 3.9–5.2 min across 8 sampled PR runs; Rust side
typically 6–17 min.

Worth noting for any repo planning to lean on a remote cache, because it recurs across this survey:
the same `js_packages` job declares the permission that makes its cache credential possible, and the
cache is deliberately downgraded for forks — `vercel/turborepo · .github/workflows/test-js-packages.yml
· sha 2c49c231c172`:

```yaml
  js_packages:
    permissions:
      contents: read
      id-token: write
```

Read together with the `TURBO_CACHE` line quoted above, the rule is that a run gets writable remote
cache (`remote:rw`) only when the PR head repository is the same repository; a fork PR silently drops
to `local:rw` and re-does the work. The underlying constraint is GitHub's, not turbo's: the
`setup-turborepo-remote-cache-action` mints its credential from the OIDC token that `id-token: write`
authorises, and GitHub does not issue OIDC tokens to fork-originated `pull_request` runs. modrinth
hits the same wall from the other direction and handles it explicitly, restricting its Namespace
cache to internal branches. The practical consequence is that remote-cache wall-clock figures
anywhere in this table describe same-repo branches; contributions from forks pay the uncached
path.

### 3. lerna/lerna and nrwl/nx — Nx Cloud Distributed Task Execution, neither a per-package GitHub matrix

`lerna/lerna · .github/workflows/ci.yml · sha 00502228ea63 · read 2026-09-18` (branch `main`, 36,053 stars; `nx.json` carries `"nxCloudAccessToken": "..."`):

```yaml
env:
  NX_CLOUD_ACCESS_TOKEN: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}
jobs:
  main:
    name: Nx Cloud - Main Job
    steps:
      - run: npx nx-cloud start-ci-run --stop-agents-after="run-e2e-tests-ci"
      - name: Run parallel distributed tasks
        uses: jameshenry/parallel-bash-commands@943dfd1eebfab8bbf19782c47a85c9ca7e8d245c # v1
        with:
          cmd1: npx nx-cloud record -- npx nx format:check
          cmd2: npx nx run-many -t build --parallel=3
          cmd3: npx nx run-many -t lint --parallel=3
          cmd4: npx nx run-many -t test --parallel=3 --maxWorkers=2
          cmd5: npx nx run integration:integration --maxWorkers=2
      - run: PUBLISHED_VERSION=999.9.9-e2e.0 npx nx run-many -t run-e2e-tests-ci --parallel=1
      - name: Run Nx Cloud Self-Healing CI
        if: ${{ always() }}
        run: npx nx-cloud fix-ci
      - name: Stop all running agents
        if: ${{ always() }}
        run: npx nx-cloud stop-all-agents

  agents:
    name: Nx Cloud - Agent ${{ matrix.agent }}
    strategy:
      matrix:
        agent: [1, 2, 3, 4, 5, 6, 7, 8]
    steps:
      - run: npx nx-cloud start-agent
```

The GitHub Actions `matrix.agent: [1..8]` is a **fixed, hand-written pool size**, not a computed list
of affected packages. Nx Cloud's own hosted, proprietary scheduler assigns individual task-graph
nodes to these 8 generic agents at runtime — that assignment logic is invisible to this YAML file
entirely.

`nrwl/nx`'s own repo (29,352 stars, `nxCloudId: 62d013ea0852fe0a2df74438` in `nx.json`) goes a step
further and doesn't define a GitHub Actions matrix for distribution at all:

`nrwl/nx · .github/workflows/ci.yml · sha a935bb7d0af8 · read 2026-09-18` (branch `master`):

```yaml
jobs:
  main-linux:
    runs-on: ubuntu-latest
    steps:
      - name: Start CI Run
        run: npx nx-cloud@next start-ci-run --distribute-on="./.nx/workflows/dynamic-changesets.yaml" --stop-agents-after="e2e"
      - name: Run Checks/Lint/Test/Build
        run: |
          pnpm nx record -- nx format:check &
          pnpm nx run-many -t check-imports check-lock-files check-codeowners --parallel=1 --no-dte &
          pnpm nx affected --targets=lint,oxlint,test,build,e2e,e2e-ci,format-native,lint-native,check-native-wasm,gradle:build-ci,vale,run,validate-example &
          for pid in "${pids[@]}"; do wait "$pid"; done
        timeout-minutes: 100
```

`--distribute-on` points at a file outside `.github/workflows/` entirely. I fetched it directly to
confirm this isn't an inference: `nrwl/nx · .nx/workflows/dynamic-changesets.yaml · sha a935bb7d0af8`:

```yaml
distribute-on:
  extra-small-changeset: 6 linux-large, 3 linux-extra-large
  small-changeset: 6 linux-large, 4 linux-extra-large
  medium-changeset: 6 linux-large, 5 linux-extra-large
  large-changeset: 6 linux-large, 6 linux-extra-large
  extra-large-changeset: 8 linux-large, 8 linux-extra-large
assignment-rules:
  - targets: [e2e-ci--src/module-federation**]
    run-on:
      - { agent: linux-extra-large, parallelism: 1 }
  - targets: [e2e-ci**]
    run-on:
      - { agent: linux-large, parallelism: 3 }
      - { agent: linux-extra-large, parallelism: 6 }
  - targets: ["*"]
    run-on:
      - { agent: linux-large, parallelism: 3 }
      - { agent: linux-extra-large, parallelism: 3 }
```

So for the two most sophisticated Nx Cloud users found, "how is the job set computed" has two
different verified answers, and neither is "a GitHub Actions matrix computed from `nx affected`."
lerna hand-writes a fixed 8-agent pool directly in `.github/workflows/ci.yml`. nx itself maps
*changeset size* (a diff-size heuristic, not a package list) to an agent-count table in a
Nx-Cloud-specific config file that lives outside GitHub Actions YAML entirely, and Nx Cloud's hosted
control plane does the actual provisioning and scheduling. Reading only `.github/workflows/*.yml`
would materially understate what's happening in both cases, and would miss it entirely for nx.

I confirmed two more large (50k+ and 91k+ star) Nx users are also on Nx Cloud — `TanStack/query`
(`nxCloudId: 6412c827e6da5d7b4a0b1fe3`) and `storybookjs/storybook`
(`nxCloudId: 6929fbef73e98d8094d2a343`), both read directly from each repo's `nx.json` on
2026-09-18. Every large (29k+ star) public Nx user checked in this survey is on Nx Cloud. The
largest **non**-Nx-Cloud Nx user found after a real search is `microsoft/rnx-kit` at 1,734 stars —
searched via `gh api search/code -f q='"nx affected" path:.github/workflows'` (4,048 hits; the
first 30 inspected, filtered by star count and by absence of `nx-cloud`/`NX_CLOUD_ACCESS_TOKEN`
anywhere in the repo). `angular/angular` (101,010 stars) was checked and ruled out: its `ci.yml`
uses Bazel plus Bazel Remote Build Execution (`angular/dev-infra/github-actions/bazel/configure-remote`),
a completely different toolchain — it is not an Nx repo at all. **This is a plainly-stated negative
result**: no large (tens-of-thousands-of-stars) public Nx user outside Nx Cloud turned up after this
search; the closest thing is a ~1.7k-star library-tooling repo using `nx affected` as a boolean
job-skip gate, not for distribution.

`microsoft/rnx-kit · .github/workflows/pr.yml · sha fb2b26294ff6 · read 2026-09-18` (branch `main`, 1,734 stars; no `nx-cloud` anywhere in the repo):

```yaml
  build:
    name: "Build"
    strategy:
      matrix:
        node-version: [22, 24]
        os: [ubuntu-24.04, windows-2025]
    steps:
      - run: yarn build:ci --base origin/${{ github.base_ref }}
      - run: yarn bundle:ci --base origin/${{ github.base_ref }}
      - name: Bundle test apps with esbuild
        run: yarn nx affected --base origin/${{ github.base_ref }} --target bundle+esbuild -- --dev false

  build-android-test-app:
    name: "Build Android"
    steps:
      - name: Determine whether the Android app needs to be built
        id: affected-projects
        run: |
          if [[ "$(yarn show-affected --base origin/${{ github.base_ref }})" = *"@rnx-kit/test-app"* ]]; then
            echo 'android=true' >> $GITHUB_OUTPUT
          fi
      - name: Build Android app
        if: ${{ steps.affected-projects.outputs.android != '' }}
        run: yarn build:android
        working-directory: packages/test-app
```

This is shape (B): one job per task/target type (`build`, `build-android-test-app`,
`build-ios-test-app` are separate named jobs, not matrix entries). `nx affected` computes a boolean
that conditionally skips an entire downstream job; the `node-version × os` matrix you see is an
unrelated version/OS cross-product.

### 4. calcom/cal.com — label-gated container suite, `needs:` graph shows parallel-fast / dependent-slow tiers

`calcom/cal.com · .github/workflows/pr.yml · sha 6bc45298226f · read 2026-09-18` (branch `main`, 48,535 stars):

```yaml
  type-check:
    needs: [prepare]
    if: ${{ needs.prepare.outputs.has-files-requiring-all-checks == 'true' }}
    uses: ./.github/workflows/check-types.yml
  lint:
    needs: [prepare]
    if: ${{ needs.prepare.outputs.has-files-requiring-all-checks == 'true' }}
    uses: ./.github/workflows/lint.yml
  unit-test:
    needs: [prepare]
    if: ${{ needs.prepare.outputs.has-files-requiring-all-checks == 'true' }}
    uses: ./.github/workflows/unit-tests.yml
  setup-db:
    needs: [prepare]
    if: ${{ needs.prepare.outputs.run-e2e == 'true' && needs.prepare.outputs.has-files-requiring-all-checks == 'true' }}
    uses: ./.github/workflows/setup-db.yml
  integration-test:
    needs: [prepare, build, setup-db]
    if: ${{ needs.prepare.outputs.run-e2e == 'true' }}
    uses: ./.github/workflows/integration-tests.yml
  e2e:
    needs: [prepare, build, setup-db]
    if: ${{ needs.prepare.outputs.run-e2e == 'true' }}
    uses: ./.github/workflows/e2e.yml
```

`run-e2e` is set **exclusively** by a PR-label check:

```js
const labelFound = labels.map(l => l.name).includes('ready-for-e2e');
core.setOutput('run-e2e', labelFound);
```

So the fast tier (`type-check`/`lint`/`unit-test`) runs in parallel on every qualifying PR (gated
only by a path filter, `has-files-requiring-all-checks`), while `setup-db` and every DB-backed suite
are skipped entirely **unless a maintainer applies the `ready-for-e2e` label** — and when it does
run, `integration-test`/`e2e` both `needs: [..., setup-db]`, i.e. **dependent on**, not parallel
with, the database-setup job (though they run in parallel with each other once unblocked).

`calcom/cal.com · .github/workflows/e2e.yml` — the container-backed shard matrix:

```yaml
  e2e:
    name: E2E (${{ matrix.shard }}/${{ strategy.job-total }})
    services:
      postgres:
        image: postgres:18
      mailhog:
        image: mailhog/mailhog:v1.0.1
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4, 5, 6, 7, 8]
    steps:
      - run: yarn e2e --shard=${{ matrix.shard }}/${{ strategy.job-total }} --workers=4
```

Shape B (per-task-type jobs) at the top level, Shape D (a hand-written 8-way shard array) nested
inside the one task type that needs it, gated by a label rather than by any turbo/nx affected
signal. Confirmed empirically on a docs-only PR (run `28688605632`): every job below `prepare`
shows `skipped`, finishing in 0.5 min, versus 6.8–19.8 min on a full-fanout run.

### 5. vercel/next.js — the largest repo in this survey does not use turbo for CI fan-out at all

`vercel/next.js · .github/workflows/build_and_test.yml · sha 8a54c08e5d69 · read 2026-09-18` (branch `canary`, 142,333 stars). Next.js is built by Vercel — the same company that builds Turborepo — and is itself a turborepo monorepo, yet its main CI gate is a ~1,230-line **hand-written** file with roughly 35-37 top-level job IDs, each calling a shared reusable workflow. Every `strategy.matrix` in the file is a static literal list, never a computed one:

```yaml
  test-prod:
    name: test prod
    needs: ['optimize-ci', 'changes', 'build-native', 'build-next', 'fetch-test-timings']
    if: ${{ needs.optimize-ci.outputs.skip == 'false' && needs.changes.outputs.docs-only == 'false' && needs.changes.outputs.turbopack-only == 'false' }}
    strategy:
      fail-fast: false
      matrix:
        exclude:
          - react: ${{ github.event_name == 'pull_request' && !contains(github.event.pull_request.labels.*.name, 'run-react-18-tests') && '18.3.1' }}
        group: [1/10, 2/10, 3/10, 4/10, 5/10, 6/10, 7/10, 8/10, 9/10, 10/10]
        react: ['', '18.3.1']
    uses: ./.github/workflows/build_reusable.yml
    with:
      afterBuild: |
        node run-tests.js --timings --require-timings -g ${{ matrix.group }} --type production
```

`turbo` appears exactly twice in the entire 1,229-line file, both for Rust-adjacent one-off tasks
(`pnpm dlx turbo@${TURBO_VERSION} run test-cargo-unit ...` and `... run rust-check ...`) — never for
the JS/TS suites. The skip-gate that decides whether whole suites run at all (`optimize-ci`) is
**Graphite's** stacked-PR CI optimizer, a third-party product unrelated to turbo, `--affected`, or
`turbo-ignore`. Test-shard *membership* is timing-balanced at runtime by a `fetch-test-timings` job
reading historical data, but the shard *count* (`1/10`, `1/7`, `1/5`, etc., depending on the suite)
is a static number typed into the YAML by a human. No `services:` container block was found
anywhere in the PR gate. Sampled wall clock (workflow id `57419851`): push-to-canary runs average
≈50.8 min; PR runs average ≈23.1 min.

## Additional quoted evidence

**shadcn-ui/ui** (124,090 stars) has a real `turbo.json` (build/preview/start/lint tasks) but never
calls `turbo run` in CI at all — `shadcn-ui/ui · .github/workflows/test.yml` and `code-check.yml ·
sha a87a63b2ca25 · read 2026-09-18`:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
  react:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm --filter=@shadcn/react test
  helpers:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm --filter=@shadcn/helpers test
```
```yaml
jobs:
  lint:
    steps: [{ run: pnpm lint }]
  format:
    steps: [{ run: pnpm format:check }]
  tsc:
    steps: [{ run: pnpm typecheck }]
```

One hand-written job per task type, no matrix, no sharding, no turbo/nx cache — the only caching is
a plain `actions/cache` for the pnpm store.

**t3-oss/create-t3-turbo** (6,108 stars, `.github/workflows/ci.yml · sha 8f945b7bb3bf`) is the entire
CI surface, in full, and is written as a teaching example for template consumers:

```yaml
env:
  TURBO_TEAM: ${{ vars.TURBO_TEAM }}
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
jobs:
  lint:
    steps: [{ run: pnpm lint && pnpm lint:ws }]
  format:
    steps: [{ run: pnpm format }]
  typecheck:
    steps: [{ run: pnpm typecheck }]
```

No build or test job exists at all — this is the "small package count, everything cacheable" end of
the spectrum, taken to its logical extreme: 0.6–1.1 min per run.

**documenso/documenso** (15,070 stars, `.github/workflows/e2e-tests.yml · sha e658cc581878`) is the
cleanest example of *not* separating a container-backed suite into its own parallel tier at all:

```yaml
jobs:
  e2e_tests:
    name: 'E2E Tests'
    timeout-minutes: 60
    runs-on: warp-ubuntu-2204-x64-8x
    env:
      TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
      TURBO_TEAM: ${{ vars.TURBO_TEAM }}
    steps:
      - name: Start Services
        run: npm run dx:up   # docker compose -f docker/development/compose.yml up -d
      - name: Run Playwright tests
        run: npm run ci      # turbo run build --filter=@documenso/remix && turbo run test:e2e
```

One sequential job, unconditional on every `push`/`pull_request` (no label, no path filter), running
on a bigger 8-core hosted runner instead of sharding. Cost: a flat 20.7–27.4 min on every PR
regardless of what changed (n=12, measured `updated_at − run_started_at`).

**payloadcms/payload** (44,809 stars, `.github/workflows/main.yml` + `.github/workflows/int.config.ts
· sha 9a2cdcb87aac`) has the *same mechanism* as PostHog — a job computes JSON, a downstream job
consumes it via `fromJson` — with a hand-authored, not turbo-derived, input:

```yaml
  int-matrix:
    outputs:
      matrix: ${{ steps.generate.outputs.matrix }}
    steps:
      - id: generate
        run: |
          matrix=$(node .github/workflows/int.config.ts)
          echo "matrix=$matrix" >> $GITHUB_OUTPUT
  tests-int:
    needs: [changes, build, int-matrix, probe-next-canary]
    strategy:
      fail-fast: false
      matrix: ${{ fromJson(needs.int-matrix.outputs.matrix) }}
```
```typescript
// .github/workflows/int.config.ts
createIntConfig({
  databases: ['mongodb', 'mongodb-atlas', 'documentdb', 'cosmosdb', 'firestore',
              'postgres', 'postgres-custom-schema', 'postgres-uuid', 'postgres-uuidv7',
              'postgres-read-replica', 'supabase', 'sqlite', 'sqlite-uuid', 'sqlite-uuidv7'],
  shards: 3,
})
```

Every matrix entry starts its own database container via a `start-services` composite action keyed
on `matrix.database`. `grep -inE "turbo|nx |affected|--dry"` on the generator script itself: no
matches. This confirms "compute a matrix at runtime via a job output consumed with `fromJson`" is a
real, independently-invented mechanism outside PostHog — but deriving that matrix's *content* from a
task runner's own affected/dry-run analysis, rather than a hand-maintained list, remains something
only PostHog was found to do.

**withastro/astro** (62,660 stars) has a third distinct flavor of "affected," alongside PostHog's
`turbo query affected` and turborepo's own `--affected` flag — `withastro/astro ·
scripts/turbo-run-affected.js · sha 3fd16eeb5cd0`:

```js
// Runs Turbo with the provided args and scopes filters to the PR base branch.
const range = isPullRequest && baseRef ? `origin/${baseRef}...HEAD` : undefined;
// Example: ./packages/astro -> {./packages/astro}[origin/main...HEAD]
```

This rewrites `--filter=X` into turbo's own native git-range filter syntax before a normal `turbo
run` — narrowing one invocation's scope, never producing a matrix. Astro's test job also carries a
coarse, hand-written matrix unrelated to packages:

```yaml
  test:
    strategy:
      matrix:
        OS: [ubuntu-latest, macos-14, windows-2025]
        NODE_VERSION: [22, 24]
        TEST_SUITE:
          - { name: astro, script: 'pnpm run test:astro' }
          - { name: integrations, script: 'pnpm run test:integrations' }
```

No container/`services:` block exists anywhere in astro's workflows — despite having DB-touching
packages (`@astrojs/db`) in the monorepo, there is no Postgres-backed CI job at all.

**trpc/trpc** (40,608 stars, `.github/workflows/main.yml · sha 8b649ad874a8`) confirms with a sharp
example that "one job per task type" does not mean "every task-type job goes through turbo": its
`test` job (unit/integration — arguably the core correctness gate) is bare `vitest`, never wrapped in
`turbo run`, while `build`/`typecheck-www` are. Its one real matrix is a hard-coded list of 19
example-app directories, `needs: [build]`, with its own `postgres` container:

```yaml
  e2e:
    if: github.event_name == 'pull_request'
    needs: [build]
    services:
      postgres:
        image: postgres
        env: { POSTGRES_DATABASE: trpcdb, POSTGRES_USER: postgres, POSTGRES_HOST_AUTH_METHOD: trust }
        ports: ['5432:5432']
    continue-on-error: true
    strategy:
      matrix:
        dir: [.experimental/next-app-dir, .test/diagnostics-big-router, .test/internal-types-export,
              .test/ssg, cloudflare-workers, express-minimal, express-server, fastify-server,
              minimal-react, next-formdata, next-minimal-starter, next-prisma-starter,
              next-prisma-todomvc, next-prisma-websockets-starter, openapi-codegen, soa,
              standalone-server, vercel-edge-runtime, nuxt]
    steps:
      - run: pnpm turbo --filter ./examples/${{ matrix.dir }} test-dev
```

Every container/matrix job in this file carries `continue-on-error: true` and `needs: [build]` —
advisory, and sequential after the fast job, never parallel with it.

**medusajs/medusa** (36,363 stars) — its real, comprehensive, always-on gate is a workflow file with
a misleadingly plain filename (`action.yml`, display name "Medusa Pipeline"), confirmed by reading it
directly rather than inferring from file-list naming:

```yaml
# medusajs/medusa · .github/workflows/action.yml · sha c000d377f1a9 · read 2026-09-18 (branch develop)
name: Medusa Pipeline
on:
  push: { branches: [develop, v1.x] }
  pull_request: { branches: ["**"] }
jobs:
  unit-tests-matrix:
    strategy: { matrix: { shard_index: [1, 2, 3, 4] } }
    steps:
      - run: yarn test -- --shard=${{ matrix.shard_index }}/4 --maxWorkers=${{ steps.cpu-cores.outputs.count }}
  integration-tests-packages-matrix:
    strategy: { matrix: { group: ["slow", "fast"], shard_index: [1, 2, 3] } }
    services:
      redis: { image: redis }
      postgres: { image: postgres, env: { POSTGRES_PASSWORD: postgres, POSTGRES_USER: postgres } }
    steps:
      - run: yarn test:integration:packages:${{ matrix.group }} -- --shard=${{ matrix.shard_index }}/3
  integration-tests-modules-matrix:      # shard_index: [1,2,3,4], own postgres+redis
    steps:
      - run: yarn test:integration:modules -- --shard=${{ matrix.shard_index }}/4
        env:
          CHUNK: ${{ matrix.chunk }}
          CHUNKS: ${{ needs.setup.outputs.module-chunks }}
```

18 parallel Jest `--shard=i/n` jobs total (4 unit + 3+3 package-integration + 4 HTTP-integration + 4
module-integration), every shard `needs: setup` (sequential after one shared build job, never
parallel with it), fired unconditionally on every PR. All shard counts are static, hand-written
arrays — no computation, no turbo/nx involvement. One thing worth flagging precisely because it's a
lesson about verifying rather than trusting YAML: I confirmed directly (by reading the full 436-line
file and searching it for every occurrence) that the `CHUNK`/`CHUNKS` env vars above reference
`matrix.chunk` and `needs.setup.outputs.module-chunks`, but the `setup` job defines no `outputs:`
block at all, and this job's own `strategy.matrix` only defines `shard_index` — both references are
dead (there is exactly one occurrence of `module-chunks` in the whole file, at the point where it's
read, never where it would be produced). Real, production, widely-used CI YAML is not automatically
internally consistent.

**callstack/react-native-builder-bob** (3,228 stars) is the clean contrast case for the common,
non-matrix use of `--dry=json` that dominates the earlier code-search results (525 hits for
`"--dry=json" path:.github/workflows`, most following this exact template):

```bash
TURBO_CACHE_STATUS_ANDROID=$(node -p "($(yarn turbo run build:android --cache-dir=".turbo" --dry=json)).tasks.find(t => t.task === 'build:android').cache.status")
if [[ $TURBO_CACHE_STATUS_ANDROID == "HIT" ]]; then echo "turbo_cache_hit_android=1" >> $GITHUB_ENV; fi
```

A boolean cache-hit gate before a single job — not matrix generation. `turbo-ignore` (75 code-search
hits) follows the same pattern one level up: it is Vercel's own tool for skipping an entire deploy
when nothing relevant changed, used almost exclusively for per-app Vercel deployment gating, not for
building GitHub Actions test matrices.

**n8n-io/n8n** (205,135 stars, `sha 82f3a0154bb9`) is the heaviest genuine fan-out in this survey
and the single most useful data point for a container-backed critical path — and it computes none of
it from turbo. Its database suite is tiered by *trigger*: a PR runs SQLite plus one primary Postgres
major, the merge queue runs the full Postgres range, and a push to `master` runs no database job at
all. The matrix is emitted by a bespoke Node script reading a version JSON file —
`n8n-io/n8n · .github/workflows/ci-pull-requests.yml`:

```yaml
      # Generated here because a reusable workflow cannot resolve its own matrix.
      # PRs run SQLite plus the primary Postgres leg. The merge queue runs the
      # full Postgres range, so every merge still gates on the older majors.
      - name: Generate DB test matrix
        id: generate-db-test-matrix
        if: fromJSON(steps.ci-filter.outputs.results).db
        env:
          DB_MATRIX_SCOPE: ${{ github.event_name == 'merge_group' && 'full' || 'pr' }}
        run: echo "db_test_matrix=$(node .github/scripts/db-test-matrix.mjs --scope="$DB_MATRIX_SCOPE")" >> "$GITHUB_OUTPUT"

  db-tests:
    name: DB Tests
    needs: install-and-build
    if: needs.install-and-build.outputs.db == 'true'
    uses: ./.github/workflows/test-db-reusable.yml
    with:
      matrix: ${{ needs.install-and-build.outputs.db_test_matrix }}
```

Its 20-way Playwright shard matrix is likewise generated by n8n's own impact-analysis script, which
contains zero references to turbo — `n8n-io/n8n · .github/workflows/ci-pull-requests.yml`:

```yaml
      - name: Generate shard matrix
        id: generate-matrix
        run: |
          FILES_CSV=$(echo "$CHANGED_FILES" | tr '\n' ',' | sed 's/,$//')
          MATRIX=$(node packages/testing/playwright/scripts/distribute-tests.mjs --matrix 20 --orchestrate --impact "--project=$PLAYWRIGHT_PROJECT" "--files=$FILES_CSV" "--base=$MERGE_BASE")
          echo "matrix=$MATRIX" >> "$GITHUB_OUTPUT"
```

`--affected`, `turbo --affected` and `lint:affected` are **confirmed absent from every file under
`.github/workflows`** (`gh api search/code`, zero hits); the flag exists only as an unused local-dev
script. n8n's own `packages/testing/janitor/src/core/affected-packages-analyzer.ts` parses
`turbo.json`'s task graph as one input signal to a hand-rolled affected computation, but never shells
out to turbo's `--affected`/`--dry-run`/`query` CLI surface. Containers are Testcontainers-in-process
(`pnpm test:postgres:integration:tc`), not GitHub-native `services:`. Turbo remote caching is real
and confirmed live in job log for run 33179570482 (`• Remote caching enabled`, `cache hit, replaying
logs efeb0d9610c036c9`) — but it runs through `rharkor/caching-for-turbo@2238fae6eb9a9936f92356f54cb3660200d105e7 # v2.5.1`,
wired into every job via the shared composite action
`n8n-io/n8n · .github/actions/setup-nodejs/action.yml · sha 82f3a0154bb9`, not inline in
`ci-pull-requests.yml` itself. It is a runner-local shim that fakes Vercel's cache protocol over the
GitHub Actions cache with a placeholder team token, not a real Vercel or Nx Cloud account.

**supabase/supabase** (109,935 stars, `sha 45381bf857c5`) is the clearest example of achieving
cross-package CI parallelism *without* the task runner. It has a real `turbo.jsonc`, but of its ~48
workflow files only `typecheck.yml` invokes turbo at all, and it does so sequentially in one job.
Every other package gets its own independently-triggered workflow file gated by native `paths:` —
one of roughly ten near-identical examples, `supabase/supabase · .github/workflows/pg-meta-tests.yml`:

```yaml
name: PG Meta Tests

on:
  push:
    branches: ['master']
    paths:
      - 'packages/pg-meta/**/*'
  pull_request:
    branches: ['master']
    paths:
      - 'packages/pg-meta/**/*'
...
      - name: Run tests
        run: pnpm --filter=@supabase/pg-meta run test
```

No `nx.json` exists, and `TURBO_TOKEN`/`TURBO_TEAM`/`TURBO_API` appear nowhere in the repository
(confirmed by code search) — so the second-largest repo in this survey runs a turbo-configured
monorepo with no remote cache and no turbo-driven orchestration whatsoever. A caution for anyone
grepping for evidence: `studio-unit-tests.yml` and `ui-tests.yml` both contain a single-element
`strategy: matrix: test_number: [1]`, which looks like fan-out in a search result and is not.

**modrinth/code** (2,375 stars, `sha eacc38fb51ad`) is the most direct answer available to "what does
`--dry-run=json` actually get used for," and it is a cache-status gate — but a more interesting one
than the react-native-builder-bob template, because what it gates is precisely a container stack —
`modrinth/code · .github/workflows/turbo-ci.yml`:

```yaml
      # check if labrinth tests will actually run (cache miss)
      - name: Check if labrinth tests need to run
        id: check-labrinth
        run: |
          LABRINTH_TEST_STATUS=$(pnpm turbo run test --filter=@modrinth/labrinth --dry-run=json | jq -r '.tasks[] | select(.task == "test") | .cache.status')
          if [ "$LABRINTH_TEST_STATUS" = "HIT" ]; then
            echo "needs_services=false" >> $GITHUB_OUTPUT
          else
            echo "needs_services=true" >> $GITHUB_OUTPUT
          fi

      - name: Start services
        if: steps.check-labrinth.outputs.needs_services == 'true'
        run: docker compose --profile clustered-redis up --wait
```

That is the whole CI gate — one job named `Lint and Test`, with turbo's internal `"concurrency":
"100%"` supplying all parallelism, and the remote cache deciding whether Docker Compose starts at
all. The wall-clock effect is measurable and bimodal: pushes complete in 1.7–1.9 minutes on a cache
hit versus 12.6 minutes on a miss. Remote caching is Namespace Cloud, confirmed live in the job log
for run 34165310257 (`Labrinth test cache status: MISS`, then `• Remote caching enabled`, ending
`Cached: 20 cached, 26 total`), and is deliberately restricted to internal branches — fork PRs fall
back to plain `ubuntu-latest` with no cache, the same fork-boundary constraint visible in turborepo's
own OIDC-gated setup.

**midday-ai/midday** (15,017 stars, `sha 51587319f26a`) must be reported as a stub rather than as
practice, per this survey's own standard. There is no `pull_request`-triggered workflow in the
repository at all (confirmed empirically: PR #904, open since 2026-08-18, has zero check-runs and
zero commit statuses). The single job that holds every turbo lint/build/typecheck/test call and the
repository's only Postgres container is hard-disabled —
`midday-ai/midday · .github/workflows/production.yml`:

```yaml
  # TEMPORARILY DISABLED: set `if: false` to skip; remove to re-enable.
  validate:
    name: Validate
    if: false
    runs-on: blacksmith-16vcpu-ubuntu-2404
    services:
      postgres-test:
        image: pgvector/pgvector:pg16
    ...
      - name: Lint
        run: bunx turbo lint --affected
      - name: Typecheck
        run: bunx turbo typecheck --affected
      - name: Test
        run: bunx turbo test --affected
```

and deploys proceed regardless, because a skipped job counts as a pass (`(needs.validate.result ==
'success' || needs.validate.result == 'skipped')`). The reason is in the commit log verbatim, not
inferred — `ci: disable validate and tool-selection eval jobs` (`e5f45ed0d49c`, 2026-05-07), landing
four days after `chore: wind down Midday over 90 days, joining Ramp` (`4420ce4bb6c3`). The repository
has had no commit since 2026-06-13 and no successful workflow run since 2026-05-07. Its
`--affected --dry-run=json` usage is classification (a) — five boolean per-service `if:` gates, no
`strategy.matrix` anywhere — but it should be cited as frozen history, not as a live design.

## Answers to the four questions

**1. Does anyone actually generate a GitHub matrix from `turbo run --dry=json`?**

Yes, confirmed once, at PostHog (39,843 stars) — see exhibit 1 above. But the honest description is
more specific than "parse dry-run JSON": PostHog uses `turbo run backend:test --dry-run=json` for
task *inventory* and turbo's own `turbo query affected --tasks ... --base ... --head ...` subcommand
(a real, native turbo feature, confirmed against turborepo's own Rust source) for change
*detection*, and feeds both through a ~1,478-line custom cost-model/bin-packing script before
anything becomes a GitHub matrix. It is real, but it is not a five-line recipe — and the suite it
orchestrates is a Python/Django/pytest suite, not TypeScript, so it is one step removed from "a TS
test suite fanned out this way." Searched via `gh api search/code` on 2026-09-18:
`"--dry=json" path:.github/workflows` (525 hits, overwhelmingly the react-native-builder-bob
cache-gate template — classification (a), not (b)); `"--dry-run=json" path:.github/workflows` (101
hits); `"turbo run" "matrix" path:.github/workflows` (1,334 hits, almost entirely unrelated OS/Node
matrices); `"ls --affected" path:.github/workflows` (34 hits); `"turbo query" path:.github/workflows`
(22 hits, this is what surfaced PostHog); `"turbo-ignore" path:.github/workflows` (75 hits, all
Vercel per-app deploy-skip use). Across all of that, plus every repo checked directly in this survey
(turborepo, next.js, shadcn-ui, create-t3-turbo, astro, trpc, medusa, cal.com, documenso, payload,
RSSNext/Folo, supabase, n8n, modrinth, midday), **PostHog is the only confirmed example of a real
GitHub matrix computed from turbo's own affected/dry-run analysis.**

n8n-io/n8n is the strongest negative result of the whole search, because it is the one repo that
would most plausibly have built such a thing and deliberately did not. At 205,135 stars it runs three
genuinely dynamic `fromJSON` matrices (a 20-way Playwright shard, a Postgres-major database matrix,
2-way vitest shards) on a turborepo monorepo with working remote caching — and every one of those
matrices is emitted by a hand-written Node script. `gh api search/code` returns zero hits for `--affected` across its
workflow files. The two other `--dry-run=json` leads that the code search surfaced both resolved
to classification (a) on direct inspection: modrinth/code gates a `docker compose up` step on
`.tasks[].cache.status`, and midday-ai/midday sets five boolean deploy flags — neither builds a
matrix. payloadcms/payload uses the identical *mechanism* (`fromJson` fed
by a job output) but a hand-authored, not turbo-derived, list — the mechanism is not unique to
PostHog, but deriving the matrix's *content* from a task runner's own change-detection is. This
absence, after a search this broad across some of the largest public TypeScript monorepos that
exist, is itself the finding.

**2. Do turborepo users simply accept the single-runner model? What makes it tolerable?**

Most of the smaller-to-moderate repos in this survey do, and what makes it tolerable is visible
directly in their numbers: t3-oss/create-t3-turbo (6,108 stars, 3 jobs, no build/test job at all,
0.6–1.1 min), RSSNext/Folo (38,973 stars, one job for lint+test, ~5 min median, using only GitHub's
free generic `actions/cache`, no paid remote-cache service at all), and vercel/turborepo's own
non-Rust jobs (`turbo_types_check`, `check-examples`, `check-lockfiles`, each single-filter,
single-job). The pattern is small-to-moderate total package count plus genuinely cacheable,
fast-enough tasks that a single job finishing in single-digit minutes isn't worth the operational
complexity of fanning out. modrinth/code (2,375 stars) is the cleanest measurement of *why* it is tolerable: it runs one job
for the entire repository, and its pushes finish in 1.7–1.9 minutes on a turbo remote-cache hit
versus 12.6 minutes on a miss. The single-runner model is not being endured there — cacheability is
doing the work that fan-out would otherwise have to do, and the gap between those two numbers is the
whole argument. Note the fork boundary, though: modrinth restricts its Namespace cache to internal
branches, so fork PRs get the 12.6-minute path every time, the same constraint that OIDC imposes on
turborepo's own setup. documenso/documenso (15,070 stars) shows the model can be stretched to a
real, slow, container-backed e2e suite too — it just costs a flat 20.7–27.4 minutes on every PR with no
attempt to shard or gate it, which is a genuine (if expensive) choice, not an oversight (its
`ci.yml` and `e2e-tests.yml` are its only two real workflows).

**3. Is "one job per task type" rather than "one job per package" the common shape?**

Yes, overwhelmingly, and no repo in this survey does a flat "one job per package" fan-out with no
task-type structure above it. vercel/turborepo (`turbo_types_check`, `rust_test`, `check-examples`,
`check-lockfiles`, `js_native_packages`), microsoft/rnx-kit (`build` / `build-android-test-app` /
`build-ios-test-app`), shadcn-ui/ui (`lint`/`format`/`tsc`, `test`/`react`/`helpers`), cal.com
(`type-check`/`lint`/`unit-test`/`integration-test`/`e2e`), and payload (`lint`/`build`/`tests-int`/
`tests-e2e`) are all organized by task type at the top level. Where a genuine matrix exists, its axis
is OS/Node-version/shard-count (turborepo, astro, rnx-kit), a hand-written fixed agent pool (lerna,
nx via Nx Cloud DTE), a hard-coded list of example apps (trpc), a hand-authored database×shard
cartesian product (payload), or — uniquely — a dynamically computed "product group" (PostHog, a
grouping concept between package and task, not a flat per-package list). Sharding inside a task-type
job (medusa's 18 Jest shards, trpc's e2e matrix, cal.com's 8-way e2e shard) is common; replacing the
task-type axis with a package axis is not observed anywhere in this survey.

One repo qualifies that answer and deserves stating precisely: supabase/supabase does achieve a
per-package fan-out, but one level up from where this question is usually asked. Rather than one
*job* per package inside a workflow, it uses roughly fifteen independent *workflow files*, each
scoped to one package and triggered by its own native `paths:` filter (`pg-meta-tests.yml`,
`studio-unit-tests.yml`, and so on), each calling `pnpm --filter=<pkg>` directly. The parallelism
across runners is real and the axis genuinely is the package — but it is produced by GitHub's own
path-filtering and file-level triggers, with turbo bypassed entirely, and it is maintained by hand as
one file per package rather than computed from anything. It is the GitHub-native alternative to
turbo's affected machinery, not a use of it.

**4. How do repos with genuinely slow, container-backed integration tests handle them?**

Every repo that isolates its container-backed suite into its own job(s) also does at least one of:
narrows *when* those jobs run (path filters, PR labels, schedules), or accepts a flat, ungated
wall-clock cost every time. PostHog isolates its Postgres/ClickHouse/Kafka/Temporal/Elasticsearch
suite into its own job set (`turbo-tests`), gives each matrix entry its own full Docker Compose
stack, and aggressively narrows or skips it (draft-PR skip, master-push skip in favor of a merge
queue plus an hourly `schedule:` run, per-product affected-narrowing on ordinary PRs). cal.com puts
Postgres into per-shard e2e jobs and gates the entire tier behind a `ready-for-e2e` PR label — proven
empirically: a docs-only PR finishes in 0.5 min because every job past `prepare` is skipped.
payloadcms/payload sits in between: sharded matrix cells each start their own database container,
while one always-on `services: postgres:` job (`tests-content-api`) is fork-excluded and marked
`continue-on-error: true` so it can't block merge even though it runs on every PR. medusa runs its
Postgres+Redis suite as 18 sharded matrix jobs, sequential after one shared build job, on every PR
with no gate at all — and uses a fan-in job (a single downstream job that inspects
`needs.<matrix-job>.result` and exits 1/0) to turn that matrix into one required status check rather
than 18. trpc scopes its one Postgres container to a single `e2e` job with `continue-on-error: true`,
leaving its bare-vitest `test` job container-free entirely. documenso is the "don't bother" end of
the spectrum: no isolation, no gate, one sequential job, a flat cost on every PR. astro, despite
having DB-touching packages, runs no container-backed job in CI at all. n8n-io/n8n is the most deliberate design of the set, and the one worth studying closest for a
container-backed critical path: it tiers the suite by *trigger* rather than gating it on or off. A PR
runs SQLite plus one primary Postgres major; the merge queue re-runs the same suite across the full
Postgres major range, so no merge escapes the older majors; a push to `master` carries no database
job at all. Its containers are Testcontainers started in-process rather than GitHub-native
`services:`, and the whole tier lives in its own reusable workflow behind a custom `ci-filter`
composite action.

Collecting the `needs:` edge for every container-backed job found in this survey makes the ordering
unanimous:

| Repo | Container-backed job | `needs:` | Position in the graph |
|---|---|---|---|
| **PostHog/posthog** | `turbo-tests` | `[changes, turbo-discover, detect-snapshot-mode, build-product-test-matrix, get_clickhouse_versions]` | downstream of the whole discovery + matrix-building chain |
| **n8n-io/n8n** | `db-tests` (reusable workflow) | `install-and-build` | downstream of build; sibling-parallel with unit/lint/typecheck |
| **calcom/cal.com** | `integration-test`, `e2e` | `[prepare, build, setup-db]` | downstream of build **and** a dedicated DB-setup job |
| **payloadcms/payload** | `tests-int`, `tests-e2e`, `tests-content-api` | `[changes, build]` | downstream of build |
| **medusajs/medusa** | 18 sharded Jest jobs | `setup` | downstream of one shared install+build job |
| **trpc/trpc** | `e2e` | `build` | downstream of build |
| **modrinth/code** | `Lint and Test` (compose started mid-job) | `skip-if-clean` | no separate build job exists — build and containers share one job |
| **documenso/documenso** | `e2e-tests.yml` (single job) | none | separate workflow file; builds inline as its own first step |

Every repo with a distinct build job places its container-backed suite strictly downstream of it —
not one runs the slow suite as a from-`t=0` parallel sibling of build. The two apparent exceptions
are not counterexamples: modrinth and documenso have no separate build job for the suite to depend
on, so they build inline in the same job, which is the same ordering expressed without an edge. The
practical consequence is that in every observed design the container suite's wall clock *adds to*
build's rather than overlapping it, which is exactly why the repos that care about total PR latency
spend their effort on gating (cal.com's label, PostHog's schedule, n8n's trigger tiering) rather than
on trying to start the slow suite earlier. No repo in this survey runs its slow container suite on
the *same* runner as its fast lint/build job — it is always its own job, or skipped outright for a
given run.

## Synthesis for a 13-package repo with one container-backed critical-path suite

Twenty-four rows, for twenty-three distinct repositories (vercel/turborepo appears twice — Rust CI
and JS CI), appear in the table above; twenty of the twenty-three had their workflow files read directly
(TanStack/query and storybookjs/storybook were checked only for Nx Cloud configuration, and
angular/angular was ruled out on inspection as a Bazel user rather than an Nx one). Across all of
them, exactly one — PostHog — has a GitHub matrix whose *content* is derived from a task runner's own
affected/dry-run analysis, and getting there cost roughly 1,500 lines of custom orchestration plus a
historical-duration cache and cost model, driving a Python suite rather than a TypeScript one. Every
other repo that fans out does it by hand: static shard-count arrays (medusa's `shard_index: [1..4]`,
cal.com's `shard: [1..8]`, next.js's `group: [1/10..10/10]`, turborepo's own `shard: [1,2]`), a
hard-coded list of directories (trpc's 19 example apps), or a hand-authored config file emitted as
JSON for `fromJson` to consume (payload's `int.config.ts`, n8n's `db-test-matrix.mjs`). Turbo and Nx
affected-detection are real and widely used, but almost always to prune tasks *inside* one
invocation (turborepo's own `--affected`, astro's git-range filter wrapper) or to flip a whole job on
or off as a boolean (rnx-kit's `nx affected`, modrinth's cache-status gate) — not to decide the
*shape* of the matrix.

On the container-backed suite specifically, the survey produces a clean spectrum rather than a single
practice, and the wall-clock numbers at each end are worth stating with their runner class attached,
because the money is part of the design. At the "narrow aggressively" end, PostHog skips the suite on
master pushes in favour of a merge queue plus an hourly `schedule:` run, and pays 19.7–45.3 minutes for
the full un-narrowed matrix when it does run (48 `event=schedule` runs over 2026-09-08/09 in a
re-read, 26 of them successful; the draft's `n=12` does not reproduce — see §1) — on Depot's paid
runners
(`runs-on: depot-ubuntu-24.04`), not GitHub's free tier. cal.com gates its whole e2e/integration tier
behind a `ready-for-e2e` PR label, which is why a full-fanout run costs 6.8–19.8 minutes while a
docs-only PR finishes in 0.5–0.9 minutes with everything past `prepare` skipped. n8n tiers by trigger
instead of by gate — SQLite plus one Postgres major on a PR, the full Postgres range in the merge
queue, no database job at all on master — landing at 16–29 minutes per PR. At the other end,
documenso does not gate at all: one sequential job, every PR, 20.7–27.4 minutes (n=12), on 8-core
paid Warp runners (`runs-on: warp-ubuntu-2204-x64-8x`). And modrinth shows the fourth option, which is not
gating or fanning out but simply caching well enough that it stops mattering: 1.7–1.9 minutes on a
remote-cache hit against 12.6 on a miss, in a single job.

What the field is actually split on, then, is not *whether* to compute a job set from the task runner
— essentially nobody does that, and the one team that does needed a bespoke scheduler to make it pay
— but *when* to let the expensive suite run at all. Repos at roughly the scale in question here
(trpc at 40,608 stars, documenso at 15,070, create-t3-turbo at 6,108, modrinth at 2,375) uniformly
answer that with a trigger condition, a label, a path filter, or a cache hit, and leave the job set
itself hand-written and short. The larger repos answer it with more machinery, but the machinery goes
into the gating and the sharding, not into deriving the matrix from turbo. The one structural
invariant with no exceptions in the survey is the ordering: every container-backed suite runs
downstream of whatever produces its inputs — a build job, or in PostHog's case its discovery chain —
and never starts at `t=0` beside them, so its cost is additive to the critical path by construction.
Three distinct levers are observed for reducing it, and the repos in this survey pick among them
rather than combining them: gate *when* it runs (cal.com's label, PostHog's schedule, n8n's trigger
tiering), shard *how wide* it runs (medusa's 18 ways, cal.com's 8), or cache well enough that it
mostly does not run at all (modrinth's 1.7-minute hit path).
