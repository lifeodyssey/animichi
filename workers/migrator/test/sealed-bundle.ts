/**
 * The migrator's sealed release bundle, booted in workerd: what
 * `.github/scripts/release/build-worker.mjs migrator` writes and CD publishes with
 * `wrangler deploy --no-bundle`.
 *
 * The release script itself builds it, into a scratch root, so the runtime loads the bytes CD
 * deploys rather than an approximation of them. Its modules are the ones the sealed `wrangler.json`
 * uploads: `index.js` as the entry, and `contract.json` and every file under `migrations/` as Text
 * modules under their own names, which the Worker reads back at `/bundle/migrations`.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Miniflare, type Request as WorkerRequest } from "miniflare";

const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url).href);
const BUILD_WORKER = join(REPOSITORY, ".github/scripts/release/build-worker.mjs");

/** The two runtime settings the sealed config declares and CD deploys with. */
interface SealedRuntime {
  readonly compatibility_date: string;
  readonly compatibility_flags: string[];
}

async function buildSealed(root: string): Promise<string> {
  await promisify(execFile)(process.execPath, [BUILD_WORKER, "migrator", "", root], {
    cwd: REPOSITORY, maxBuffer: 16 * 1024 * 1024,
  });
  return join(root, "migrator");
}

/** The sealed config's Text rule: `contract.json` and everything under `migrations/`. */
function uploadedAsText(name: string): boolean {
  return name === "contract.json" || name.startsWith("migrations/");
}

async function sealedModules(bundle: string) {
  const entries = await readdir(bundle, { recursive: true, withFileTypes: true });
  const texts = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => uploadedAsText(relative(bundle, path)));
  const textModules = await Promise.all(texts.map(async (path) => ({ type: "Text" as const, path, contents: await readFile(path, "utf8") })));
  return [{ type: "ESModule" as const, path: join(bundle, "index.js") }, ...textModules];
}

/** Starting needs no network; an outbound request is the failure, named. */
function refuseOutbound(request: WorkerRequest): never {
  throw new Error(`the sealed migrator made an outbound request: ${request.method} ${request.url}`);
}

async function boot(release: string): Promise<Miniflare> {
  const runtime = JSON.parse(await readFile(join(release, "wrangler.json"), "utf8")) as SealedRuntime;
  const bundle = join(release, "bundle");
  const worker = new Miniflare({ modules: await sealedModules(bundle), modulesRoot: bundle, port: 0,
    compatibilityDate: runtime.compatibility_date, compatibilityFlags: runtime.compatibility_flags,
    durableObjects: { MIGRATOR_APPLY_LOCK: { className: "MigratorApplyLock", useSQLite: true } },
    outboundService: refuseOutbound });
  try {
    await worker.ready;
    return worker;
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}

/** Build and boot; the scratch root goes with the runtime, and with a build or boot that failed. */
export async function bootSealedMigrator() {
  const root = await mkdtemp(join(tmpdir(), "migrator-sealed-"));
  const discard = () => rm(root, { recursive: true, force: true });
  try {
    const worker = await boot(await buildSealed(root));
    return { worker, close: async () => { await worker.dispose(); await discard(); } };
  } catch (error) {
    await discard();
    throw error;
  }
}
