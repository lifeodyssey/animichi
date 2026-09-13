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

function execute(args: readonly string[]) {
  return promisify(execFile)("pnpm", ["exec", "prisma", ...args, "--json"], {
    cwd: packageRoot,
    env: { ...process.env, DO_NOT_TRACK: "1" },
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
