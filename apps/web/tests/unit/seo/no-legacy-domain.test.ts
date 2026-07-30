import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_ORIGIN } from "../../../src/features/seo/site";

/**
 * Domain-hygiene guard (S0.8): `apps/web` must carry no retired-domain literal,
 * and the live one must have exactly one definition site so a future domain
 * change is a one-line edit rather than a scavenger hunt.
 */
const LEGACY_DOMAINS = [
  "seichijunrei.app",
  "seichijunrei.zhenjia.dev",
  "seichijunrei.zhenjia.org",
  "aninavi.app",
];

const TEXT_EXTENSIONS = [".ts", ".tsx", ".css", ".json", ".txt", ".xml", ".svg"];
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = ["src", "public"];

function isText(name: string): boolean {
  return TEXT_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function filesUnder(relativeRoot: string): string[] {
  const root = join(PACKAGE_DIR, relativeRoot);
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && isText(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

const SOURCES = ROOTS.flatMap(filesUnder).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

function pathsContaining(needle: string): string[] {
  return SOURCES.filter((file) => file.text.includes(needle)).map((file) => file.path);
}

describe("legacy domain residue", () => {
  it("sweeps a non-trivial number of shipped text files", () => {
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it.each(LEGACY_DOMAINS)("has no %s literal anywhere in src/ or public/", (domain) => {
    expect(pathsContaining(domain)).toEqual([]);
  });
});

describe("canonical origin definition", () => {
  it("is defined once in src/, inside the seo site module", () => {
    const defining = pathsContaining(CANONICAL_ORIGIN).filter((path) => path.includes("/src/"));
    expect(defining.map((path) => path.split("/src/")[1])).toEqual(["features/seo/site.ts"]);
  });
});
