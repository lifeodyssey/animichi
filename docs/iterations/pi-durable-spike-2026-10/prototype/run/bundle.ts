/**
 * Build one worker entry the way the edge ships: the official Wrangler `deploy --dry-run`, at the compatibility
 * date and flags read from `workers/edge/wrangler.toml` when the run starts (the method of the edge's bundle-smoke
 * lane, `workers/edge/bundle-smoke/wrangler-bundle.ts`). Wrangler is invoked from this directory's own
 * `node_modules/.bin`, never through `pnpm exec`, so nothing resolves up to the repository's workspace.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const PROTOTYPE = fileURLToPath(new URL("..", import.meta.url));
export const REPOSITORY = fileURLToPath(new URL("../../../../..", import.meta.url));
const EDGE_CONFIG = join(REPOSITORY, "workers", "edge", "wrangler.toml");
const WRANGLER = join(PROTOTYPE, "node_modules", ".bin", "wrangler");

export interface Runtime { readonly compatibilityDate: string; readonly compatibilityFlags: string[] }

export interface Metafile {
  readonly inputs: Record<string, { readonly bytes: number; readonly imports: { readonly path: string; readonly kind: string; readonly external?: boolean; readonly original?: string }[] }>;
  readonly outputs: Record<string, { readonly bytes: number; readonly exports: string[] }>;
}

export interface Bundle { readonly path: string; readonly code: string; readonly metafile: Metafile; readonly runtime: Runtime }

/** The edge's top-level compatibility settings, before its first `[section]`. */
export function edgeRuntime(): Runtime {
  const top = readFileSync(EDGE_CONFIG, "utf8").split(/^\[/m)[0] ?? "";
  const date = /^compatibility_date\s*=\s*"([^"]+)"/m.exec(top)?.[1];
  const flags = /^compatibility_flags\s*=\s*(.+)$/m.exec(top)?.[1];
  if (!date || !flags) throw new Error("workers/edge/wrangler.toml declares no compatibility settings");
  return { compatibilityDate: date, compatibilityFlags: [...flags.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "") };
}

export async function bundle(entry: string, outDir: string, runtime: Runtime = edgeRuntime()): Promise<Bundle> {
  const config = join(outDir, "wrangler.json");
  const metafile = join(outDir, "meta.json");
  writeFileSync(config, JSON.stringify({ name: "pi-durable-spike", main: join(PROTOTYPE, entry),
    compatibility_date: runtime.compatibilityDate, compatibility_flags: runtime.compatibilityFlags }));
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(outDir, "wrangler.log") };
  const args = ["deploy", "--dry-run", "--config", config, "--outdir", outDir, "--metafile", metafile];
  await promisify(execFile)(WRANGLER, args, { env, cwd: PROTOTYPE, maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  const path = join(outDir, basename(entry).replace(/\.ts$/, ".js"));
  return { path, code: await readFile(path, "utf8"), metafile: JSON.parse(await readFile(metafile, "utf8")) as Metafile, runtime };
}
