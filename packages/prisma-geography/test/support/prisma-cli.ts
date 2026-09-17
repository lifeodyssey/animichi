import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export interface PrismaResult {
  readonly stdout: string;
  readonly result: Readonly<Record<string, unknown>>;
}

export interface PrismaFailure extends PrismaResult {
  readonly exitCode: number;
  readonly stderr: string;
}

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function prisma(args: readonly string[]): Promise<PrismaResult> {
  const { stdout } = await execute(args);
  return { stdout, result: resultEnvelope(stdout) };
}

export async function prismaFailure(args: readonly string[]): Promise<PrismaFailure> {
  try {
    await execute(args);
  } catch (failure) {
    return normalizeFailure(failure);
  }
  throw new Error(`prisma ${args.join(" ")} unexpectedly succeeded`);
}

/** The inherited environment with NODE_V8_COVERAGE disabled for the child.
 *
 * The coverage runner points NODE_V8_COVERAGE at its own temporary directory
 * and merges every dump found there into one per-URL report. Node force-
 * propagates that variable into every spawned child — `normalizeSpawnArguments`
 * copies it over the spawn env unless the key is present there — so a prisma
 * CLI child dumps coverage for this package's sources even with a stripped
 * env: the CLI loads the same URLs through its own config loader under a
 * different transpile (different byte offsets) and executes almost nothing,
 * contributing all-zero functions node cannot match against the test
 * process's own (matching is by exact function name plus first-range
 * offsets). Node's line attribution takes the LAST full-covering range per
 * line, so whether those zeros merged before or after the test process's own
 * dump — a filename-order lottery, and the file names begin with pids —
 * decided the line-coverage table run to run (#1740). An empty value keeps
 * the key present, which blocks the propagation, and no coverage starts up
 * in the child: the CLI is not under test, so it writes no dump at all. */
function childEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, NODE_V8_COVERAGE: "", DO_NOT_TRACK: "1" };
}

function execute(args: readonly string[]) {
  return promisify(execFile)("pnpm", ["exec", "prisma", ...args, "--json"], {
    cwd: packageRoot,
    env: childEnvironment(),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function normalizeFailure(failure: unknown): PrismaFailure {
  if (!isRecord(failure)) throw new TypeError("Prisma CLI rejected with a non-object failure");
  const stdout = stringField(failure, "stdout");
  return {
    stdout,
    stderr: stringField(failure, "stderr"),
    exitCode: numberField(failure, "code"),
    result: resultEnvelope(stdout),
  };
}

function resultEnvelope(stdout: string): Readonly<Record<string, unknown>> {
  const line = stdout.split("\n").reverse().find((value) => value.includes('"kind":"result"'));
  if (line === undefined) throw new Error(`Prisma CLI emitted no result envelope\n${stdout}`);
  const parsed: unknown = JSON.parse(line);
  if (!isRecord(parsed)) throw new TypeError("Prisma result envelope is not an object");
  return parsed;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function stringField(value: Readonly<Record<string, unknown>>, name: string): string {
  const field = value[name];
  return typeof field === "string" ? field : "";
}

function numberField(value: Readonly<Record<string, unknown>>, name: string): number {
  const field = value[name];
  return typeof field === "number" ? field : -1;
}
