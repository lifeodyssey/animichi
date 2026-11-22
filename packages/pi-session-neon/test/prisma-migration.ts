import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));

/** The CLI this package declares, invoked where `pnpm install` put it.
 *
 * Not `pnpm exec prisma`: a fixture that applies a chain copies this package to a temporary
 * directory outside the workspace (`migration-fixtures.ts`), and pnpm there resolves no
 * workspace, decides its modules are stale, and fails the install on the copied manifest's
 * `catalog:` specs (`ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`) before the CLI starts. The
 * shim is what `pnpm exec` would have run anyway, and it reads `prisma.config.ts` from the
 * working directory either way. */
const PRISMA_CLI = fileURLToPath(new URL("../node_modules/.bin/prisma", import.meta.url));

export function prisma(args: string[], cwd = packageRoot) {
  return promisify(execFile)(PRISMA_CLI, [...args, "--json"], {
    cwd, env: { ...process.env, DO_NOT_TRACK: "1" }, maxBuffer: 5 * 1024 * 1024,
  });
}

/** The CLI writes its divergence report across both streams, so every rejection
 * assertion reads them as one string instead of unpacking `stdout`/`stderr` itself. */
export function prismaCliOutput(failure: unknown): string {
  assert(failure !== null && typeof failure === "object");
  const stdout = "stdout" in failure ? String(failure.stdout) : "";
  const stderr = "stderr" in failure ? String(failure.stderr) : "";
  return `${stdout}\n${stderr}`;
}

/** The `error` of the result envelope a failed `--json` run prints last on stdout: its code,
 * and the structured `meta` the runner fills (operation, blocking objects, `databaseUnchanged`).
 * Assert these rather than the summary, whose wording each release rewrites. */
export interface PrismaFailure {
  readonly code: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function prismaFailure(failure: unknown): PrismaFailure {
  assert(isRecord(failure) && "stdout" in failure, "the CLI failure carries no stdout");
  const line = String(failure.stdout).split("\n").reverse().find((value) => value.includes('"kind":"result"'));
  assert(line !== undefined, `the CLI printed no result envelope\n${prismaCliOutput(failure)}`);
  const parsed: unknown = JSON.parse(line);
  assert(isRecord(parsed) && isRecord(parsed.envelope) && parsed.envelope.ok === false, line);
  const { error } = parsed.envelope;
  assert(isRecord(error) && typeof error.code === "string" && isRecord(error.meta), line);
  return { code: error.code, meta: error.meta };
}

export function migrate(dsn: string, cwd = packageRoot, target?: string) {
  const selection = target === undefined ? [] : ["--to", target];
  return prisma(["db", "migrate", "--db", dsn, ...selection], cwd);
}

/** The package's own emit entrypoint, run inside the directory that owns the chain being
 * emitted: a fixture that patches a migration source has to re-emit it, or the body it renders
 * will not match its own hash and the runner will refuse it before any postcheck. */
export function emitMigration(directory: string, migration: string) {
  return promisify(execFile)(process.execPath, [join(directory, "scripts/run-migration.ts"), `migrations/app/${migration}`], { cwd: directory });
}
