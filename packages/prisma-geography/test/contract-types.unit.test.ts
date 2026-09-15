import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

interface CompilerResult {
  readonly exitCode: number;
  readonly output: string;
}

const fixtureRoot = fileURLToPath(new URL("./type-fixtures/", import.meta.url));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

void test("a matched typed geography program compiles", async () => {
  assert.deepEqual(await compileFixture("valid"), { exitCode: 0, output: "" });
});

void test("the compiler rejects a wrong operation name", async () => {
  await assertCompileFailure("wrong-operation", /Property 'withinMeters' does not exist/u);
});

void test("the compiler rejects a wrong argument name", async () => {
  await assertCompileFailure("wrong-argument-name", /Property 'locaton' does not exist/u);
});

void test("the compiler rejects a wrong argument type", async () => {
  await assertCompileFailure("wrong-argument-type", /not assignable to parameter of type/u);
});

void test("the compiler rejects a missing argument", async () => {
  await assertCompileFailure("missing-argument", /Expected 3 arguments, but got 2/u);
});

void test("the compiler rejects a nonexistent return field", async () => {
  await assertCompileFailure("nonexistent-return-field", /Property 'missingDistance' does not exist/u);
});

void test("a matched typed trigram program compiles", async () => {
  assert.deepEqual(await compileFixture("trigram-valid"), { exitCode: 0, output: "" });
});

void test("the compiler rejects a wrong trigram operation name", async () => {
  await assertCompileFailure("trigram-wrong-operation", /Property 'trigramSimilarityScore' does not exist/u);
});

void test("the compiler rejects a wrong trigram argument name", async () => {
  await assertCompileFailure("trigram-wrong-argument-name", /Property 'nmae' does not exist/u);
});

void test("the compiler rejects a wrong trigram argument type", async () => {
  await assertCompileFailure("trigram-wrong-argument-type", /not assignable to parameter of type/u);
});

void test("the compiler rejects a missing trigram argument", async () => {
  await assertCompileFailure("trigram-missing-argument", /Expected 2 arguments, but got 1/u);
});

void test("the compiler rejects a nonexistent trigram return field", async () => {
  await assertCompileFailure("trigram-nonexistent-return-field", /Property 'missingSimilarity' does not exist/u);
});

async function assertCompileFailure(name: string, diagnostic: RegExp): Promise<void> {
  const result = await compileFixture(name);
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, diagnostic);
}

async function compileFixture(name: string): Promise<CompilerResult> {
  const temporary = await mkdtemp(path.join(fixtureRoot, ".generated-"));
  try {
    const program = path.join(temporary, "program.ts");
    await writeFile(program, await readFile(path.join(fixtureRoot, `${name}.txt`), "utf8"));
    return await runCompiler(program);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function runCompiler(program: string): Promise<CompilerResult> {
  try {
    const result = await executeCompiler(program);
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` };
  } catch (failure) {
    return compilerFailure(failure);
  }
}

function executeCompiler(program: string) {
  return promisify(execFile)("pnpm", ["exec", "tsc", "--ignoreConfig", "--noEmit", "--strict", "--target", "ES2022", "--lib", "ES2022,ESNext.Temporal,DOM", "--module", "ESNext", "--moduleResolution", "Bundler", "--allowImportingTsExtensions", "--skipLibCheck", "false", "--types", "node", program], {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function compilerFailure(failure: unknown): CompilerResult {
  if (!isRecord(failure)) throw new TypeError("TypeScript rejected with a non-object failure");
  const stdout = typeof failure.stdout === "string" ? failure.stdout : "";
  const stderr = typeof failure.stderr === "string" ? failure.stderr : "";
  const exitCode = typeof failure.code === "number" ? failure.code : -1;
  return { exitCode, output: `${stdout}${stderr}` };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
