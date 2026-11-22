/**
 * SUT: the sealed API Worker bundle CD publishes — what `.github/scripts/release/build-worker.mjs api`
 * writes — started in workerd. `entry-bundle.test.ts` starts a Wrangler build of `src/entry.ts` alone;
 * this is the release build of the whole configured Worker, the bytes CD uploads.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Miniflare, type Request as WorkerRequest } from "miniflare";
import { process } from "../test-support/node-globals.ts";

const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url));
const BUILD_WORKER = join(REPOSITORY, ".github/scripts/release/build-worker.mjs");

/** The two runtime settings the sealed config declares and CD deploys with. */
interface SealedRuntime {
  readonly compatibility_date: string;
  readonly compatibility_flags: string[];
}

/** Starting needs no network; an outbound request is the failure, named. */
function refuseOutbound(request: WorkerRequest): never {
  throw new Error(`the sealed API Worker made an outbound request: ${request.method} ${request.url}`);
}

const root = await mkdtemp(join(tmpdir(), "api-sealed-"));
after(() => rm(root, { recursive: true, force: true }));

async function bootSealedApi(): Promise<Miniflare> {
  await promisify(execFile)(process.execPath, [BUILD_WORKER, "api", "", root], {
    cwd: REPOSITORY, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, maxBuffer: 16 * 1024 * 1024,
  });
  const runtime = JSON.parse(await readFile(join(root, "api", "wrangler.json"), "utf8")) as SealedRuntime;
  const bundle = join(root, "api", "bundle");
  return new Miniflare({ modules: [{ type: "ESModule", path: join(bundle, "entry.js") }], modulesRoot: bundle, port: 0,
    compatibilityDate: runtime.compatibility_date, compatibilityFlags: runtime.compatibility_flags, outboundService: refuseOutbound });
}

void test("the sealed API Worker starts in workerd and answers an unknown path with its 404", { timeout: 120_000 }, async (context) => {
  const worker = await bootSealedApi();
  context.after(() => worker.dispose());
  const response = await worker.dispatchFetch("https://api.test/not-a-route");
  assert.equal(response.status, 404);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "not_found");
});
