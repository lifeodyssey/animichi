/**
 * The sealed release's startup as Wrangler profiles it: `wrangler check startup` over the release
 * `sealedRelease()` built, with the config CD publishes to staging, and each sample attributed to its
 * source through the bundle's own source map.
 *
 * Wrangler profiles the evaluation of the upload's global scope, but the profile is no evidence of a
 * successful start: a global scope that throws can read as an empty, fast start. A count from this
 * profile therefore stands only beside a boot of the same release.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire, SourceMap, type SourceMapPayload } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { process } from "../test-support/node-globals.ts";
import { sealedRelease } from "./sealed-release.ts";

/** Wrangler's CLI itself, not its launcher: killing the launcher would leave the CLI running. */
const WRANGLER_CLI = createRequire(import.meta.url).resolve("wrangler");

/** The bound on one check, packaging and Miniflare included: the same 60 s the release build gives
 * one Wrangler run (`WRANGLER_BUILD_TIMEOUT_MS`). */
const CHECK_STARTUP_BOUND_MS = 60_000;

/** Nothing leaves the machine. */
const OFFLINE = {
  // Miniflare, which Wrangler profiles the Worker in, would fetch Cloudflare's `Request.cf` object.
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
  WRANGLER_SEND_METRICS: "false",
  // The banner's update check asks the npm registry for Wrangler's latest version.
  WRANGLER_HIDE_BANNER: "true",
  // No debug log file in the home directory.
  WRANGLER_WRITE_LOGS: "false",
};

/** The upload's entry module, as the profile's frames name it. */
const ENTRY = "/entry.js";

/**
 * What loads on the first use of a native client, and so must not run at startup: ArkType, which
 * Prisma's runtime and its contract validation build their schemas with, and the repository's
 * geography pack, which the runtime requires. pnpm's store directories included. Prisma's other
 * frames are not counted: `@animichi/pi-session-neon` imports `param` from Prisma's expression
 * builder statically, so that builder evaluates at startup, and it builds no schema.
 */
const FIRST_USE_SOURCE = /\/node_modules\/(?:\.pnpm\/)?(?:@ark[+/]|arktype[@/])|\/packages\/prisma-geography\//;

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

/** How many samples had a frame `isMarked` accepts on the stack: the sampled frame or one of its callers. */
function samplesUnder(profile: CpuProfile, isMarked: (frame: CallFrame) => boolean): number {
  const marked = new Set(profile.nodes.filter((node) => isMarked(node.callFrame)).map((node) => node.id));
  const callerOf = new Map(profile.nodes.flatMap((node) => (node.children ?? []).map((child) => [child, node.id] as const)));
  const under = (id: number | undefined): boolean => id !== undefined && (marked.has(id) || under(callerOf.get(id)));
  return profile.samples.filter((id) => under(id)).length;
}

export interface SealedStartup {
  /** ArkType and geography-pack sources the bundle carries: what the profile could have sampled. */
  readonly firstUseSourcesInBundle: number;
  /** Samples holding any frame the map attributes to a source: the attribution reads this profile. */
  readonly attributedSamples: number;
  /** Samples taken while ArkType or geography-pack code was on the stack. */
  readonly firstUseSamplesAtStartup: number;
}

export async function profileSealedStartup(): Promise<SealedStartup> {
  const release = await sealedRelease();
  const profile = await startupProfile(release);
  const map = new SourceMap(JSON.parse(await readFile(join(release, "bundle", "entry.js.map"), "utf8")) as SourceMapPayload);
  return {
    firstUseSourcesInBundle: map.payload.sources.filter((source) => FIRST_USE_SOURCE.test(source)).length,
    attributedSamples: samplesUnder(profile, (frame) => sourceOf(frame, map) !== ""),
    firstUseSamplesAtStartup: samplesUnder(profile, (frame) => FIRST_USE_SOURCE.test(sourceOf(frame, map))),
  };
}
