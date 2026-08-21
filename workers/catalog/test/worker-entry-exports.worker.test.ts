import { describe, expect, it } from "vitest";
import wranglerToml from "../wrangler.toml?raw";
import {
  discoveryFailures,
  entryPath,
  starExportViolations,
  wranglerConfigPaths,
  wranglerMain,
  type TextTree,
} from "../scripts/worker-entry-exports";

const catalogSrc = import.meta.glob<string>("../src/**/*.ts", {
  query: "?raw",
  eager: true,
  import: "default",
});

function catalogTree(): TextTree {
  const tree: Record<string, string> = { "workers/catalog/wrangler.toml": wranglerToml };
  for (const [key, text] of Object.entries(catalogSrc)) {
    tree[`workers/catalog/${key.replace(/^\.\.\//, "")}`] = text;
  }
  return tree;
}

function catalogMainPath(): string {
  const main = wranglerMain(wranglerToml);
  if (main === undefined) throw new Error("catalog wrangler.toml missing main");
  return entryPath("workers/catalog/wrangler.toml", main);
}

function catalogMainSource(): string {
  const source = catalogTree()[catalogMainPath()];
  if (source === undefined || source.length === 0) throw new Error("catalog wrangler main not in tree");
  return source;
}

describe("wrangler main discovery", () => {
  it("reads main from toml and jsonc without hard-coding the entry filename", () => {
    expect(wranglerMain('main = "src/entry.ts"\n')).toBe("src/entry.ts");
    expect(wranglerMain('{ "main": ".output/server/index.mjs" }\n')).toBe(
      ".output/server/index.mjs",
    );
  });

  it("does not treat a JSONC whole-line block comment as wrangler main", () => {
    expect(
      wranglerMain('/* "main": "commented.ts" */\n{ "main": "src/entry.ts" }\n'),
    ).toBe("src/entry.ts");
  });

  it("fails closed when the only jsonc main key is inside a block comment", () => {
    expect(wranglerMain('/* "main": "commented.ts" */\n{ "name": "x" }\n')).toBeUndefined();
  });

  it("still flags the live jsonc main after a block-commented main", () => {
    expect(
      starExportViolations({
        "apps/web/wrangler.jsonc": '/* "main": "src/missing.ts" */\n{ "main": "src/entry.ts" }\n',
        "apps/web/src/entry.ts": 'export * from "./handlers";\n',
      }),
    ).toEqual(['apps/web/src/entry.ts: export * from "./handlers";']);
  });

  it("discovers configs only under workers/* and apps/*", () => {
    const paths = wranglerConfigPaths({
      "workers/catalog/wrangler.toml": 'main = "src/index.ts"',
      "apps/web/wrangler.jsonc": '{ "main": "src/entry.ts" }',
      "packages/contract/wrangler.toml": 'main = "src/index.ts"',
    });
    expect(paths.sort()).toEqual([
      "apps/web/wrangler.jsonc",
      "workers/catalog/wrangler.toml",
    ]);
  });

  it("fails closed when a walk finds no wrangler configs", () => {
    expect(discoveryFailures({})).toEqual(["no wrangler configs under workers/* or apps/*"]);
  });
});

describe("worker entry must not star-export", () => {
  it("flags export * on a workers/* wrangler main", () => {
    expect(
      starExportViolations({
        "workers/x/wrangler.toml": 'main = "src/index.ts"',
        "workers/x/src/index.ts": 'export * from "./mod";\n',
      }),
    ).toEqual(['workers/x/src/index.ts: export * from "./mod";']);
  });

  it("flags export * when wrangler main is a dotted relative path", () => {
    expect(
      starExportViolations({
        "workers/x/wrangler.toml": 'main = "./src/index.ts"',
        "workers/x/src/index.ts": 'export * from "./mod";\n',
      }),
    ).toEqual(['workers/x/src/index.ts: export * from "./mod";']);
  });

  it("flags export * on an apps/* wrangler main", () => {
    expect(
      starExportViolations({
        "apps/web/wrangler.jsonc": '{ "main": "src/entry.ts" }',
        "apps/web/src/entry.ts": 'export * from "./handlers";\n',
      }),
    ).toEqual(['apps/web/src/entry.ts: export * from "./handlers";']);
  });

  it("flags a wrangler config with no main key", () => {
    expect(starExportViolations({ "workers/x/wrangler.toml": 'name = "x"\n' })).toEqual([
      "workers/x/wrangler.toml: missing wrangler main",
    ]);
  });

  it("allows explicit named exports on a wrangler main", () => {
    expect(
      starExportViolations({
        "workers/x/wrangler.toml": 'main = "src/index.ts"',
        "workers/x/src/index.ts": "export class IngestEntrypoint {}\nexport default {};\n",
      }),
    ).toEqual([]);
  });

  it("ignores export * inside comments", () => {
    expect(
      starExportViolations({
        "workers/x/wrangler.toml": 'main = "src/index.ts"',
        "workers/x/src/index.ts": '// export * from "./mod";\nexport default {};\n',
      }),
    ).toEqual([]);
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
    const copy = { ...catalogTree(), [path]: `${catalogMainSource()}\nexport * from "./probe";\n` };
    expect(starExportViolations(copy)).toContain(`${path}: export * from "./probe";`);
  });

  it("stays green on the original tree after the copy is discarded", () => {
    expect(starExportViolations(catalogTree())).toEqual([]);
  });
});
