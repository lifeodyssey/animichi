/**
 * The sealed migrator's startup as Wrangler profiles it: `wrangler check startup` over the release
 * `sealedRelease()` built, with the no-bundle config CD publishes to staging, and each sample of the
 * profile attributed to its source through the bundle's own source map.
 *
 * Wrangler profiles the evaluation of the upload's global scope, but the profile is no evidence of
 * a successful start: a global scope that throws can read as an empty, fast start. A count from
 * this profile therefore stands only beside a boot of the same release, which
 * `sealed-bundle.workerd.test.ts` runs to its end.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire, SourceMap, type SourceMapPayload } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { sealedRelease } from "./sealed-bundle";

/** Wrangler's CLI itself, not its launcher: killing the launcher would leave the CLI running. */
const WRANGLER_CLI = createRequire(import.meta.url).resolve("wrangler");

/** The bound the release build gives one Wrangler run (`WRANGLER_BUILD_TIMEOUT_MS`). The whole check,
 * packaging and Miniflare included, measured 5 to 13 s at a load average near 50. */
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

/** Prisma control and ArkType as pnpm installs them, store directories included, and the
 * repository's Prisma extension pack. */
const PRISMA_OR_ARKTYPE = /\/node_modules\/(?:\.pnpm\/)?(?:@prisma[+/]|@ark[+/]|arktype[@/])|\/packages\/prisma-geography\//;

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
  /** Prisma control and ArkType sources the bundle carries: what the profile could have sampled. */
  readonly prismaSourcesInBundle: number;
  /** Samples taken while Prisma control or ArkType code was on the stack. */
  readonly prismaSamplesAtStartup: number;
}

export async function profileSealedStartup(): Promise<SealedStartup> {
  const release = await sealedRelease();
  const profile = await startupProfile(release);
  const map = new SourceMap(JSON.parse(await readFile(join(release, "bundle", "index.js.map"), "utf8")) as SourceMapPayload);
  return {
    prismaSourcesInBundle: map.payload.sources.filter((source) => PRISMA_OR_ARKTYPE.test(source)).length,
    prismaSamplesAtStartup: samplesUnder(profile, (frame) => PRISMA_OR_ARKTYPE.test(sourceOf(frame, map))),
  };
}
