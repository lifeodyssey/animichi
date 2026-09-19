/**
 * The live login lane's `.env.test`, as a specification (#1813).
 *
 * Four documents promised that `pnpm --filter animichi-e2e run test:login`
 * reads its credentials from the repo-root `.env.test`, and nothing loaded the
 * file. The lane cannot hide that — it FAILS by name without
 * `NEON_AUTH_BASE_URL` + `QA_NEON_USER_EMAIL` + `QA_NEON_USER_PASSWORD` (#1690)
 * — so the documented one-command proof failed for anyone who followed the
 * documentation exactly. Measured with a sentinel `.env.test` in place: all
 * three arrived `<UNSET>`.
 *
 * Loading the file from `playwright.config.ts` was considered and rejected: a
 * hand-created `.env.test` would then repoint the Neon Auth origin for every
 * lane, hermetic ones included, and no CI run can observe that blast radius
 * because no `.env.test` exists there by construction. So the flag rides the
 * LANE's own interpreter, and these cases are about that — the real script's
 * argv is read from `e2e/package.json` and then EXECUTED, so "loads the file
 * when there is one" is a measurement rather than a grep.
 *
 * The throwaway tree is not tidiness. A real repo-root `.env.test` holds
 * credentials: a case that wrote one would leak them into every other lane on
 * the machine, and a case that READ one would pass on the operator's machine
 * and fail in CI, where none exists by construction.
 *
 * test-type: unit (the lane's argv, read and executed; no browser, no clock,
 * and nothing taken from the repository root's `.env.test`).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const E2E_DIR = fileURLToPath(new URL(".", import.meta.url));
const LIVE_LOGIN_SCRIPT = "test:login";
/** The file the lane's flag must name: the REPOSITORY root's, one level above
 *  the package directory pnpm runs a script in — never one of the package's
 *  own, and never a second copy of it. */
const ENV_FILE_FLAG = "--env-file-if-exists=../.env.test";
const ENV_FILE_FLAG_PREFIX = "--env-file";
const ENV_FILE_NAME = ".env.test";
/** The entry point of `@playwright/test`, the dependency this package declares.
 *  Named as a FILE because the lane's interpreter is `node`: an env-file flag
 *  is a Node flag, so the process it flags has to be the one that reads it. */
const PLAYWRIGHT_CLI = "node_modules/@playwright/test/cli.js";
const SENTINEL = "ANIMICHI_LIVE_LOGIN_ENV_FILE";
const SENTINEL_VALUE = "loaded-from-the-repo-root-env-file";
const FIXTURE = `${SENTINEL}=${SENTINEL_VALUE}\n`;
/** What the interpreter reports back: the env file's effect, with Playwright
 *  and every other input the lane has left out of the picture. */
const PROBE = `process.stdout.write(process.env.${SENTINEL} ?? "")`;
/** A leading `KEY=VALUE` is the environment the script runs in, not its
 *  command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

interface ProbeResult {
  readonly status: number | null;
  readonly stdout: string;
}

void test("the lane loads the repo-root .env.test when there is one", () => {
  const probe = probeTree(FIXTURE);
  assert.equal(
    probe.stdout,
    SENTINEL_VALUE,
    "test:login no longer loads a repo-root `.env.test`: the value the lane's own interpreter " +
      "was handed is missing. Four documents promise this file is the lane's input — the lane " +
      "fails by name without it, so this is the documented one-command proof failing (#1813).",
  );
});

void test("the lane runs unchanged when there is no .env.test, because the file is optional", () => {
  const probe = probeTree(null);
  assert.equal(probe.status, 0, "the file is optional: requiring it breaks every machine that " +
    "has none, CI included (#1813)");
  assert.equal(probe.stdout, "", "nothing may load a value that is not there");
});

void test("the file is loaded by the lane's own interpreter, optionally", () => {
  assert.equal(laneCommand()[0], "node", "an env-file flag is a Node flag, and " +
    "`node_modules/.bin/playwright` is a shell shim Node cannot execute (#1813)");
  assert.deepEqual(laneEnvFileFlags(), [ENV_FILE_FLAG],
    "the lane's env file must be the repo root's, in the `--env-file-if-exists` form (#1813)");
});

void test("the interpreter is handed the Playwright CLI of a declared dependency", () => {
  assert.equal(laneScriptArgument(), PLAYWRIGHT_CLI, "the lane must name Playwright's entry point");
  assert.ok(
    existsSync(join(E2E_DIR, PLAYWRIGHT_CLI)),
    `${PLAYWRIGHT_CLI} is not installed — the lane would fail before it resolved anything`,
  );
});

/** The script the lane's interpreter is handed: `node`'s first argument that is
 *  not one of Node's own flags. */
function laneScriptArgument(): string | undefined {
  return laneCommand()[scriptIndex()];
}

/** Where Node's own flags end and the script it runs begins. A flag written
 *  after that point is the SCRIPT's argument, and Node will never read it — so
 *  it must not count as loading anything here. */
function scriptIndex(): number {
  const argv = laneCommand().slice(1);
  return argv.findIndex((token) => !token.startsWith("--")) + 1;
}

/** The lane's tokenized command, environment assignments removed. */
function laneCommand(): readonly string[] {
  const tokens = laneTokens();
  return tokens.slice(tokens.findIndex((token) => !ENV_ASSIGNMENT.test(token)));
}

/** The env-file flags the lane's interpreter is actually given: the ones ahead
 *  of the script, which are the only ones Node parses. */
function laneEnvFileFlags(): readonly string[] {
  return laneCommand().slice(1, scriptIndex()).filter((token) => token.startsWith(ENV_FILE_FLAG_PREFIX));
}

function laneTokens(): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(E2E_DIR, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const script = manifest.scripts[LIVE_LOGIN_SCRIPT];
  assert.ok(script !== undefined, `e2e/package.json: no ${LIVE_LOGIN_SCRIPT} script to read`);
  return script.split(/\s+/);
}

/** Runs the lane's env-file flags in a tree shaped like a checkout: the cwd is
 *  `<root>/e2e`, so the lane's relative path resolves to `<root>/.env.test` —
 *  where it points in this repository — and `fixture` is what is found there,
 *  or the tree simply has no such file. */
function probeTree(fixture: string | null): ProbeResult {
  const root = mkdtempSync(join(tmpdir(), "animichi-live-login-"));
  const lane = join(root, "e2e");
  mkdirSync(lane);
  if (fixture !== null) writeFileSync(join(root, ENV_FILE_NAME), fixture);
  try {
    return spawnSync(process.execPath, laneInterpreterArgv(), { cwd: lane, encoding: "utf8" });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Node runs the lane's flags here, because Node is the interpreter the lane
 *  asserts above; the script path is replaced by a probe, which is the whole
 *  of Playwright's part in this question. */
function laneInterpreterArgv(): readonly string[] {
  return [...laneEnvFileFlags(), "--eval", PROBE];
}
