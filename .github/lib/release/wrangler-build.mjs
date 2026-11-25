import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// A release build's one Wrangler run, bounded, so a stalled build names itself instead of
// holding its caller: CD's release build, build-worker.test.sh and the four sealed-bundle boot
// tests, whose own timeouts cannot reach a grandchild. The bound and the two diagnostics are
// the API Worker's bundle smoke's (`workers/api/bundle-smoke/wrangler-bundle.ts`, #1859).
export const WRANGLER_BUILD_TIMEOUT_MS = 60_000;

// Wrangler's own last line for a `--dry-run` that built.
const DRY_RUN_FINISHED = '--dry-run: exiting now.';

// No usage metrics, and no banner, whose update check would ask registry.npmjs.org for
// Wrangler's latest version on every run.
const WRANGLER_ENV = { WRANGLER_SEND_METRICS: 'false', WRANGLER_HIDE_BANNER: 'true' };

// The repository's Wrangler, run by this Node rather than through `pnpm exec`: no PATH lookup,
// and no corepack or pnpm process between this runner and the group the bound kills.
const WRANGLER = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');

// Two different stalls arrive wearing one error: a build still running when the bound elapsed,
// and a build that had printed its last line before its process outlived the bound.
export function timeoutDiagnostic(stdout, timeoutMs) {
  const bound = String(timeoutMs / 1000);
  if (stdout.includes(DRY_RUN_FINISHED)) {
    return `Wrangler finished its dry-run build and printed "${DRY_RUN_FINISHED}", then did not exit within ${bound} seconds`;
  }
  return `Wrangler did not finish its dry-run build within ${bound} seconds`;
}

function capture(stream) {
  const chunks = [];
  stream.setEncoding('utf8').on('data', (chunk) => chunks.push(chunk));
  return () => chunks.join('');
}

// Wrangler's launcher leads a process group of its own (`detached`), and what it starts joins
// it: the CLI it spawns and the esbuild processes the CLI spawns. The bound kills the group;
// killing the launcher alone left the CLI and esbuild running as orphans. SIGKILL, because the
// launcher traps SIGTERM to forward it to its CLI, and a CLI that does not exit would hold the
// build past the bound (2026-11-22). This runner's ends of the pipes close with it, so the run
// ends with the launcher even if a process outside the group still held them.
function stopGroup(child) {
  signalGroup(child, 'SIGKILL');
  child.stdout.destroy();
  child.stderr.destroy();
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

// A group that has gone with its launcher leaves a signal nothing to reach, as when the bound
// fires just as the build ends. ESRCH while the launcher still runs means it leads no group, so it
// is raised: swallowed, a launcher that lost `detached` would run on and the build would hang.
function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH' || !exited(child)) throw error;
  }
}

// One run of the launcher. It ends once the group has closed the output pipes, or at the bound.
async function boundedRun(args, timeoutMs) {
  const child = spawn(process.execPath, [WRANGLER, ...args], {
    env: { ...process.env, ...WRANGLER_ENV }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  const [stdout, stderr] = [capture(child.stdout), capture(child.stderr)];
  let timedOut = false;
  const bound = setTimeout(() => { timedOut = true; stopGroup(child); }, timeoutMs);
  const [status, signal] = await once(child, 'close').finally(() => clearTimeout(bound));
  return { stdout: stdout(), stderr: stderr(), status, signal, timedOut };
}

// Both streams are captured and written back once the run ends. A build that fails on its own
// keeps its own output and exit; only the bound's kill becomes the diagnostic.
export async function wranglerBuild(args, timeoutMs = WRANGLER_BUILD_TIMEOUT_MS) {
  const run = await boundedRun(args, timeoutMs);
  process.stdout.write(run.stdout);
  process.stderr.write(run.stderr);
  if (run.timedOut) throw new Error(timeoutDiagnostic(run.stdout, timeoutMs));
  if (run.status !== 0) throw new Error(`wrangler ${args[0]} exited with ${run.status ?? run.signal}`);
}
