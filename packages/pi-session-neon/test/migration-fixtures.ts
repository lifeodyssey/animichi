import { cp, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import contractJson from "../src/contract.json" with { type: "json" };
import { packageRoot, prisma } from "./prisma-migration.ts";

const packageModules = fileURLToPath(new URL("../node_modules/", import.meta.url));

/** The copy lives outside the workspace, so it links this package's own `node_modules`: every
 * dependency it declares — the Prisma CLI and `.bin`, and `@animichi/prisma-geography`, which
 * `prisma.config.ts` imports — and nothing it does not. */
async function linkModules(directory: string) {
  await symlink(packageModules, join(directory, "node_modules"));
}

const FUTURE_FIELD = "model PiSession {\n  futureField String? @map(\"future_field\")";

/** Adds one field to the copied contract source: a contract the checked-in migrations do not reach. */
async function addFutureField(directory: string) {
  const path = join(directory, "src/contract.prisma");
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace("model PiSession {", FUTURE_FIELD));
}

export async function futureContract() {
  const directory = await mkdtemp(join(tmpdir(), "pi-future-contract-"));
  await Promise.all(["src", "migrations", "prisma.config.ts", "package.json"].map((path) => cp(join(packageRoot, path), join(directory, path), { recursive: true })));
  await linkModules(directory);
  await addFutureField(directory);
  await prisma(["contract", "emit"], directory);
  await prisma(["migration", "plan", "--from", contractJson.storage.storageHash, "--name", "future_test_only"], directory);
  return directory;
}

async function firstAppMigration(directory: string) {
  const migrations = await readdir(join(directory, "migrations/app"));
  const first = migrations.sort()[0];
  if (first === undefined) throw new Error("test fixture has no migration");
  return first;
}

/** The first migration's emitted operations with one table renamed, so the body cannot match its hash. */
function tamperedOperations(original: string) {
  const tampered = original.replace(/"table": "[^"]+"/, '"table": "tampered_table"');
  if (tampered === original) throw new Error("test fixture migration body did not contain expected table");
  return tampered;
}

export async function tamperedContract() {
  const directory = await futureContract();
  const firstMigration = await firstAppMigration(directory);
  const path = join(directory, "migrations/app", firstMigration, "ops.json");
  await writeFile(path, tamperedOperations(await readFile(path, "utf8")));
  return { directory, firstMigration };
}
