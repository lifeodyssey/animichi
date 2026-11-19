import { describe, expect, it } from "vitest";
import { discoveryFailures, starExportViolations, wranglerConfigPaths } from "../scripts/worker-entry-exports";

/**
 * The entry-export check (`scripts/worker-entry-exports.ts`) on worker trees
 * written inline: which wrangler configs it discovers, and the `export *` scan of
 * each config's main. Reading each config's main from its file is
 * `wrangler-main.node.test.ts`; the walk over a real directory, the live repo and
 * the catalog's own main included, is `worker-entry-exports.node.test.ts`.
 */

describe("wrangler main discovery", () => {
  it("discovers configs only under workers/* and apps/*", () => {
    const paths = wranglerConfigPaths({
      mains: {
        "workers/catalog/wrangler.toml": "src/index.ts",
        "apps/web/wrangler.jsonc": "src/entry.ts",
        "packages/contract/wrangler.toml": "src/index.ts",
      },
      sources: {},
    });
    expect(paths.sort()).toEqual([
      "apps/web/wrangler.jsonc",
      "workers/catalog/wrangler.toml",
    ]);
  });

  it("fails closed when a walk finds no wrangler configs", () => {
    expect(discoveryFailures({ mains: {}, sources: {} })).toEqual(["no wrangler configs under workers/* or apps/*"]);
  });
});

describe("worker entry must not star-export", () => {
  it("flags export * on a workers/* wrangler main", () => {
    expect(
      starExportViolations({
        mains: { "workers/x/wrangler.toml": "src/index.ts" },
        sources: { "workers/x/src/index.ts": 'export * from "./mod";\n' },
      }),
    ).toEqual(['workers/x/src/index.ts: export * from "./mod";']);
  });

  it("flags export * when wrangler main is a dotted relative path", () => {
    expect(
      starExportViolations({
        mains: { "workers/x/wrangler.toml": "./src/index.ts" },
        sources: { "workers/x/src/index.ts": 'export * from "./mod";\n' },
      }),
    ).toEqual(['workers/x/src/index.ts: export * from "./mod";']);
  });

  it("flags export * on an apps/* wrangler main", () => {
    expect(
      starExportViolations({
        mains: { "apps/web/wrangler.jsonc": "src/entry.ts" },
        sources: { "apps/web/src/entry.ts": 'export * from "./handlers";\n' },
      }),
    ).toEqual(['apps/web/src/entry.ts: export * from "./handlers";']);
  });

  it("allows explicit named exports on a wrangler main", () => {
    expect(
      starExportViolations({
        mains: { "workers/x/wrangler.toml": "src/index.ts" },
        sources: { "workers/x/src/index.ts": "export class IngestEntrypoint {}\nexport default {};\n" },
      }),
    ).toEqual([]);
  });

  it("ignores export * inside comments", () => {
    expect(
      starExportViolations({
        mains: { "workers/x/wrangler.toml": "src/index.ts" },
        sources: { "workers/x/src/index.ts": '// export * from "./mod";\nexport default {};\n' },
      }),
    ).toEqual([]);
  });
});

describe("a wrangler main the check cannot follow", () => {
  it("flags a wrangler config with no main key", () => {
    expect(starExportViolations({ mains: { "workers/x/wrangler.toml": undefined }, sources: {} })).toEqual([
      "workers/x/wrangler.toml: missing wrangler main",
    ]);
  });

  it("flags a wrangler main that is not a string", () => {
    expect(starExportViolations({ mains: { "workers/x/wrangler.toml": 42 }, sources: {} })).toEqual([
      "workers/x/wrangler.toml: wrangler main is not a string",
    ]);
  });
});
