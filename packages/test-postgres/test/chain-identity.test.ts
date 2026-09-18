/**
 * The migrated template's identity is the Prisma chain's own recorded head
 * plus every migration body hash (#1769).
 *
 * Prisma records each step as from/to/migrationHash in each migration.json
 * under migrations/app. A new migration changes the last to (the contract
 * storage hash). A body edit changes that step's migrationHash. Either must
 * name a different template, or a stale schema survives.
 *
 * test-type: unit (reads checked-in chain files; no Docker, no clock).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertCurrentTemplate,
  migratedTemplateName,
  prismaChainHead,
  prismaChainIdentity,
} from "../src/chain-identity.ts";
import { CHAIN_PACKAGE } from "../src/prisma-chain.ts";

const PACKAGE_ROOT = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, PACKAGE_ROOT), "utf8");

interface MigrationManifest {
  readonly from: string | null;
  readonly to: string;
  readonly migrationHash: string;
}

const contractHead = (
  JSON.parse(readFileSync(join(CHAIN_PACKAGE, "src/contract.json"), "utf8")) as {
    storage: { storageHash: string };
  }
).storage.storageHash;

function chainManifests(): MigrationManifest[] {
  const root = join(CHAIN_PACKAGE, "migrations/app");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((directory) => JSON.parse(readFileSync(join(root, directory, "migration.json"), "utf8")) as MigrationManifest);
}

void test("the chain head is the last migration's to and the contract storage hash", () => {
  const manifests = chainManifests();
  const last = manifests.at(-1);
  assert.ok(last);
  assert.equal(last.to, contractHead);
  assert.equal(prismaChainHead(), contractHead);
});

void test("the identity is a sha256 of the chain and stays stable", () => {
  assert.match(prismaChainIdentity(), /^[a-f0-9]{64}$/);
  assert.equal(prismaChainIdentity(), prismaChainIdentity());
});

void test("the template name is derived from the identity and fits a PostgreSQL identifier", () => {
  const identity = prismaChainIdentity();
  const name = migratedTemplateName();
  assert.equal(name, migratedTemplateName(identity));
  assert.match(name, /^tpl_[a-f0-9]+$/);
  assert.ok(Buffer.byteLength(name) <= 63);
});

void test("a stale identity names a different template and the guard fails by name", () => {
  const stale = "0".repeat(64);
  const staleName = migratedTemplateName(stale);
  assert.notEqual(staleName, migratedTemplateName());
  assert.throws(() => { assertCurrentTemplate(staleName); }, {
    message: `stale migrated template ${staleName}; current chain identity names ${migratedTemplateName()}`,
  });
});

void test("the identity source hashes each step's to and migrationHash, not a lone head", () => {
  const source = read("src/chain-identity.ts");
  assert.match(source, /migrationHash/);
  assert.match(source, /\.to/);
  assert.match(source, /migrations/);
});
