import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoWorkerTree } from "../scripts/check-worker-entry-exports";
import { starExportViolations, workerEntryFailures, wranglerConfigPaths } from "../scripts/worker-entry-exports";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");

let root: string;

function write(relativePath: string, contents: string): void {
  const target = join(root, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "worker-entry-exports-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("repoWorkerTree", () => {
  it("flags export * on a workers/* wrangler main", () => {
    write("workers/demo/wrangler.toml", 'main = "src/index.ts"\n');
    write("workers/demo/src/index.ts", 'export * from "./mod";\n');
    expect(starExportViolations(repoWorkerTree(root))).toEqual([
      'workers/demo/src/index.ts: export * from "./mod";',
    ]);
  });

  it("flags export * on an apps/* wrangler.jsonc main", () => {
    write("apps/web/wrangler.jsonc", '{ "main": "src/entry.ts" }\n');
    write("apps/web/src/entry.ts", 'export * from "./handlers";\n');
    expect(starExportViolations(repoWorkerTree(root))).toEqual([
      'apps/web/src/entry.ts: export * from "./handlers";',
    ]);
  });

  it("passes when wrangler mains use explicit exports", () => {
    write("workers/demo/wrangler.toml", 'main = "src/index.ts"\n');
    write("workers/demo/src/index.ts", "export default {};\n");
    expect(starExportViolations(repoWorkerTree(root))).toEqual([]);
  });

  it("skips a wrangler main whose file is not on disk", () => {
    write("workers/demo/wrangler.toml", 'main = "src/index.ts"\n');
    expect(starExportViolations(repoWorkerTree(root))).toEqual([]);
  });

  it("flags export * when wrangler main starts with ./", () => {
    write("workers/demo/wrangler.toml", 'main = "./src/index.ts"\n');
    write("workers/demo/src/index.ts", 'export * from "./mod";\n');
    expect(starExportViolations(repoWorkerTree(root))).toEqual([
      'workers/demo/src/index.ts: export * from "./mod";',
    ]);
  });

  it("fails closed when workers/ and apps/ have no wrangler files", () => {
    expect(workerEntryFailures(repoWorkerTree(root))).toEqual([
      "no wrangler configs under workers/* or apps/*",
    ]);
  });
});

describe("mutation probe (one-time copy)", () => {
  it("goes red after injecting export *, then green after restore", () => {
    write("workers/demo/wrangler.toml", 'main = "src/index.ts"\n');
    write("workers/demo/src/index.ts", "export default {};\n");
    expect(starExportViolations(repoWorkerTree(root))).toEqual([]);
    write("workers/demo/src/index.ts", 'export default {};\nexport * from "./probe";\n');
    expect(starExportViolations(repoWorkerTree(root))).toEqual([
      'workers/demo/src/index.ts: export * from "./probe";',
    ]);
    write("workers/demo/src/index.ts", "export default {};\n");
    expect(starExportViolations(repoWorkerTree(root))).toEqual([]);
  });
});

describe("live repo worker entries", () => {
  it("discovers wrangler configs under workers/* and apps/*", () => {
    expect(wranglerConfigPaths(repoWorkerTree(REPO)).length).toBeGreaterThan(0);
  });

  it("forbids export * on every wrangler main under workers/* and apps/*", () => {
    expect(workerEntryFailures(repoWorkerTree(REPO))).toEqual([]);
  });
});
