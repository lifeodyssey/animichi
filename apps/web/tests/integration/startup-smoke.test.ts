import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Boot the artifact main CD actually promotes, and ask it for a page.
 *
 * CD ships Nitro's prebuilt chunks with `wrangler deploy --no-bundle`, so no
 * esbuild pass rewrites them on the way out. Nothing else in this package's
 * gates ever evaluates those chunks: unit tests import source modules with the
 * SDK mocked, and the other integration cases only dry-run the upload and read
 * the emitted files. That blind spot shipped a Worker which answered 500 to
 * every request — `@neondatabase/auth` calls `crypto.randomUUID()` at module
 * scope, and workerd evaluates module top level outside an I/O context — while
 * every gate stayed green. Only a real boot catches that class of failure.
 */

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const nodeRequire = createRequire(import.meta.url);
/** Resolved, never taken from PATH, and run with this interpreter rather than a shebang. */
const WRANGLER_BIN = join(dirname(nodeRequire.resolve("wrangler/package.json")), "bin", "wrangler.js");
const PORT = 8797;
const ORIGIN = `http://127.0.0.1:${String(PORT)}`;
const BOOT_TIMEOUT_MS = 120_000;
const READY_MARKER = "Ready on";

let worker: ChildProcess | undefined;
let log = "";

function bootPromotedWorker(): ChildProcess {
  const args = [WRANGLER_BIN, "dev", "--no-bundle", "--local", "--ip", "127.0.0.1", "--port", String(PORT)];
  const child = spawn(process.execPath, args, { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] });
  const collect = (chunk: Buffer): void => { log += String(chunk); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  // A spawn that never starts emits `error` and no output at all, which would
  // otherwise read as "still booting" for the whole timeout.
  child.on("error", (error: Error) => { log += `spawn failed: ${error.message}\n`; });
  return child;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A signal kill leaves `exitCode` null, so reading it alone waits out the timeout. */
function bootFailure(child: ChildProcess): string | undefined {
  if (child.signalCode !== null) return `wrangler dev was killed by ${child.signalCode}`;
  if (child.exitCode !== null) return `wrangler dev exited (${String(child.exitCode)})`;
  return undefined;
}

/** Wrangler announces its port once workerd holds the Worker; poll the log, not the socket. */
async function waitForReady(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = bootFailure(child);
    if (failure !== undefined) throw new Error(`startup smoke: ${failure}\n${log}`);
    if (log.includes(READY_MARKER)) return;
    await sleep(250);
  }
  throw new Error(`startup smoke: never became ready within ${String(BOOT_TIMEOUT_MS)}ms\n${log}`);
}

beforeAll(async () => {
  worker = bootPromotedWorker();
  await waitForReady(worker);
}, BOOT_TIMEOUT_MS + 10_000);

afterAll(() => {
  worker?.kill("SIGTERM");
});

describe("promoted Worker startup", () => {
  it("server-renders the doorway instead of an error envelope", async () => {
    const response = await fetch(ORIGIN, { signal: AbortSignal.timeout(30_000) });
    const html = await response.text();

    // The Worker's own log carries the cause; Nitro redacts it out of the body,
    // so a bare `expected 500 to be 200` would send the reader hunting for it.
    expect(response.status, log).toBe(200);
    // `<main>` only exists once the route tree rendered on the server: a Worker
    // that boots but cannot run a route still answers with Nitro's JSON shell.
    expect(html, log).toContain("<main");
  });
});
