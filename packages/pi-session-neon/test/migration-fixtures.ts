import { cp, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import contractJson from "../src/contract.json" with { type: "json" };
import { emitMigration, packageRoot, prisma } from "./prisma-migration.ts";

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

/** The statement renderer, and the same renderer with the catalog service's own grant one table
 * short. `aliases` is the first table the baseline grants `catalog_svc`, so the check that fails
 * is the first one the operation declares, and the role's other fifteen grants are untouched. */
const GRANT_STATEMENT = "  sql: `GRANT ${grants.join(', ')} ON TABLE ${qualify(tables)} TO ${grantee}`,";
const GRANT_STATEMENT_WITHOUT_ALIASES = "  sql: `GRANT ${grants.join(', ')} ON TABLE ${qualify(description === 'grant catalog service table access' ? tables.filter((table) => table !== 'aliases') : tables)} TO ${grantee}`,";

/** A chain that grants `catalog_svc` what the baseline does except `aliases`, re-emitted from a
 * patched `access.ts`.
 *
 * The patch goes through the source and the emitter, not `ops.json`: the runner compares a
 * migration body against its own hash before applying it, so a hand-edited `ops.json` — the
 * `tamperedContract` shape — is refused at that gate and never reaches a postcheck. It also
 * targets the rendered statement rather than the grant list, because that list renders both
 * halves of the operation: dropping the table there would drop the postcheck with the grant,
 * and a mutation that removes what it is testing for proves nothing. */
export async function droppedCatalogGrant() {
  const directory = await mkdtemp(join(tmpdir(), "pi-dropped-grant-"));
  await Promise.all(["src", "migrations", "scripts", "prisma.config.ts", "package.json"].map((path) => cp(join(packageRoot, path), join(directory, path), { recursive: true })));
  await linkModules(directory);
  const migration = await firstAppMigration(directory);
  const path = join(directory, "migrations/app", migration, "access.ts");
  const source = await readFile(path, "utf8");
  const patched = source.replace(GRANT_STATEMENT, GRANT_STATEMENT_WITHOUT_ALIASES);
  if (patched === source) throw new Error("test fixture could not drop the catalog grant");
  await writeFile(path, patched);
  await emitMigration(directory, migration);
  return directory;
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
