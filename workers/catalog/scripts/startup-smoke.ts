/**
 * Startup smoke for the catalog Worker.
 *
 * Builds the real deploy bundle (`wrangler deploy --dry-run --outdir`) and
 * boots it in workerd via `wrangler dev`, then asserts /healthz answers 200
 * with `{"status":"ok"}`.
 *
 * Why this exists: the vitest worker pool evaluates UNBUNDLED source modules
 * with correct ESM order, so bundle-only startup failures are invisible to
 * every unit test. The StringChunk TDZ that blocked all staging deploys
 * (ef1f7369, 2026-08-05) was exactly such a failure — green CI, dead Worker.
 * Only a real boot of the bundled Worker catches this class of bug. Wired
 * into CI as the `catalog-startup-smoke` job (runs on every PR touching
 * workers/catalog).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BUNDLE_DIR = join(CATALOG_DIR, "dist", "smoke");
const PORT = 8796;
const HEALTH_URL = `http://127.0.0.1:${String(PORT)}/healthz`;
const BOOT_TIMEOUT_MS = 90_000;
const FAILURE_MARKERS = ["Uncaught", "failed to start", "Incorrect type for map entry"];

interface WranglerProc {
  child: ChildProcess;
  output: () => string;
}

/** The deploy bundling path must succeed before we boot anything. */
async function dryRunDeploy(): Promise<void> {
  const { child, output } = spawnWrangler(["deploy", "--dry-run", "--outdir", BUNDLE_DIR]);
  const code = await waitForExit(child);
  if (code !== 0) {
    throw new Error(`startup smoke: wrangler deploy --dry-run failed (exit ${String(code)})\n${output()}`);
  }
}

/** Boot the bundled Worker in workerd and wait for a healthy /healthz. */
async function bootAndCheckHealth(): Promise<void> {
  const { child, output } = spawnWrangler(["dev", "--port", String(PORT)]);
  try {
    await waitForHealth(child, output);
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

/** Poll /healthz until the bundled Worker answers, throwing on boot failure. */
async function waitForHealth(
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = bootFailure(child, output);
    if (failure !== undefined) throw new Error(failure);
    if (await healthOk()) return;
    await sleep(500);
  }
  throw new Error(`startup smoke: /healthz not healthy within ${String(BOOT_TIMEOUT_MS)}ms\n${output()}`);
}

/** A boot-time failure message, or undefined while wrangler dev is still healthy. */
function bootFailure(
  child: ChildProcess,
  output: () => string,
): string | undefined {
  if (child.exitCode !== null) {
    return `startup smoke: wrangler dev exited early (${String(child.exitCode)})\n${output()}`;
  }
  const log = output();
  if (FAILURE_MARKERS.some((marker) => log.includes(marker))) {
    return `startup smoke: bundled Worker failed to boot\n${log}`;
  }
  return undefined;
}

function spawnWrangler(args: string[]): WranglerProc {
  const child = spawn("pnpm", ["exec", "wrangler", ...args], {
    cwd: CATALOG_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += String(chunk);
  });
  return { child, output: () => output };
}

async function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.on("exit", (code) => {
      resolve(code);
    });
  });
}

async function healthOk(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2_000) });
    if (res.status !== 200) return false;
    const body: unknown = await res.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { status?: unknown }).status === "ok"
    );
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  rmSync(BUNDLE_DIR, { recursive: true, force: true });
  mkdirSync(BUNDLE_DIR, { recursive: true });
  try {
    await dryRunDeploy();
    await bootAndCheckHealth();
    console.log("startup smoke: bundled catalog Worker boots and serves /healthz (200)");
  } finally {
    rmSync(BUNDLE_DIR, { recursive: true, force: true });
  }
}

await main();
