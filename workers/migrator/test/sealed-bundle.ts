/**
 * The migrator's sealed release bundle, booted in workerd: what
 * `.github/scripts/release/build-worker.mjs migrator` writes and CD publishes with
 * `wrangler deploy --no-bundle`.
 *
 * The release script itself builds it, into a scratch root, so the runtime loads the bytes CD
 * deploys rather than an approximation of them. It builds once per test file, so the boot, the
 * startup profile (`sealed-startup.ts`) and the preflight (`sealed-preflight.ts`) observe the same
 * bytes. Its modules are the ones the sealed `wrangler.json` uploads: `index.js` as the entry, and
 * `contract.json` and every file under `migrations/` as Text modules under their own names, which
 * the Worker reads back at `/bundle/migrations`.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Miniflare, type MiniflareOptions, type Request as WorkerRequest } from "miniflare";
import { placeholderRequestCf } from "./placeholder-request-cf";

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

/** What a test adds to the Worker's surroundings: bindings, and what answers its outbound requests
 * in place of the refusal. */
export type SealedOutside = Partial<Pick<MiniflareOptions, "bindings" | "outboundService">>;

async function boot(release: string, outside: SealedOutside): Promise<Miniflare> {
  const runtime = JSON.parse(await readFile(join(release, "wrangler.json"), "utf8")) as SealedRuntime;
  const bundle = join(release, "bundle");
  const worker = new Miniflare({ modules: await sealedModules(bundle), modulesRoot: bundle, port: 0,
    compatibilityDate: runtime.compatibility_date, compatibilityFlags: runtime.compatibility_flags,
    durableObjects: { MIGRATOR_APPLY_LOCK: { className: "MigratorApplyLock", useSQLite: true } },
    outboundService: refuseOutbound, ...placeholderRequestCf, ...outside });
  try {
    await worker.ready;
    return worker;
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}

let scratch: string | undefined;
let release: Promise<string> | undefined;

async function buildInScratch(): Promise<string> {
  scratch = await mkdtemp(join(tmpdir(), "migrator-sealed-"));
  return buildSealed(scratch);
}

/** The release directory (`wrangler.json` and `bundle/`), built on first use and shared by the file. */
export function sealedRelease(): Promise<string> {
  release ??= buildInScratch();
  return release;
}

/** Removes the scratch root behind `sealedRelease`, after a build that failed as well. */
export async function discardSealedRelease(): Promise<void> {
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
}

/** Boots the shared release; `close` stops the runtime and leaves the release to `discardSealedRelease`. */
export async function bootSealedMigrator(outside: SealedOutside = {}) {
  const worker = await boot(await sealedRelease(), outside);
  return { worker, close: () => worker.dispose() };
}
