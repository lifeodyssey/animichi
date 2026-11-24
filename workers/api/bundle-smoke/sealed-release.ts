/**
 * The API Worker's sealed release, the bytes CD uploads: what `.github/scripts/release/build-worker.mjs api`
 * writes. The release script itself builds it, into a scratch root, once per test file, so every
 * observation a file makes, the boot and the startup profile, is of the same bytes.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Miniflare, type Request as WorkerRequest } from "miniflare";
import { process } from "../test-support/node-globals.ts";
import { placeholderRequestCf } from "./placeholder-request-cf.ts";

const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url));
const BUILD_WORKER = join(REPOSITORY, ".github/scripts/release/build-worker.mjs");

/** The two runtime settings the sealed config declares and CD deploys with. */
interface SealedRuntime {
  readonly compatibility_date: string;
  readonly compatibility_flags: string[];
}

let scratch: string | undefined;
let release: Promise<string> | undefined;

async function buildInScratch(): Promise<string> {
  scratch = await mkdtemp(join(tmpdir(), "api-sealed-"));
  await promisify(execFile)(process.execPath, [BUILD_WORKER, "api", "", scratch], {
    cwd: REPOSITORY, maxBuffer: 16 * 1024 * 1024,
  });
  return join(scratch, "api");
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

/** The booted release, and every outbound fetch it attempted: each one is refused. */
export interface BootedRelease {
  readonly worker: Miniflare;
  readonly outbound: readonly string[];
}

/** An `outboundService` that records each fetch it is handed in `outbound`, then refuses it. */
function refusingInto(outbound: string[]) {
  return (request: WorkerRequest): never => {
    outbound.push(`${request.method} ${request.url}`);
    throw new Error(`the sealed API Worker made an outbound request: ${request.method} ${request.url}`);
  };
}

/** Starts the shared release in workerd with `bindings`. Nothing it fetches leaves the process, and
 * Miniflare does not fetch Cloudflare's `Request.cf` object (`placeholderRequestCf`). */
export async function bootSealedRelease(bindings: Record<string, string>): Promise<BootedRelease> {
  const directory = await sealedRelease();
  const runtime = JSON.parse(await readFile(join(directory, "wrangler.json"), "utf8")) as SealedRuntime;
  const bundle = join(directory, "bundle");
  const outbound: string[] = [];
  const worker = new Miniflare({ modules: [{ type: "ESModule", path: join(bundle, "entry.js") }], modulesRoot: bundle,
    port: 0, ...placeholderRequestCf, compatibilityDate: runtime.compatibility_date, compatibilityFlags: runtime.compatibility_flags,
    bindings, outboundService: refusingInto(outbound) });
  return { worker, outbound };
}
