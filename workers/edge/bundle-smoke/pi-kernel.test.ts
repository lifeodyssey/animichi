/**
 * W0-S3 bundler smoke gate (issue #1246): build the pi kernel entrypoint the
 * way wrangler builds a Worker, then EXECUTE that artifact in workerd and drive
 * one real request through it.
 *
 * Build-only gates cannot see the class of bug this guards
 * (`docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md` — the esbuild
 * `.lazy` chunk-init-order defect): the bundle compiles clean and dies on first
 * call. pi's own upstream smoke builds without executing, which is exactly how
 * the bug survived. So does every unit test here — node:test evaluates
 * unbundled source modules in correct ESM order.
 *
 * Mutation proof (recorded on the card): rewrite `pi-kernel.worker.ts`'s
 * `@earendil-works/pi-ai/api/openai-completions` import to the `.lazy` subpath
 * and this test fails with `TypeError: ModelsImpl is not a constructor` from
 * inside workerd.
 *
 * test-type: unit (hermetic — no network, no clock; the provider transport is
 * a double inside the Worker).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { build, type BuildOptions } from "esbuild";
import { Miniflare } from "miniflare";

const ENTRY = fileURLToPath(new URL("./pi-kernel.worker.ts", import.meta.url));
const WRANGLER_TOML = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
const OUT_DIR = mkdtempSync(join(tmpdir(), "edge-bundle-smoke-"));
const BUNDLE = join(OUT_DIR, "pi-kernel.js");

after(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

/**
 * The single value of `key` in the root (unscoped) wrangler.toml table.
 * Sliced at the first section header so an `[env.*]` override of the same key
 * can never answer instead — the same hand-rolled read `wrangler-toml.test.ts`
 * already uses, for the same reason: these guards must not need a TOML parser.
 */
function rootConfigValue(key: string): string {
  const toml = readFileSync(WRANGLER_TOML, "utf8");
  const rootTable = toml.split(/^\[/m)[0] ?? "";
  const match = new RegExp(`^${key}\\s*=\\s*(.+)$`, "m").exec(rootTable);
  assert.ok(match?.[1], `wrangler.toml root table must declare ${key}`);
  return match[1].trim();
}

/** Compatibility settings the deployed edge Worker runs on, read from its config. */
function deployedRuntime(): { compatibilityDate: string; compatibilityFlags: string[] } {
  const date = rootConfigValue("compatibility_date").replaceAll('"', "");
  const flags = rootConfigValue("compatibility_flags");
  return {
    compatibilityDate: date,
    compatibilityFlags: [...flags.matchAll(/"([^"]+)"/g)].map((flag) => flag[1] ?? ""),
  };
}

/**
 * esbuild options copied from wrangler's own Worker bundler
 * (`node_modules/wrangler/wrangler-dist/cli.js`, `bundleWorker`): esm/es2024,
 * `import-source` support, and the `workerd, worker, browser` export
 * conditions. Node builtins stay external because the deployed Worker sets
 * `nodejs_compat` and workerd supplies them. A gate that bundled differently
 * from the deploy path would be measuring the wrong artifact.
 */
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

async function bundleSmokeWorker(): Promise<void> {
  await build({ entryPoints: [ENTRY], outfile: BUNDLE, ...WRANGLER_BUNDLE_OPTIONS });
}

/**
 * The module list is explicit, as a deploy upload is: pi's auth context carries
 * a bundler-opaque `import(specifier)` that Miniflare's automatic dependency
 * walk refuses to resolve even though nothing calls it here.
 */
function bootedArtifact(): Miniflare {
  return new Miniflare({
    modules: [{ type: "ESModule", path: BUNDLE }],
    modulesRoot: OUT_DIR,
    ...deployedRuntime(),
  });
}

async function smokeReport(): Promise<unknown> {
  const worker = bootedArtifact();
  try {
    const response = await worker.dispatchFetch("http://bundle-smoke.local/");
    const body = await response.text();
    // The chunk-init failure surfaces as a 500 whose body names the dead
    // symbol, so the body goes in the message rather than a bare status diff.
    assert.equal(response.status, 200, `bundled Worker did not serve the turn: ${body}`);
    return JSON.parse(body);
  } finally {
    await worker.dispose();
  }
}

void test("the bundled pi kernel artifact runs a full turn inside workerd", async () => {
  await bundleSmokeWorker();
  assert.deepEqual(await smokeReport(), {
    events: ["start", "text_start", "text_delta", "text_end", "done"],
    text: "pong",
    stopReason: "stop",
  });
});
