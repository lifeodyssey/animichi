/** Applying the committed Prisma chain to a clean database.
 *
 * This is the continuous "the chain applies cleanly" check: every arm that
 * boots this image proves the committed migrations against a database created
 * from pristine `template1`, with zero Neon credentials and zero network. The
 * chain lives with the contract that owns it — one contract, one migrations
 * directory, one identity (`packages/pi-session-neon/prisma.config.ts`) — and
 * it is applied through the same CLI entrypoint the package's own suites use,
 * so the fixture exercises the real apply instead of re-implementing it.
 *
 * The chain is not the only thing that runs against a shared cluster: the five
 * service roles are cluster-global and are created by `service-roles.ts`, inside
 * the same turn (`chain-apply-turn.ts`).
 */
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/** The package that owns `prisma.config.ts`, the contract and `migrations/app`:
 * the chain is not a directory of `.sql` files a caller could point at, it is
 * whatever that config resolves. Built from `import.meta.url` as a string and
 * `node:path`, not from a `URL` object: a consumer compiled with Cloudflare's
 * DOM-shaped globals (`workers/catalog`) types those differently from
 * `node:url`, and this module is type-checked in every consumer. */
export const CHAIN_PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pi-session-neon");
const OUTPUT_CEILING_BYTES = 10 * 1024 * 1024;

/** Apply the committed chain to `dsn`, failing on the first divergence.
 *
 * `--json` keeps the report machine-readable and the progress spinner out of the
 * captured output; the CLI is a package-local devDependency, resolved by `pnpm`
 * from `CHAIN_PACKAGE` rather than from whatever is on the caller's PATH. */
export async function applyPrismaChain(dsn: string): Promise<void> {
  await promisify(execFile)("pnpm", ["exec", "prisma", "db", "migrate", "--db", dsn, "--json"], {
    cwd: CHAIN_PACKAGE,
    env: childEnvironment(),
    maxBuffer: OUTPUT_CEILING_BYTES,
  });
}

/** The inherited environment with `NODE_V8_COVERAGE` disabled for the child —
 * the same block `packages/prisma-geography/test/support/prisma-cli.ts` puts on
 * its own CLI calls (#1753). Node force-propagates the coverage runner's
 * variable into every spawned child unless the key is present in the spawn
 * env, and this CLI child loads the chain package's config — the contract and
 * its geography extension — under the CLI's own transpile, whose byte offsets
 * differ from the test process's. Under a coverage run the child would dump
 * all-zero functions for `@animichi/prisma-geography`'s sources into the
 * runner's merge directory; node cannot match those ranges against the real
 * ones and appends them, per-line attribution keeps the last full-covering
 * range, and readdir order — a per-run lottery (#1740) — decides whether the
 * zeros land last and zero out codec/ewkb lines (81.14 % vs 99.50 % for
 * identical executions). An empty value keeps the key present, which blocks
 * the propagation, and no coverage starts up in the child: the CLI is not
 * under test, so it writes no dump at all. */
function childEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, NODE_V8_COVERAGE: "", DO_NOT_TRACK: "1" };
}
