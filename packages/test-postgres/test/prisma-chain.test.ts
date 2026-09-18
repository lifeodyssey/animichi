/**
 * What the fixture applies, and what it must never reach for again (#1625).
 *
 * The chain moved into the package that owns the contract (#1626), so this
 * package no longer has a chain of its own to point at: it resolves the contract
 * package's config and lets the CLI apply whatever that config names. A rename
 * on either side would otherwise surface as a failed Docker boot in whichever
 * lane happened to run first, far from the line that drifted — so the resolved
 * package is pinned here against the filesystem, with no container.
 *
 * The Atlas half is the deletion this card is: the shared fixture used to
 * `execFile` the Atlas CLI against `migrations/neon`. The behavioral proof that
 * the binary is gone is the integration falsifier (the fixture still builds a
 * database with `ATLAS_BIN` naming a file that does not exist); this is the
 * static half, over the source that could reintroduce the dependency.
 *
 * test-type: unit (reads checked-in files; no network, no clock, no container).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CHAIN_PACKAGE } from "../src/prisma-chain.ts";
import { SERVICE_ROLES } from "../src/service-roles.ts";

const PACKAGE_ROOT = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, PACKAGE_ROOT), "utf8");

/** Every `.ts` under `src/`, so a new module is covered the moment it lands. */
function sourceFiles(): string[] {
  return readdirSync(new URL("src/", PACKAGE_ROOT))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => `src/${file}`);
}

/** The names a reintroduced Atlas dependency has to spell out to work: the
 * binary override, the no-notifier variable, the apply helper, the old chain. */
const ATLAS_SHAPED = ["ATLAS_BIN", "ATLAS_NO_UPDATE_NOTIFIER", "applyAtlasChain", "migrations/neon"];

void test("no source file can reach the Atlas binary or its chain", () => {
  for (const file of sourceFiles()) {
    const source = read(file);
    for (const name of ATLAS_SHAPED) {
      assert.ok(!source.includes(name), `${file} still names ${name}`);
    }
  }
});

void test("the package manifest declares no Atlas dependency or script", () => {
  assert.ok(!/atlas/i.test(read("package.json")));
});

void test("the fixture resolves the chain to the package that owns the contract", () => {
  assert.ok(statSync(join(CHAIN_PACKAGE, "prisma.config.ts")).isFile());
  assert.ok(statSync(join(CHAIN_PACKAGE, "src/contract.prisma")).isFile());
  const nodes = readdirSync(join(CHAIN_PACKAGE, "migrations/app"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  assert.ok(nodes.length > 0, "migrations/app holds no migration directory");
});

void test("the apply is the CLI's own db migrate, not a re-implementation", () => {
  const chain = read("src/prisma-chain.ts");
  assert.match(chain, /"db", "migrate", "--db", dsn, "--json"/);
  assert.ok(!/db-fresh|clean-database|catalog-tables/.test(chain), "the chain is not a directory to walk");
});

void test("the apply spawn blocks coverage propagation into the CLI child", () => {
  // Node copies NODE_V8_COVERAGE over the spawn env unless the key is present
  // there (the mechanics #1753 blocked for this package's sibling CLI calls).
  // An absent key lets a coverage runner's directory reach the CLI child, which
  // loads the chain's geography sources under a different transpile and dumps
  // all-zero, offset-shifted ranges into the runner's merge — readdir order
  // then decides whether those zeros land last and collapse the line table
  // (prisma-geography flipped between 81.14 % and 99.50 % per run, #1740).
  assert.match(read("src/prisma-chain.ts"), /NODE_V8_COVERAGE: ""/);
});

void test("the five service roles are the data plane's, spelled once", () => {
  assert.deepEqual(SERVICE_ROLES, ["agent_svc", "catalog_svc", "jobs_svc", "readonly", "users_svc"]);
});
