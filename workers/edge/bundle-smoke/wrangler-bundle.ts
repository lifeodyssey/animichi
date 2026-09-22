/** The official dry-run build includes Workers' Node compatibility plugins and supplies its own graph. */
import { URL } from "node:url";
import { process } from "../test-support/node-globals.ts";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import type { Metafile } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface WranglerBundle { readonly code: string; readonly metafile: Metafile }

/** Bound the official build so a stalled Wrangler names itself instead of consuming its caller's budget. */
const BUILD_TIMEOUT_MS = 60_000;

/** Wrangler's own last line for a `--dry-run` that built; `execFile` hands it back on the error's stdout. */
const DRY_RUN_FINISHED = "--dry-run: exiting now.";

/** What Node's `timeout` kill leaves behind: the bound's SIGTERM, and the output captured up to it. */
type KilledChildError = Error & { readonly killed: true; readonly signal: unknown; readonly stdout?: string };

/** Node's `timeout` option kills the child and says so; every other rejection is the build's own failure. */
function killedByTimeout(error: unknown): error is KilledChildError {
  if (!(error instanceof Error)) return false;
  const failure = error as { killed?: unknown; signal?: unknown };
  return failure.killed === true && failure.signal !== null && failure.signal !== undefined;
}

/**
 * Two different stalls arrive here wearing one message: a build still running when the bound elapsed, and a
 * build that had already printed its last line before its process outlived the bound. The captured stdout
 * separates them, and the refusals this was written for (#1859) were all the second — so the message names
 * the state it saw rather than sending the reader after the bundler in both cases.
 */
function timeoutDiagnostic(error: KilledChildError) {
  const bound = String(BUILD_TIMEOUT_MS / 1_000);
  if ((error.stdout ?? "").includes(DRY_RUN_FINISHED)) {
    return `Wrangler finished its dry-run build and printed "${DRY_RUN_FINISHED}", then did not exit within ${bound} seconds`;
  }
  return `Wrangler did not finish its dry-run build within ${bound} seconds`;
}

async function runWrangler(config: string, directory: string, outfile: string, metafile: string) {
  const args = ["exec", "wrangler", "deploy", "--dry-run", "--config", config, "--outdir", directory, "--metafile", metafile];
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: `${outfile}.build.log` };
  try {
    await promisify(execFile)("pnpm", args, { env, maxBuffer: 5 * 1024 * 1024, timeout: BUILD_TIMEOUT_MS });
  } catch (error) {
    if (!killedByTimeout(error)) throw error;
    throw new Error(timeoutDiagnostic(error), { cause: error });
  }
}

export async function bundleLikeWrangler(entry: string, outfile: string): Promise<WranglerBundle> {
  const directory = dirname(outfile);
  const config = `${outfile}.config.json`;
  const metafile = `${outfile}.meta.json`;
  const runtime = deployedRuntime();
  await writeFile(config, JSON.stringify({ name: "native-bundle-probe", main: entry,
    compatibility_date: runtime.compatibilityDate, compatibility_flags: runtime.compatibilityFlags }));
  await runWrangler(config, directory, outfile, metafile);
  const generated = join(directory, basename(entry).replace(/\.[cm]?ts$/, ".js"));
  const code = await readFile(generated, "utf8");
  await writeFile(outfile, code);
  return { code, metafile: JSON.parse(await readFile(metafile, "utf8")) as Metafile };
}

/** Build and execute with the exact compatibility settings declared for production. */
export function deployedRuntime(): { compatibilityDate: string; compatibilityFlags: string[] } {
  const root = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").split(/^\[/m)[0] ?? "";
  const date = /^compatibility_date\s*=\s*"([^"]+)"/m.exec(root)?.[1];
  const flags = /^compatibility_flags\s*=\s*(.+)$/m.exec(root)?.[1];
  assert.ok(date && flags, "Production declares its compatibility settings");
  return { compatibilityDate: date, compatibilityFlags: [...flags.matchAll(/"([^"]+)"/g)].map((flag) => flag[1] ?? "") };
}
