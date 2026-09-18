import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

interface WebPackage {
  dependencies?: Record<string, string>;
}

interface LockDependency {
  specifier: string;
  version: string;
}

interface PnpmLock {
  importers: Record<string, { dependencies?: Record<string, LockDependency> }>;
}

const dependencyName = "animal-island-ui-tailwind";
const webPackagePath = resolve(HERE, "../../package.json");
const lockfilePath = resolve(HERE, "../../../../pnpm-lock.yaml");

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function readWebPackage(): WebPackage {
  return JSON.parse(readText(webPackagePath)) as WebPackage;
}

function readPnpmLock(): PnpmLock {
  // pnpm 12 writes the lockfile as two YAML documents: the first carries the
  // package-manager dependency it installs for itself (`@pnpm/exe`), the second
  // the workspace. `parse` reads only the first and throws on the second, so
  // select the document that actually holds this package's importer.
  const documents = parseAllDocuments(readText(lockfilePath)).map((document) => document.toJS() as PnpmLock);
  const workspace = documents.find((document) => document.importers["apps/web"] !== undefined);
  if (workspace === undefined) throw new Error("pnpm-lock.yaml declares no apps/web importer");
  return workspace;
}

describe("animal-island-ui-tailwind lockfile pin", () => {
  it("keeps the package specifier and lockfile resolution aligned", () => {
    const webPackage = readWebPackage();
    const webImporter = readPnpmLock().importers["apps/web"];
    const packageSpecifier = webPackage.dependencies?.[dependencyName];
    const lockDependency = webImporter?.dependencies?.[dependencyName];

    expect(packageSpecifier).toBe("^1.10.0");
    expect(lockDependency?.specifier).toBe(packageSpecifier);
    expect(lockDependency?.version).toMatch(/^1\.10\.\d+\b/u);
  });
});
