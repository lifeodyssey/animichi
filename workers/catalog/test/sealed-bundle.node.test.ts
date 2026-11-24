import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Miniflare, type Request as WorkerRequest } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";
import { startDroppingDatabase } from "./dropping-database";
import { FAILED_PROCEDURE } from "./failed-procedure-answer";
import { profileSealedStartup } from "./sealed-startup";

// SUT: the sealed catalog bundle CD publishes — what `.github/scripts/release/build-worker.mjs
// catalog` writes — built once and observed three ways: started in workerd, profiled by `wrangler
// check startup`, and sent its first database request. `build-worker.test.sh` proves it bundles;
// the worker pool evaluates unbundled modules, so a failure that exists only in the bundle (the
// StringChunk TDZ of 2026-08-05, an import-time Node API a dependency upgrade brings) is visible
// here alone.
//
// Cloudflare refuses a Worker whose startup, the evaluation of its global scope, takes longer than
// a second, so the catalog's Prisma access loads on the first request that needs it
// (`src/db/prisma-first-use.ts`). The boot proves the global scope evaluates to its end. The
// profile proves that evaluation builds no Prisma or ArkType schema, but alone it proves no start:
// a global scope that throws can read as an empty, fast start, so its count stands only beside this
// file's boot of the same build. Neither loads Prisma, and no CD step requests a catalog database
// route. The third case does: its database is a loopback listener that takes each connection and
// drops it. A connection arrives only once Prisma has loaded and built its client; a load that
// fails answers the same oRPC 500 and never connects, so the count, not the answer, tells them
// apart.

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
const database = await startDroppingDatabase();
let release: Promise<string> | undefined;
let worker: Miniflare | undefined;
afterAll(async () => {
  await worker?.dispose();
  await database.close();
  await rm(root, { recursive: true, force: true });
});

/** The release directory (`wrangler.json` and `bundle/`), built on first use and shared by the file. */
function sealedRelease(): Promise<string> {
  release ??= promisify(execFile)(process.execPath, [BUILD_WORKER, "catalog", "", root], {
    cwd: REPOSITORY, maxBuffer: 16 * 1024 * 1024,
  }).then(() => join(root, "catalog"));
  return release;
}

/** Start the bundle in workerd; a runtime that failed to start is disposed before its error surfaces. */
async function start(bundle: string, runtime: SealedRuntime): Promise<Miniflare> {
  const started = new Miniflare({ modules: [{ type: "ESModule", path: join(bundle, "index.js") }], modulesRoot: bundle, port: 0,
    compatibilityDate: runtime.compatibility_date, compatibilityFlags: runtime.compatibility_flags, outboundService: refuseOutbound,
    bindings: { DATABASE_URL: database.url } });
  try {
    await started.ready;
    return started;
  } catch (error) {
    await started.dispose();
    throw error;
  }
}

/** The release started in workerd, once; every case after the first gets the same runtime. */
async function bootSealedCatalog(): Promise<Miniflare> {
  const built = await sealedRelease();
  const runtime = JSON.parse(await readFile(join(built, "wrangler.json"), "utf8")) as SealedRuntime;
  worker ??= await start(join(built, "bundle"), runtime);
  return worker;
}

/** The catalog's first database request: a nearby read, behind the `/catalog/*` boundary that connects. */
function firstDatabaseRequest(catalog: Miniflare) {
  return catalog.dispatchFetch("https://catalog.test/catalog/nearby", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: 36.1, lng: 139.6, radius_m: 5000 }),
  });
}

// The release build is a Wrangler dry-run of the whole Worker, then a workerd start, in one test:
// 3.8 s and 3.9 s on a 10-core host at a one-minute load average of 14 (2026-11-22). The release
// script stops a Wrangler run at 60 s with its own diagnostic (`WRANGLER_BUILD_TIMEOUT_MS`), so
// this suite's 90 s leaves that diagnostic 30 s to surface ahead of the test's own timeout. The
// profile's own Wrangler run is stopped at the same 60 s (`sealed-startup.ts`).
describe("the sealed catalog bundle in workerd", { timeout: 90_000 }, () => {
  it("starts and answers /healthz", async () => {
    const response = await (await bootSealedCatalog()).dispatchFetch("https://catalog.test/healthz");
    expect({ status: response.status, body: await response.json() })
      .toMatchObject({ status: 200, body: { status: "ok", service: "catalog" } });
  });

  it("starts without building Prisma's or ArkType's schemas", async () => {
    const startup = await profileSealedStartup(await sealedRelease());
    expect(startup.schemaSourcesInBundle).toBeGreaterThan(0);
    expect(startup.schemaSamplesAtStartup).toBe(0);
  });

  it("loads Prisma on its first database request, as far as the connect", async () => {
    const response = await firstDatabaseRequest(await bootSealedCatalog());
    expect({ status: response.status, body: await response.text(), connections: database.connections() })
      .toEqual({ ...FAILED_PROCEDURE, connections: 1 });
  });
});
