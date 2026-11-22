import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Miniflare, type Request as WorkerRequest } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";

// SUT: the sealed catalog bundle CD publishes — what `.github/scripts/release/build-worker.mjs
// catalog` writes — started in workerd. `build-worker.test.sh` proves it bundles; the worker pool
// evaluates unbundled modules, so a failure that exists only in the bundle (the StringChunk TDZ
// of 2026-08-05, an import-time Node API a dependency upgrade brings) is visible here alone.

const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url).href);
const BUILD_WORKER = join(REPOSITORY, ".github/scripts/release/build-worker.mjs");

/** The two runtime settings the sealed config declares and CD deploys with. */
interface SealedRuntime {
  readonly compatibility_date: string;
  readonly compatibility_flags: string[];
}

/** Starting needs no network; an outbound request is the failure, named. */
function refuseOutbound(request: WorkerRequest): never {
  throw new Error(`the sealed catalog made an outbound request: ${request.method} ${request.url}`);
}

const root = await mkdtemp(join(tmpdir(), "catalog-sealed-"));
let worker: Miniflare | undefined;
afterAll(async () => {
  await worker?.dispose();
  await rm(root, { recursive: true, force: true });
});

/** Start the bundle in workerd; a runtime that failed to start is disposed before its error surfaces. */
async function start(bundle: string, runtime: SealedRuntime): Promise<Miniflare> {
  const started = new Miniflare({ modules: [{ type: "ESModule", path: join(bundle, "index.js") }], modulesRoot: bundle, port: 0,
    compatibilityDate: runtime.compatibility_date, compatibilityFlags: runtime.compatibility_flags, outboundService: refuseOutbound });
  try {
    await started.ready;
    return started;
  } catch (error) {
    await started.dispose();
    throw error;
  }
}

async function bootSealedCatalog(): Promise<Miniflare> {
  await promisify(execFile)(process.execPath, [BUILD_WORKER, "catalog", "", root], {
    cwd: REPOSITORY, maxBuffer: 16 * 1024 * 1024,
  });
  const runtime = JSON.parse(await readFile(join(root, "catalog", "wrangler.json"), "utf8")) as SealedRuntime;
  worker = await start(join(root, "catalog", "bundle"), runtime);
  return worker;
}

// The release build is a Wrangler dry-run of the whole Worker, then a workerd start, in one test:
// 3.8 s and 3.9 s on a 10-core host at a one-minute load average of 14 (2026-11-22). The pool's
// 20 s budget leaves a cold two-core runner little room, so this suite states its own.
describe("the sealed catalog bundle in workerd", { timeout: 60_000 }, () => {
  it("starts and answers /healthz", async () => {
    const response = await (await bootSealedCatalog()).dispatchFetch("https://catalog.test/healthz");
    expect({ status: response.status, body: await response.json() })
      .toMatchObject({ status: 200, body: { status: "ok", service: "catalog" } });
  });
});
