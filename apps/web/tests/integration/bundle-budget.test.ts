import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundleBudgets, budgetKeyFor, isOverBudget, landingPreloads, routeBudgets, type BundleBudgetKey } from "../../bundle-budget.config";

const outputDir = fileURLToPath(new URL("../../.output", import.meta.url));
const assetsDir = join(outputDir, "public/assets");
const manifestDir = join(outputDir, "server/chunks/_");
const MANIFEST_PREFIX = "_tanstack-start-manifest_v-";

interface SizedChunk {
  basename: string;
  bytes: number;
}

/** Every emitted client chunk, sized. A missing asset directory is a failed build, not an empty budget. */
function readJavascriptChunks(): SizedChunk[] {
  return readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ basename: name, bytes: statSync(join(assetsDir, name)).size }));
}

/** The chunks a chunk-family budget names, by un-hashed basename prefix. */
function readBudgetedChunks(): SizedChunk[] {
  return readJavascriptChunks().filter((chunk) => budgetKeyFor(chunk.basename) !== null);
}

function sized(basename: string): SizedChunk {
  const path = join(assetsDir, basename);
  if (!existsSync(path)) throw new Error(`The built output does not contain ${basename}`);
  return { basename, bytes: statSync(path).size };
}

/** The manifest of the build under test: a build leaves older manifests behind, so the one whose
 * preloads are all present in the assets under test is the one that describes it. */
function namesThisBuild(preloads: string[]): boolean {
  return preloads.length > 0 && preloads.every((basename) => existsSync(join(assetsDir, basename)));
}

/** The emitted TanStack Start manifest: the per-route preload graph the document is served with. */
function readStartManifest(): string {
  const names = readdirSync(manifestDir).filter((name) => name.startsWith(MANIFEST_PREFIX) && name.endsWith(".mjs"));
  const current = names.filter((name) => namesThisBuild(landingPreloads(readFileSync(join(manifestDir, name), "utf8"))));
  expect(current, `one of [${names.join(", ")}] names this build's chunks`).toHaveLength(1);
  return readFileSync(join(manifestDir, current[0] ?? ""), "utf8");
}

/** The landing route's first-load set: its entry chunk plus every chunk preloaded for the root route. */
function landingChunks(): SizedChunk[] {
  return landingPreloads(readStartManifest()).map(sized);
}

function totalBytes(chunks: SizedChunk[]): number {
  return chunks.reduce((total, chunk) => total + chunk.bytes, 0);
}

function renderChunks(chunks: SizedChunk[]): string {
  return chunks.map((chunk) => `${chunk.basename}: ${String(chunk.bytes)} bytes`).join("\n");
}

function expectedKeys(): BundleBudgetKey[] {
  return Object.keys(bundleBudgets) as BundleBudgetKey[];
}

describe("release bundle budgets", () => {
  it("emits budgeted route/component chunks in the built output", () => {
    const emitted = new Set(readBudgetedChunks().map((chunk) => budgetKeyFor(chunk.basename)));
    for (const key of expectedKeys()) expect(emitted.has(key)).toBe(true);
  });

  it("resolves the landing route's first-load graph from the built manifest", () => {
    const chunks = landingChunks();
    // More than the entry chunk: a manifest that named one file would silently shrink the budget's subject.
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.bytes > 0)).toBe(true);
  });

  it("keeps every budgeted chunk at or under its release budget", () => {
    const chunks = readBudgetedChunks();
    const over = chunks.filter((chunk) => isOverBudget(chunk.basename, chunk.bytes));
    expect(over, renderChunks(chunks)).toEqual([]);
  });

  it("keeps the landing route's first load at or under its release budget", () => {
    const chunks = landingChunks();
    const report = `${renderChunks(chunks)}\nlanding first load: ${String(totalBytes(chunks))} bytes (budget ${String(routeBudgets.landing)})`;
    expect(totalBytes(chunks), report).toBeLessThanOrEqual(routeBudgets.landing);
  });

  it("reports the exact bytes read (no fabricated snapshot fixtures)", () => {
    for (const chunk of [...readBudgetedChunks(), ...landingChunks()].slice(0, 20)) {
      const raw = readFileSync(join(assetsDir, chunk.basename), "utf8");
      expect(Buffer.byteLength(raw)).toBe(chunk.bytes);
    }
  });
});
