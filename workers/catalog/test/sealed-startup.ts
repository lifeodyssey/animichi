/**
 * The sealed catalog's startup as Wrangler profiles it: `wrangler check startup` over a release
 * the release script built, with the no-bundle config CD publishes to staging, and each sample of
 * the profile attributed to its source through the bundle's own source map.
 *
 * Wrangler profiles the evaluation of the upload's global scope, but the profile is no evidence of
 * a successful start: a global scope that throws can read as an empty, fast start. A count from
 * this profile therefore stands only beside a boot of the same release, which
 * `sealed-bundle.node.test.ts` runs to its end.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire, SourceMap, type SourceMapPayload } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

/** Wrangler's CLI itself, not its launcher: killing the launcher would leave the CLI running. */
const WRANGLER_CLI = createRequire(import.meta.url).resolve("wrangler");

/** The bound the release build gives one Wrangler run (`WRANGLER_BUILD_TIMEOUT_MS`). */
const CHECK_STARTUP_BOUND_MS = 60_000;

/** Nothing leaves the machine. */
const OFFLINE = {
  // Miniflare, which Wrangler starts to profile in, would fetch Cloudflare's `Request.cf` object.
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
  WRANGLER_SEND_METRICS: "false",
  // The banner's update check asks the npm registry for Wrangler's latest version.
  WRANGLER_HIDE_BANNER: "true",
  // No debug log file in the home directory.
  WRANGLER_WRITE_LOGS: "false",
};

/** The upload's entry module, as the profile's frames name it. */
const ENTRY = "/index.js";

/**
 * What `src/db/prisma.ts` brings when it evaluates: ArkType, which builds Prisma's validation
 * schemas, and Prisma's Postgres facade and target, which validate the contract and build the codec
 * registry, as pnpm installs them, store directories included. Prisma's SQL family and framework
 * packages are not marked: the plan repairs in `src/db/plans.ts` keep their AST classes static, and
 * those build no schema.
 */
const PRISMA_SCHEMA_WORK = /\/node_modules\/(?:\.pnpm\/)?(?:@ark[+/]|arktype[@/]|@prisma[+/]orm-postgres[@/]|@prisma[+/]orm-target-postgres[@/])/;

interface CallFrame {
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

interface CpuProfile {
  readonly nodes: readonly { readonly id: number; readonly callFrame: CallFrame; readonly children?: readonly number[] }[];
  readonly samples: readonly number[];
}

/** The release's startup profile. Wrangler splits `--args` at spaces; the scratch root has none. */
async function startupProfile(release: string): Promise<CpuProfile> {
  const outfile = join(release, "startup.cpuprofile");
  await promisify(execFile)(process.execPath, [WRANGLER_CLI, "check", "startup", "--outfile", outfile,
    `--args=--config ${join(release, "wrangler.json")} --no-bundle --env staging`], {
    cwd: dirname(release), env: { ...process.env, ...OFFLINE }, timeout: CHECK_STARTUP_BOUND_MS, killSignal: "SIGKILL",
  });
  return JSON.parse(await readFile(outfile, "utf8")) as CpuProfile;
}

/** Where a frame of the bundle came from, through its map; "" for a frame of any other module. */
function sourceOf(frame: CallFrame, map: SourceMap): string {
  if (!frame.url.endsWith(ENTRY)) return "";
  const entry = map.findEntry(frame.lineNumber, frame.columnNumber);
  return "originalSource" in entry ? entry.originalSource : "";
}

/** How many samples had a frame of `isMarked` on the stack: the sampled frame or one of its callers. */
function samplesUnder(profile: CpuProfile, isMarked: (frame: CallFrame) => boolean): number {
  const marked = new Set(profile.nodes.filter((node) => isMarked(node.callFrame)).map((node) => node.id));
  const callerOf = new Map(profile.nodes.flatMap((node) => (node.children ?? []).map((child) => [child, node.id] as const)));
  const under = (id: number | undefined): boolean => id !== undefined && (marked.has(id) || under(callerOf.get(id)));
  return profile.samples.filter((id) => under(id)).length;
}

export interface SealedStartup {
  /** Sources of that schema work the bundle carries: what the profile could have sampled. */
  readonly schemaSourcesInBundle: number;
  /** Samples taken while that schema work was on the stack. */
  readonly schemaSamplesAtStartup: number;
}

/** Profile the startup of the release in `release` (its `wrangler.json` and `bundle/`). */
export async function profileSealedStartup(release: string): Promise<SealedStartup> {
  const profile = await startupProfile(release);
  const map = new SourceMap(JSON.parse(await readFile(join(release, "bundle", "index.js.map"), "utf8")) as SourceMapPayload);
  return {
    schemaSourcesInBundle: map.payload.sources.filter((source) => PRISMA_SCHEMA_WORK.test(source)).length,
    schemaSamplesAtStartup: samplesUnder(profile, (frame) => PRISMA_SCHEMA_WORK.test(sourceOf(frame, map))),
  };
}
