import { spawnSync } from 'node:child_process';
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
// and the process the bound kills is Wrangler's own launcher, not corepack's pnpm launcher and
// the pnpm process behind it.
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

// The bound kills with SIGKILL. spawnSync waits for its child to exit, and Wrangler's launcher
// traps SIGTERM to forward it to its CLI process, so under SIGTERM a CLI that does not exit holds
// the build past the bound: a child that trapped SIGTERM held a 500 ms spawnSync for 33 s, and
// returned at 505 ms under SIGKILL, with a grandchild holding the pipes too (2026-11-22). What
// the launcher started is then left running with only this runner's pipes, never the caller's:
// both streams are captured, and written back once the run ends. A build that fails on its own
// keeps its own output and exit; only the bound's kill becomes the diagnostic.
export function wranglerBuild(args, timeoutMs = WRANGLER_BUILD_TIMEOUT_MS) {
  const run = spawnSync(process.execPath, [WRANGLER, ...args], {
    env: { ...process.env, ...WRANGLER_ENV }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  if (run.error?.code === 'ETIMEDOUT') throw new Error(timeoutDiagnostic(run.stdout ?? '', timeoutMs), { cause: run.error });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`wrangler ${args[0]} exited with ${run.status ?? run.signal}`);
}
