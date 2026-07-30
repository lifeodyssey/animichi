import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

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
const webPackagePath = resolve(process.cwd(), "package.json");
const lockfilePath = resolve(process.cwd(), "../../pnpm-lock.yaml");
const setupActionPath = resolve(process.cwd(), "../../.github/actions/setup/action.yml");

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function readWebPackage(): WebPackage {
  return JSON.parse(readText(webPackagePath)) as WebPackage;
}

function readPnpmLock(): PnpmLock {
  return parse(readText(lockfilePath)) as PnpmLock;
}

describe("animal-island-ui-tailwind lockfile pin", () => {
  it("keeps the package specifier and lockfile resolution aligned", () => {
    const webPackage = readWebPackage();
    const webImporter = readPnpmLock().importers["apps/web"];
    const packageSpecifier = webPackage.dependencies?.[dependencyName];
    const lockDependency = webImporter?.dependencies?.[dependencyName];

    expect(packageSpecifier).toBe("^1.0.16");
    expect(lockDependency?.specifier).toBe(packageSpecifier);
    expect(lockDependency?.version).toMatch(/^1\.0\.\d+\b/u);
  });

  it("keeps CI install drift visible through frozen lockfile installs", () => {
    expect(readText(setupActionPath)).toContain("pnpm install --frozen-lockfile");
  });
});
