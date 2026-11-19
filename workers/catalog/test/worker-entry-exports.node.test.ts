import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoWorkerTree } from "../scripts/check-worker-entry-exports";
import { wranglerMain } from "../scripts/wrangler-main";
import {
  entryPath,
  starExportViolations,
  workerEntryFailures,
  wranglerConfigPaths,
  type WorkerTree,
} from "../scripts/worker-entry-exports";

/**
 * The entry-export check's walk (`scripts/check-worker-entry-exports.ts`) over a
 * real directory: temporary trees written per case, the live repo, and the
 * catalog's own main read from its wrangler.toml.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CATALOG_CONFIG = "workers/catalog/wrangler.toml";

let root: string;

function write(relativePath: string, contents: string): void {
  const target = join(root, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

/** The catalog's main, read from its own wrangler.toml. */
function catalogMain(): string {
  const main = wranglerMain(join(REPO, CATALOG_CONFIG));
  if (main === undefined) throw new Error("catalog wrangler.toml missing main");
  return main;
}

function catalogMainPath(): string {
  return entryPath(CATALOG_CONFIG, catalogMain());
}

function catalogMainSource(): string {
  return readFileSync(join(REPO, catalogMainPath()), "utf8");
}

/** The catalog alone, as the walk sees it: its config's main and that entry's source. */
function catalogTree(): WorkerTree {
  return { mains: { [CATALOG_CONFIG]: catalogMain() }, sources: { [catalogMainPath()]: catalogMainSource() } };
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

  it("still flags the live jsonc main after a block-commented main", () => {
    write("apps/web/wrangler.jsonc", '/* "main": "src/missing.ts" */\n{ "main": "src/entry.ts" }\n');
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

  it("reports a wrangler config that declares no main", () => {
    write("workers/demo/wrangler.toml", 'name = "demo"\n');
    expect(workerEntryFailures(repoWorkerTree(root))).toEqual(["workers/demo/wrangler.toml: missing wrangler main"]);
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

describe("catalog wrangler main", () => {
  it("loads the catalog wrangler main discovered from config", () => {
    expect(catalogMainSource().length).toBeGreaterThan(0);
  });

  it("forbids export * on the catalog wrangler main discovered from config", () => {
    expect(starExportViolations(catalogTree())).toEqual([]);
  });

  it("goes red when a one-time copy of the wrangler main star-exports", () => {
    const path = catalogMainPath();
    const tree = catalogTree();
    const copy = { ...tree, sources: { ...tree.sources, [path]: `${catalogMainSource()}\nexport * from "./probe";\n` } };
    expect(starExportViolations(copy)).toContain(`${path}: export * from "./probe";`);
  });

  it("stays green on the original tree after the copy is discarded", () => {
    expect(starExportViolations(catalogTree())).toEqual([]);
  });
});
