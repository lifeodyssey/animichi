/**
 * The emitted-Worker lane's port, as a specification (#1692).
 *
 * The lane used to hardcode `8799` in `playwright.config.ts` while this
 * repository is worked in dozens of checkouts on one machine, so two lanes
 * shared one port: a collision at startup failed loudly, but a collision
 * *mid-run* made the first lane's server disappear and its specs fail with
 * Chromium's `ERR_CONNECTION_REFUSED` from inside a test body — which names
 * neither the port nor the culprit.
 *
 * These are the properties that make that impossible rather than unlikely: the
 * port is a function of which checkout asks, and two checkouts are two
 * ordinals in one `git worktree list` listing. Distinct ordinals are distinct
 * ports by construction — there is no hash and therefore no collision
 * probability to reason about.
 *
 * The last case is the second half: the port is *claimed*, so a stranded
 * listener (a `workerd` orphaned by a killed `wrangler`) is refused before a
 * spec runs, by name.
 *
 * test-type: unit (pure derivation; the refusal case spawns the check against a
 * real listener on an ephemeral port, with no clock and no browser).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CLAIMED_PORT_ENV,
  EMITTED_WORKER_PORT_ENV,
  MAIN_WORKTREE_PORT,
  claimedPort,
  emittedWorkerPort,
  ordinalOf,
  portForOrdinal,
  portOverride,
  worktreeRoots,
} from "./lane-port.ts";

const MAIN_ROOT = "/repo";
const LINKED_A = "/repo/.worktrees/a-card";
const LINKED_B = "/Users/someone/worktrees/another-card";
const CHECK_CLI = fileURLToPath(new URL("./lane-port-check.ts", import.meta.url));

/** A `git worktree list --porcelain` listing: the main checkout first, then
 *  every linked one — the order git prints them in. */
function listingOf(...roots: readonly string[]): string {
  return roots
    .map((root, index) => `worktree ${root}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/b${String(index)}\n`)
    .join("\n");
}

const LISTING = listingOf(MAIN_ROOT, LINKED_A, LINKED_B);

void test("the main checkout keeps the documented port, so CI and a lone human are unchanged", () => {
  assert.equal(emittedWorkerPort({}, MAIN_ROOT, LISTING), MAIN_WORKTREE_PORT);
  assert.equal(MAIN_WORKTREE_PORT, 8799);
});

void test("the port depends on which checkouts exist, not on the order git prints them", () => {
  // `git worktree list` promises only that the main checkout comes first; the
  // order of the linked ones is its directory order. The ordinal — and so the
  // port — must be a function of the SET of checkouts, or two lanes reading the
  // same set could disagree about it.
  const reversed = listingOf(MAIN_ROOT, LINKED_B, LINKED_A);
  for (const root of [MAIN_ROOT, LINKED_A, LINKED_B]) {
    assert.equal(emittedWorkerPort({}, root, reversed), emittedWorkerPort({}, root, LISTING));
  }
  assert.deepEqual(worktreeRoots(reversed), worktreeRoots(LISTING));
});

void test("two different checkouts cannot derive the same port, because they are two ordinals", () => {
  const first = emittedWorkerPort({}, LINKED_A, LISTING);
  const second = emittedWorkerPort({}, LINKED_B, LISTING);
  assert.notEqual(first, second);
  assert.equal(first, portForOrdinal(ordinalOf(LISTING, LINKED_A) ?? -1));
});

void test("every checkout on the machine derives a distinct port, at any worktree count", () => {
  const roots = Array.from({ length: 63 }, (_, index) => `/repo/.worktrees/card-${String(index)}`);
  const ports = [MAIN_ROOT, ...roots].map((root) => emittedWorkerPort({}, root, listingOf(MAIN_ROOT, ...roots)));
  assert.equal(new Set(ports).size, ports.length, "distinct checkouts must not share a port");
});

void test("E2E_EMITTED_WORKER_PORT wins over the derivation", () => {
  const env = { [EMITTED_WORKER_PORT_ENV]: "9010" };
  assert.equal(emittedWorkerPort(env, LINKED_A, LISTING), 9010);
});

void test("an override that is not a port is refused rather than ignored", () => {
  assert.throws(() => portOverride("not-a-port"), /E2E_EMITTED_WORKER_PORT/);
  assert.throws(() => portOverride("0"), /E2E_EMITTED_WORKER_PORT/);
  assert.throws(() => portOverride("70000"), /E2E_EMITTED_WORKER_PORT/);
  assert.equal(portOverride(undefined), null);
  assert.equal(portOverride("  "), null);
});

void test("a checkout git cannot place falls back to the documented port, never to a guess", () => {
  assert.equal(emittedWorkerPort({}, "/somewhere/else", LISTING), MAIN_WORKTREE_PORT);
  assert.equal(emittedWorkerPort({}, LINKED_A, null), MAIN_WORKTREE_PORT);
});

void test("an ordinal past the last valid port is refused, not wrapped onto someone else's", () => {
  assert.equal(portForOrdinal(0), MAIN_WORKTREE_PORT);
  assert.throws(() => portForOrdinal(65_535 - MAIN_WORKTREE_PORT + 1), /worktree/);
});

void test("a claimed port is the whole run's port, even if the derivation moves under it", () => {
  // The runner records the claim at config load; every worker and the server
  // command inherit it, so a worktree added while this lane builds cannot move
  // the port under a worker that re-derives it.
  const env = { [CLAIMED_PORT_ENV]: "9011" };
  assert.equal(claimedPort(env), 9011);
  assert.equal(claimedPort({}), null);
  assert.throws(() => claimedPort({ [CLAIMED_PORT_ENV]: "nope" }), /E2E_CLAIMED_WORKER_PORT/);
});

void test("the override's name is the one the prose and the lane use", () => {
  assert.equal(EMITTED_WORKER_PORT_ENV, "E2E_EMITTED_WORKER_PORT");
});

void test("a stranded listener is refused by name, naming the port and the holder", async () => {
  const squatter = createServer();
  const port = await listenOnEphemeral(squatter);
  try {
    const check = spawnSync(process.execPath, [CHECK_CLI, String(port)], { encoding: "utf8" });
    assert.notEqual(check.status, 0, "a claimed port must fail the lane before any spec runs");
    assert.match(check.stderr, new RegExp(String(port)));
    assert.match(check.stderr, new RegExp(String(process.pid)));
  } finally {
    squatter.close();
  }
});

function listenOnEphemeral(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}
