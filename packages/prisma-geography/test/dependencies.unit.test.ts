import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

interface PackageManifest {
  readonly name: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

void test("every declared dependency and version was already present in the repo", async () => {
  const own = await readManifest(path.join(packageRoot, "package.json"));
  const others = (await workspaceManifests()).filter((manifest) => manifest.name !== own.name);
  const existing = new Set(others.flatMap(dependencyEntries));
  const additions = dependencyEntries(own).filter((entry) => !existing.has(entry));
  assert.deepEqual(additions, []);
});

void test("every declared dependency resolves from the installed workspace", async () => {
  const own = await readManifest(path.join(packageRoot, "package.json"));
  const unresolved = dependencyNames(own).filter((name) => !resolves(name));
  assert.deepEqual(unresolved, []);
});

async function workspaceManifests(): Promise<readonly PackageManifest[]> {
  const groups = await Promise.all(["apps", "packages", "workers"].map(manifestsUnder));
  return groups.flat();
}

async function manifestsUnder(directory: string): Promise<readonly PackageManifest[]> {
  const base = path.join(repoRoot, directory);
  const entries = await readdir(base, { withFileTypes: true });
  const manifests = entries.filter((entry) => entry.isDirectory()).map((entry) => readManifest(path.join(base, entry.name, "package.json")));
  return Promise.all(manifests);
}

async function readManifest(manifestPath: string): Promise<PackageManifest> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!isRecord(parsed) || typeof parsed.name !== "string") throw new TypeError(`invalid package manifest: ${manifestPath}`);
  return {
    name: parsed.name,
    dependencies: stringRecord(parsed.dependencies),
    devDependencies: stringRecord(parsed.devDependencies),
  };
}

function dependencyEntries(manifest: PackageManifest): readonly string[] {
  return Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).map(([name, version]) => `${name}@${version}`);
}

function dependencyNames(manifest: PackageManifest): readonly string[] {
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
}

function resolves(name: string): boolean {
  try {
    import.meta.resolve(`${name}/package.json`);
    return true;
  } catch {
    return resolvesEntryPoint(name);
  }
}

function resolvesEntryPoint(name: string): boolean {
  try {
    import.meta.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
