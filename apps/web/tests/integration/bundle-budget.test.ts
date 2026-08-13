import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundleBudgets, budgetKeyFor, type BundleBudgetKey } from "../../bundle-budget.config";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const assetsDir = fileURLToPath(new URL("../../.output/public/assets", import.meta.url));

interface SizedChunk {
  basename: string;
  bytes: number;
}

function buildWebApp(): void {
  execFileSync("pnpm", ["run", "build"], {
    // vitest sets NODE_ENV=test; the dev JSX transform (jsxDEV) would otherwise
    // land in the SSR bundle and crash on workerd (see build-output.test.ts).
    env: { ...process.env, NODE_ENV: "production" },
    cwd: packageRoot,
    stdio: "pipe",
    timeout: 180_000,
  });
}

function readBudgetedChunks(): SizedChunk[] {
  if (!existsSync(assetsDir)) buildWebApp();
  return readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ basename: name, bytes: statSync(join(assetsDir, name)).size }))
    .filter((chunk) => budgetKeyFor(chunk.basename) !== null);
}

function expectedKeys(): BundleBudgetKey[] {
  return Object.keys(bundleBudgets) as BundleBudgetKey[];
}

/** The budget for a budgeted chunk. Only budgeted chunks reach this
 * (readBudgetedChunks filtered them), so a null key is a defensive 0. */
function budgetFor(chunk: SizedChunk): number {
  const key = budgetKeyFor(chunk.basename);
  return key === null ? 0 : bundleBudgets[key];
}

/** Renders a per-chunk budget report for the failure/shift diagnostics. */
function renderReport(chunks: SizedChunk[]): string {
  return chunks
    .map((chunk) => {
      const bytes = String(chunk.bytes);
      const budget = String(budgetFor(chunk));
      return `${chunk.basename}: ${bytes} bytes (budget ${budget})`;
    })
    .join("\n");
}

describe("release bundle budgets", () => {
  it("emits budgeted route/component chunks in the built output", () => {
    const chunks = readBudgetedChunks();
    const emitted = new Set(chunks.map((chunk) => budgetKeyFor(chunk.basename)));
    for (const key of expectedKeys()) expect(emitted.has(key)).toBe(true);
  });

  it("keeps every budgeted chunk at or under its release budget", () => {
    const chunks = readBudgetedChunks();
    const over = chunks.filter((chunk) => chunk.bytes > budgetFor(chunk));
    const report = renderReport(chunks);
    expect(over, report).toEqual([]);
  });

  it("reports the exact bytes read (no fabricated snapshot fixtures)", () => {
    const chunks = readBudgetedChunks();
    for (const chunk of chunks.slice(0, 20)) {
      const raw = readFileSync(join(assetsDir, chunk.basename), "utf8");
      expect(Buffer.byteLength(raw)).toBe(chunk.bytes);
    }
  });
});
