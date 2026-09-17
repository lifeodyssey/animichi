import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #1634's contract assertion: the Atlas apply engine is gone and cannot come back quietly.
 *
 * Each deleted module carried a capability the migrator no longer has any business holding —
 * a per-file apply loop, a revision ledger, a checksum-chain parser, a SQL statement splitter
 * and the bare SQL client they shared. One reappearing file, or one import of it, would put a
 * second migration authority back beside Prisma's; this test names them so that lands as a
 * failure rather than as a review someone has to notice.
 */
const SOURCE_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const DELETED_MODULES = [
  "bundled-chain.ts", "chain.ts", "http-apply.ts", "ledger.ts", "migration.ts",
  "preflight-compatibility.ts", "preflight-ledger.ts", "requested-chain.ts",
  "selected-apply.ts", "sql-split.ts", "sql.ts", "text-modules.d.ts",
] as const;

function sourceFiles(): string[] {
  return readdirSync(SOURCE_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

describe("the Atlas apply engine is retired", () => {
  it("carries none of the deleted modules", () => {
    const present = sourceFiles().map((path) => path.slice(SOURCE_DIR.length));
    expect(DELETED_MODULES.filter((name) => present.includes(name))).toEqual([]);
  });

  it("imports none of the deleted modules", () => {
    const specifiers = DELETED_MODULES.map((name) => name.replace(/\.(d\.)?ts$/u, ""));
    const offenders = sourceFiles().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return specifiers.filter((specifier) => source.includes(`"./${specifier}"`)).map((specifier) => `${path}:${specifier}`);
    });
    expect(offenders).toEqual([]);
  });

  it("imports no SQL or checksum text module", () => {
    const offenders = sourceFiles().filter((path) => /\.(sql|sum)"/u.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
