/**
 * How wrangler bundles this Worker — one copy, read by every gate in this
 * directory (#1246, #1285).
 *
 * The options below are copied from wrangler's own Worker bundler
 * (`node_modules/wrangler/wrangler-dist/cli.js`, `bundleWorker`): esm/es2024,
 * `import-source` support, and the `workerd, worker, browser` export
 * conditions. Node builtins stay external because the deployed Worker sets
 * `nodejs_compat` and workerd supplies them. A gate that bundled differently
 * from the deploy path would be measuring the wrong artifact — which is the
 * whole reason both gates here share one declaration instead of each carrying
 * a settings block that can drift from the other.
 */
import { build, type BuildOptions, type Metafile } from "esbuild";
import { readFileSync } from "node:fs";

const WRANGLER_BUNDLE_OPTIONS: BuildOptions = {
  bundle: true,
  format: "esm",
  target: "es2024",
  supported: { "import-source": true },
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*", "cloudflare:*"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
};

/** A built artifact: the code workerd would run and the graph it came from. */
export interface WranglerBundle {
  readonly code: string;
  readonly metafile: Metafile;
}

/** Build `entry` to `outfile` exactly as the deploy path would. */
export async function bundleLikeWrangler(entry: string, outfile: string): Promise<WranglerBundle> {
  const result = await build({ ...WRANGLER_BUNDLE_OPTIONS, entryPoints: [entry], outfile, metafile: true });
  return { code: readFileSync(outfile, "utf8"), metafile: result.metafile };
}
