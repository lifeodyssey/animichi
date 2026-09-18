/** The Prisma chain's identity: every input that would change the applied schema.
 *
 * Prisma records the chain as linked steps under `migrations/app`, each with
 * `to` (the contract hash that step ends at) and `migrationHash` (CHECK_HASH of
 * that step's body). The last `to` is the head. Hashing every file in those
 * directories — not the head alone — is what invalidates a template when a
 * body is edited without a new head.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_PACKAGE } from "./prisma-chain.ts";

const APP_MIGRATIONS = join(CHAIN_PACKAGE, "migrations", "app");
const TEMPLATE_PREFIX = "tpl_";
const IDENTIFIER_CEILING = 63;

interface ChainStep {
  readonly directory: string;
  readonly to: string;
  readonly migrationHash: string;
}

export function prismaChainHead(): string {
  const head = chainSteps().at(-1)?.to;
  if (head === undefined) throw new Error("the Prisma chain has no migration");
  return head;
}

export function prismaChainIdentity(): string {
  const hash = createHash("sha256");
  for (const step of chainSteps()) hash.update(stepIdentity(step));
  return hash.digest("hex");
}

export function migratedTemplateName(identity = prismaChainIdentity()): string {
  const hashLength = IDENTIFIER_CEILING - TEMPLATE_PREFIX.length;
  return `${TEMPLATE_PREFIX}${identity.slice(0, hashLength)}`;
}

export function assertCurrentTemplate(name: string, identity = prismaChainIdentity()): void {
  const expected = migratedTemplateName(identity);
  if (name !== expected) {
    throw new Error(`stale migrated template ${name}; current chain identity names ${expected}`);
  }
}

function chainSteps(): ChainStep[] {
  return migrationDirectories().map(readStep);
}

function migrationDirectories(): string[] {
  return readdirSync(APP_MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readStep(directory: string): ChainStep {
  const manifest = JSON.parse(readFileSync(join(APP_MIGRATIONS, directory, "migration.json"), "utf8")) as {
    to: string;
    migrationHash: string;
  };
  return { directory, to: manifest.to, migrationHash: manifest.migrationHash };
}

function stepIdentity(step: ChainStep): string {
  return `${step.directory}\n${step.to}\n${step.migrationHash}\n${directoryBytes(step.directory)}`;
}

function directoryBytes(directory: string): string {
  const root = join(APP_MIGRATIONS, directory);
  return readdirSync(root).sort().map((file) => fileBytes(root, file)).join("\n");
}

function fileBytes(root: string, file: string): string {
  return `${file}\n${readFileSync(join(root, file), "utf8")}`;
}
