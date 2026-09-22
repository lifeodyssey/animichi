/**
 * Boots `MigratorApplyLock` in a real workerd runtime with a controllable apply (#1868).
 *
 * The class is bundled from `src/` untouched; only the module it imports the apply from is
 * redirected, at link time, to `recorded-apply.ts`. That is the one substitution — the Durable
 * Object, its RPC, the input gate and the 30-second `blockConcurrencyWhile` cap are all the
 * platform's own. `selected-workerd.ts` cannot serve here: its bundle answers
 * `409 stale_prisma_bundle` before the request ever reaches the object.
 */
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { build, type Plugin } from "esbuild";
import { Miniflare, Log, LogLevel } from "miniflare";
import type { ApplyRunReport } from "./apply-lock-entry";

const ENTRY = fileURLToPath(new URL("./apply-lock-entry.ts", import.meta.url).href);
const RECORDED_APPLY = fileURLToPath(new URL("./recorded-apply.ts", import.meta.url).href);

/** Swaps the collaborator, never the class: `src/apply-lock.ts` enters the bundle as written. */
function applyRecordedInsteadOfPrisma(): Plugin {
  return {
    name: "recorded-apply",
    setup(bundler) {
      bundler.onResolve({ filter: /^\.\/selected-migration$/ }, () => ({ path: RECORDED_APPLY }));
    },
  };
}

let bundle: Promise<string> | undefined;

function applyLockBundle(): Promise<string> {
  return build({
    bundle: true, write: false, format: "esm", platform: "browser", entryPoints: [ENTRY],
    conditions: ["workerd", "worker"], external: ["cloudflare:workers", "node:*", ...builtinModules],
    plugins: [applyRecordedInsteadOfPrisma()],
  }).then((built) => built.outputFiles[0]?.text ?? "");
}

export async function applyLockRuntime() {
  bundle ??= applyLockBundle();
  const runtime = new Miniflare({
    modules: [{ type: "ESModule", path: "/bundle/apply-lock-worker.js", contents: await bundle }],
    modulesRoot: "/bundle", compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { MIGRATOR_APPLY_LOCK: "MigratorApplyLock" },
    log: new Log(LogLevel.ERROR), cf: false,
  });
  const applies = async (...specs: readonly string[]): Promise<ApplyRunReport> => {
    const query = specs.map((spec) => `apply=${encodeURIComponent(spec)}`).join("&");
    const response = await runtime.dispatchFetch(`https://apply-lock.test/?${query}`);
    return await response.json() as ApplyRunReport;
  };
  return { runtime, applies };
}
