/**
 * The emitted-Worker lane's port (#1692).
 *
 * `e2e/playwright.config.ts` used to hardcode `8799`. That port is
 * machine-global while this repository is worked in dozens of checkouts at
 * once, and nothing arbitrated it. A collision at startup failed loudly, but a
 * collision *mid-run* did not: the second lane took the port, the first lane's
 * server vanished, and its specs failed with Chromium's
 * `ERR_CONNECTION_REFUSED` raised inside a test body.
 *
 * The port is therefore a function of WHICH CHECKOUT ASKS. `git worktree list`
 * is one machine-global, identically-ordered listing, so each checkout has a
 * unique ordinal in it, and the ordinal *is* the port offset: index 0 — the
 * main checkout, which is also what CI checks out and what a lone clone has —
 * keeps the documented `8799`, and the n-th linked worktree takes `8799 + n`.
 *
 * That is injective by construction, not by probability: there is no hash, so
 * there is no collision to reason about. Two concurrently running lanes are two
 * ordinals in one listing, which are two ports. What no derivation can rule out
 * is a *stranded listener* on a checkout's own port — an orphaned `workerd`
 * after a killed `wrangler`, or a worktree added while a lane was running,
 * which renumbers the ones after it. `lane-port-check.ts` refuses that lane
 * before a spec runs, naming the port and the process holding it.
 *
 * The listing is read at lane start, once per process, and every process of a
 * run (runner and workers alike) derives the same value from it.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Pin the lane to a port instead of deriving one. */
export const EMITTED_WORKER_PORT_ENV = "E2E_EMITTED_WORKER_PORT";

/** The port the runner claimed for THIS run. Internal — `playwright.config.ts`
 *  records it — and the reason every process of a run agrees on one port:
 *  workers are separate processes that re-require the config after the server
 *  has bound, and a worktree added while this lane builds would otherwise shift
 *  this checkout's ordinal under them, so a worker would compute a port nobody
 *  serves (or, worse, one another lane serves). */
export const CLAIMED_PORT_ENV = "E2E_CLAIMED_WORKER_PORT";

/**
 * The main checkout's port: `8799`, exactly as before #1692, so CI, a lone
 * clone and every prose reference still name the same number.
 */
export const MAIN_WORKTREE_PORT = 8799;

const WORKTREE_LINE = /^worktree (.+)$/;
const PORT_DIGITS = /^[0-9]+$/;
const MAX_PORT = 65535;

/** The port this checkout's lane serves on. */
export function emittedWorkerPort(
  env: Readonly<Record<string, string | undefined>>,
  worktreeRoot: string,
  listing: string | null = readWorktreeListing(worktreeRoot),
): number {
  const pinned = portOverride(env[EMITTED_WORKER_PORT_ENV]);
  if (pinned !== null) return pinned;
  if (listing === null) return MAIN_WORKTREE_PORT;
  return portForOrdinal(ordinalOf(listing, worktreeRoot) ?? 0);
}

/** `EMITTED_WORKER_PORT_ENV` as a port, or null when it is not set. A value
 *  that is set but is not a port is refused: falling back to the derivation
 *  would silently ignore the operator's instruction. */
export function portOverride(raw: string | undefined): number | null {
  return parsePort(raw, EMITTED_WORKER_PORT_ENV);
}

/** The port the runner claimed for this run, or null in the one process that
 *  has yet to claim it. */
export function claimedPort(env: Readonly<Record<string, string | undefined>>): number | null {
  return parsePort(env[CLAIMED_PORT_ENV], CLAIMED_PORT_ENV);
}

function parsePort(raw: string | undefined, variable: string): number | null {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  const port = PORT_DIGITS.test(text) ? Number(text) : 0;
  if (port < 1 || port > MAX_PORT) throw new Error(unusablePort(text, variable));
  return port;
}

/** The checkout roots a `git worktree list --porcelain` listing names, in
 *  DERIVATION order: the main checkout first — git promises that much, and
 *  index 0 has to be the checkout a lone clone and CI have — then the linked
 *  ones sorted here.
 *
 *  The sort is not decoration. git promises no order for the linked worktrees
 *  (it prints its own directory order), and the ordinal IS the port, so an
 *  order that varied between two lanes reading the same set of checkouts would
 *  let them disagree about a port for the same reason a hash would. Sorting
 *  makes the ordinal a function of the SET, which is what the injectivity
 *  argument needs. */
export function worktreeRoots(listing: string): readonly string[] {
  const printed = listing.split("\n").flatMap((line) => {
    const match = WORKTREE_LINE.exec(line);
    return match === null ? [] : [match[1] ?? ""];
  });
  return printed.length === 0 ? [] : [printed[0] ?? "", ...printed.slice(1).sort()];
}

/** This checkout's position in the listing. The main checkout is 0. */
export function ordinalOf(listing: string, worktreeRoot: string): number | null {
  const index = worktreeRoots(listing).findIndex((root) => samePath(root, worktreeRoot));
  return index === -1 ? null : index;
}

/** Ordinals map one-to-one onto ports, so distinct checkouts cannot collide. */
export function portForOrdinal(ordinal: number): number {
  const port = MAIN_WORKTREE_PORT + ordinal;
  if (port > MAX_PORT) throw new Error(ordinalRefusal(ordinal, port));
  return port;
}

/** `git worktree list --porcelain` for this checkout, or null when git cannot
 *  answer — a lane that cannot be placed falls back to the documented port
 *  rather than inventing one. */
export function readWorktreeListing(worktreeRoot: string): string | null {
  try {
    return execFileSync("git", ["-C", worktreeRoot, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** Path equality that survives a symlinked checkout root (`/tmp` on macOS). */
function samePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  if (resolvedLeft === resolvedRight) return true;
  return realpathOr(resolvedLeft) === realpathOr(resolvedRight);
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function unusablePort(raw: string, variable: string): string {
  return (
    `${variable}=${raw} is not a TCP port. ` +
    `Unset it, or set it to an integer between 1 and ${String(MAX_PORT)}.`
  );
}

function ordinalRefusal(ordinal: number, port: number): string {
  return (
    `this checkout is worktree ${String(ordinal)} in git's list, which would put the lane on port ` +
    `${String(port)}; pin ${EMITTED_WORKER_PORT_ENV} to a port of your own instead.`
  );
}
