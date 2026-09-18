import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { generatedArtifacts, normalizeGeneratedArtifacts, packageRoot } from "../scripts/generated-artifacts.ts";

const ARTIFACT_PATHS = [
  "src/contract.json",
  "src/contract.d.ts",
  "migrations/snapshots/aaaa/contract.json",
  "migrations/snapshots/aaaa/contract.d.ts",
  "migrations/app/20260101T0000_first/migration.json",
  "migrations/app/20260101T0000_first/ops.json",
] as const;

/** A tree shaped like the package's, with every artifact missing its final newline. */
async function unnormalizedTree() {
  const root = await mkdtemp(join(tmpdir(), "pi-generated-artifacts-"));
  for (const path of ARTIFACT_PATHS) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), '{"trailingNewline":false}');
  }
  return root;
}

/** Reads an already-discovered artifact path list, in order. */
async function artifactContents(paths: readonly string[]) {
  return Promise.all(paths.map((path) => readFile(path, "utf8")));
}

void test("normalization discovers every generated artifact and restores its final newline", async () => {
  const root = await unnormalizedTree();
  try {
    const paths = await generatedArtifacts(root);
    assert.deepEqual(paths.map((path) => path.slice(root.length + 1)), [...ARTIFACT_PATHS]);
    const changed = await normalizeGeneratedArtifacts(root);
    assert.equal(changed.length, ARTIFACT_PATHS.length);
    assert.deepEqual((await artifactContents(paths)).filter((content) => !content.endsWith("}\n")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("normalization is idempotent: a second run reports nothing and writes nothing", async () => {
  const root = await unnormalizedTree();
  try {
    await normalizeGeneratedArtifacts(root);
    const paths = await generatedArtifacts(root);
    const normalized = await artifactContents(paths);
    assert.deepEqual(await normalizeGeneratedArtifacts(root), []);
    assert.deepEqual(await artifactContents(paths), normalized);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("every committed generated artifact already ends with a newline", async () => {
  const paths = await generatedArtifacts(packageRoot);
  const contents = await Promise.all(paths.map(async (path) => ({ path, content: await readFile(path, "utf8") })));
  assert.deepEqual(contents.filter(({ content }) => !content.endsWith("\n")).map(({ path }) => path), []);
});
