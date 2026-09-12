/** What one test in this package is allowed to spend waiting, per suite kind.
 *
 * Vitest's implicit 5000 ms `testTimeout` was a budget nobody chose: both
 * `vitest.config.ts` and `vitest.integration.config.ts` inherited it (#1594),
 * so suites that boot workerd, spawn the container entrypoint, or provision a
 * PostgreSQL database failed on wall clock instead of on behaviour — green on
 * an idle host, red on a loaded one. None of those tests asserts that its
 * setup is fast, so each kind names the bound it actually needs.
 *
 * A bound, not a retry: every number below is a measured worst case plus
 * margin, so a test that genuinely hangs still fails instead of running to
 * the end of the CI job. Measurements were taken at `3bb5621e4` on a 10-core
 * arm64 host, cold (no Vite cache), under the load that reproduces the red —
 * busy loops on every core plus concurrent vitest runs, 1-minute load average
 * 34→44 for the unit arm and 15→16 for the container arm, which is where the
 * containers still start.
 *
 * Nothing here may import `vitest`: both configs read these constants from
 * Vite's config loader, where the test runtime does not exist. The pin that
 * needs the runtime lives in `suite-budget-pin.ts`, and
 * `vitest-config-timeout.test.ts` holds every config in the package to this
 * list.
 */

/**
 * Vitest's own default, now stated rather than inherited. It stays the
 * package-wide value so a plain in-process test that stops making progress
 * fails in five seconds: the scoped budgets below are what buy time for the
 * suites that wait on a runtime, a subprocess or a container, and each one is
 * declared at the suite that waits.
 */
export const PLAIN_NODE_BUDGET_MS = 5_000;

/**
 * `selected-workerd.ts` esbuilds the Worker bundle and boots a Miniflare
 * workerd runtime with a Durable Object; the first test in each
 * `*.workerd.test.ts` pays both. Measured first tests: 3.7 s, 5.5 s and a
 * timeout at 5.1 s (the `selected-request` failure in the issue) at load
 * average 36; 7.6 s at load average 34→44, where the 5 s default had nothing
 * left to give. 30 s is ~4× that 7.6 s worst case and the same magnitude
 * `workers/catalog/vitest.config.ts` already gives its workerd pool for the
 * same reason (20 s), while staying short enough that a runtime which never
 * comes up fails the test rather than running out the lane.
 */
export const WORKERD_BOOT_BUDGET_MS = 30_000;

/**
 * `entrypoint.dsn.test.ts` runs `docker/entrypoint.sh` through `sh` with a
 * shadowed PATH: every test pays a chain of process spawns (the script, the
 * fake `timeout`, the fake `atlas`, `getent`), which is macOS `fork`/`exec`
 * cost, not test work. Measured at load average 36: 3.2 s for one of the
 * probe-plus-apply paths and timeouts at 5.0, 5.0 and 5.3 s for the other
 * three — which is how a file with no runtime and no container still fails at
 * 5 s. 20 s is ~4× that 5.3 s worst case; a script that hangs instead of
 * exiting is still caught well inside the lane.
 */
export const ENTRYPOINT_SPAWN_BUDGET_MS = 20_000;

/**
 * Every file in `test/integration/` provisions its own PostgreSQL container
 * and then migrates a database inside a test body: `CREATE DATABASE …
 * TEMPLATE template1`, an Atlas or Prisma chain apply, and for two of the
 * files an esbuild plus Miniflare boot on top. The published PostGIS image is
 * `linux/amd64`, so on an arm64 host all of that runs under qemu (see
 * `packages/test-postgres/src/setup-budget.ts`). This is the one place where
 * a package-wide value is the honest form — there is no plain-node test in
 * that arm to keep tight.
 *
 * Measured on the loaded reproduction of that red: 9.8 s for the
 * `selected-apply` test that then failed at 5000 ms, and 6.7 s for the
 * slowest test of the 378 s arm that passes with this budget — five of whose
 * 35 tests sit above 5 s, every one of them a test the default would have
 * failed on wall clock alone. 120 s is ~12× that 9.8 s worst case and sits
 * between the two container arms this repo already runs
 * (`workers/catalog`'s spike at 60 s, `apps/web`'s integration at 180 s),
 * with the whole four-file arm still far inside the 45-minute `affected` job
 * in `.github/workflows/pr-verification.yml`, so an overrun fails the test
 * that hung and not the lane.
 */
export const CONTAINER_MIGRATION_BUDGET_MS = 120_000;

/** Every budget a vitest config in this package may declare. */
export const DECLARED_BUDGETS_MS: readonly number[] = [
  PLAIN_NODE_BUDGET_MS,
  WORKERD_BOOT_BUDGET_MS,
  ENTRYPOINT_SPAWN_BUDGET_MS,
  CONTAINER_MIGRATION_BUDGET_MS,
];
