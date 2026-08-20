import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ENTRYPOINT = fileURLToPath(import.meta.url).replace(/\/test\/entrypoint\.dsn\.test\.ts$/, "/docker/entrypoint.sh");

// Hermetic entrypoint tests (domain DSN + fail-fast probe). No real atlas /
// DNS / network: a controlled PATH shadows atlas/getent/nslookup/timeout.
// getent still answers FAKE_IP so a reintroduced IPv4 pin would show up on
// the atlas argv. elapsed_ms is emitted by the script; we only assert the
// token exists (no wall-clock).

const PROBE_BOUND = "35";
const FAKE_IP = "10.1.2.3";
const HOST = "ep-broad-frost-aopp3uqq.eu-central-1.aws.neon.tech";
const DSN_OK = `postgresql://migrator:secret@${HOST}/neondb`;
const STATUS = "migrate status";
const APPLY = "migrate apply";

interface RunResult { code: number | null; stdout: string; stderr: string }
interface Harness { run: (opts?: HarnessOpts) => Promise<RunResult>; atlasLog: () => string; timeoutLog: () => string }
interface HarnessOpts { dsn?: string; statusExit?: number }

const tempDirs: string[] = [];
afterAll(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });

function writeFake(dir: string, name: string, body: string[]): void {
  writeFileSync(join(dir, name), ["#!/bin/sh", ...body, ""].join("\n"));
  chmodSync(join(dir, name), 0o755);
}

const ATLAS = [
  'echo "$*" >> "${FAKE_ATLAS_LOG:?}"',
  'case " $* " in',
  '  *" ${STATUS} "*) exit "${FAKE_ATLAS_STATUS_EXIT:-0}" ;;'.replace("${STATUS}", STATUS),
  'esac',
  'exit 0',
];
const GETENT = [
  'printf "%s      STREAM host\\n" "${FAKE_GETENT_IP:-${FAKE_IP}}"'.replace("${FAKE_IP}", FAKE_IP),
  'exit 0',
];
const TIMEOUT = [
  'echo "$*" >> "${FAKE_TIMEOUT_LOG:?}"',
  'shift',
  'exec "$@"',
];

function fakeEnv(dir: string, dsn: string, opts: HarnessOpts): Record<string, string> {
  return {
    ...process.env,
    PATH: `${dir}:${process.env.PATH ?? ""}`,
    MIGRATOR_DATABASE_URL: opts.dsn ?? dsn,
    FAKE_ATLAS_LOG: join(dir, "atlas.log"),
    FAKE_TIMEOUT_LOG: join(dir, "timeout.log"),
    FAKE_ATLAS_STATUS_EXIT: String(opts.statusExit ?? 0),
    FAKE_GETENT_IP: FAKE_IP,
  };
}

function readOrEmpty(p: string): string {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}

function runSpawn(env: Record<string, string>): Promise<RunResult> {
  return execFileAsync("sh", [ENTRYPOINT], { env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (err: unknown) => {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? null, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    },
  );
}

function makeHarness(dsn: string): Harness {
  const dir = mkdtempSync(join(tmpdir(), "migrator-dsn-"));
  tempDirs.push(dir);
  writeFake(dir, "atlas", ATLAS);
  writeFake(dir, "getent", GETENT);
  writeFake(dir, "nslookup", ["exit 1"]);
  writeFake(dir, "timeout", TIMEOUT);
  const run = (opts: HarnessOpts = {}): Promise<RunResult> => runSpawn(fakeEnv(dir, dsn, opts));
  const atlasLog = (): string => readOrEmpty(join(dir, "atlas.log"));
  const timeoutLog = (): string => readOrEmpty(join(dir, "timeout.log"));
  return { run, atlasLog, timeoutLog };
}

function atlasLine(log: string, needle: string): string {
  return log.split("\n").find((line) => line.includes(needle)) ?? "";
}

describe("entrypoint rejection paths (PR1)", () => {
  it("AC1: rejects a -pooler host before atlas runs, mentions pooled endpoint, no DSN leak", async () => {
    const h = makeHarness(DSN_OK);
    const pooler = "postgresql://u:p@animichi-pooler.eu-central-1.aws.neon.tech/neondb";
    const res = await h.run({ dsn: pooler });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("pooled endpoint");
    expect(res.stdout + res.stderr).not.toContain(pooler);
    expect(res.stdout + res.stderr).not.toContain("animichi-pooler.eu-central-1.aws.neon.tech");
    expect(h.atlasLog()).toBe("");
  });

  it("AC1-case: rejects an UPPERCASE -pooler host (case-insensitive)", async () => {
    const h = makeHarness(DSN_OK);
    const upper = "postgresql://u:p@ANIMICHI-POOLER.EU-CENTRAL-1.AWS.NEON.TECH/neondb";
    const res = await h.run({ dsn: upper });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("pooled endpoint");
    expect(res.stdout + res.stderr).not.toContain(upper);
  });
});

describe("entrypoint probe + apply (domain DSN)", () => {
  it("AC3: atlas URL keeps the Neon hostname (no IPv4 pin) and still has connect_timeout + search_path; stdout never has the URL", async () => {
    const h = makeHarness(DSN_OK);
    const res = await h.run({});
    expect(res.code).toBe(0);
    const statusLine = atlasLine(h.atlasLog(), STATUS);
    expect(statusLine).toContain(`@${HOST}/neondb`);
    expect(statusLine).toContain("connect_timeout=30");
    expect(statusLine).toContain("search_path=public");
    expect(statusLine).toContain("--revisions-schema public");
    expect(statusLine).not.toContain(FAKE_IP);
    expect(statusLine).not.toContain("options=endpoint");
    expect(res.stdout).not.toContain("postgresql://");
    expect(res.stdout).not.toContain(HOST);
  });

  it("probe is bounded by the probe timeout; getent is not invoked", async () => {
    const h = makeHarness(DSN_OK);
    const res = await h.run({});
    expect(res.code).toBe(0);
    expect(h.timeoutLog()).toContain(`${PROBE_BOUND} atlas ${STATUS}`);
    expect(h.timeoutLog()).not.toContain("getent");
  });

  it("AC4: probe failure does not invoke apply and exits non-zero", async () => {
    const h = makeHarness(DSN_OK);
    const res = await h.run({ statusExit: 1 });
    expect(res.code).not.toBe(0);
    const log = h.atlasLog();
    expect(log).not.toContain(APPLY);
    expect(log.split("\n").filter((line) => line.includes(STATUS))).toHaveLength(1);
  });

  it("AC5: probe ok -> apply invoked once; lifecycle logs present", async () => {
    const h = makeHarness(DSN_OK);
    const res = await h.run({});
    expect(res.code).toBe(0);
    const combined = res.stdout + res.stderr;
    expect(combined).toContain("probe: start");
    expect(combined).toContain("elapsed_ms=");
    expect(combined).toContain("apply: start");
    expect(combined).not.toContain("resolve:");
    expect(h.atlasLog().split("\n").filter((line) => line.includes(APPLY))).toHaveLength(1);
  });
});
