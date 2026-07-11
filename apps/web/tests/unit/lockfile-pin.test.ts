import { readFileSync } from "node:fs";
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
const webPackageUrl = new URL("../../package.json", import.meta.url);
const lockfileUrl = new URL("../../../../pnpm-lock.yaml", import.meta.url);
const setupActionUrl = new URL("../../../../.github/actions/setup/action.yml", import.meta.url);

function readText(url: URL): string {
  return readFileSync(url, "utf8");
}

function readWebPackage(): WebPackage {
  return JSON.parse(readText(webPackageUrl)) as WebPackage;
}

function readPnpmLock(): PnpmLock {
  return parse(readText(lockfileUrl)) as PnpmLock;
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
    expect(readText(setupActionUrl)).toContain("pnpm install --frozen-lockfile");
  });
});
