/**
 * Summary domain for the visual task atom (S0-v2 F2). Pure functions only —
 * no fs, no argv — so the machine contract is unit-testable without IO.
 * summarize-cli.ts owns the IO; this module owns the contract.
 *
 * Exit-code contract. The single authoritative verdict is summary.json
 * (`exitCode` + `error`), not the process exit code: through `make`, GNU make
 * remaps every recipe failure to its own exit 2, so the 0/1/2 distinction
 * survives only in the JSON. Every invocation path writes a fresh summary —
 * including invocation failures (exitCode 2 with `error`) — and the wrapper's
 * runner clears report/ once before the frame loop, so a stale file can never
 * be read as this run's result. `runId` lets a dispatcher detect interleaved
 * runs by comparing against the runId echoed on the last stdout line.
 *
 *   0 = every frame compared and passed
 *   1 = at least one frame failed (visual difference)
 *   2 = environment or invocation problem: no frames resolved, or at least
 *       one frame produced no comparison (app unreachable, runner blocked,
 *       missing convergence report) — fail-closed: zero compared pixels is
 *       never green.
 */

export type FrameStatus = "pass" | "fail" | "skipped";
export type AtomExit = 0 | 1 | 2;

/** How reachable the app-under-test was from the actual runner. */
export type Reachability = "compared" | "runner-blocked" | "app-down";

export interface FrameReport {
  ratio: number;
  threshold: number;
  pass: boolean;
}

export interface FrameRun {
  frame: string;
  exitCode: number;
}

export interface FrameVerdict {
  frame: string;
  status: FrameStatus;
  playwrightExit: number;
  ratio: number | null;
  threshold: number;
  report: string | null;
  reason: string;
}

export interface Invocation {
  page: string;
  mode: string;
  ratio: number;
  baseUrl: string;
  runner: string;
  frames: string[];
}

export interface Summary {
  schema: string;
  runId: string;
  invocation: Invocation;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failedFrames: string[];
  skippedFrames: string[];
  frames: FrameVerdict[];
  exitCode: AtomExit;
  error: string | null;
}

export function parseFrameRuns(spec: string): FrameRun[] {
  const runs: FrameRun[] = [];
  for (const token of spec.trim().split(/\s+/)) {
    if (!token) continue;
    const sep = token.lastIndexOf("=");
    runs.push({ frame: token.slice(0, sep), exitCode: Number.parseInt(token.slice(sep + 1), 10) });
  }
  return runs;
}

export function parseReachability(raw: string): Reachability {
  if (raw === "compared" || raw === "runner-blocked") return raw;
  return "app-down";
}

export function parseFrameReport(parsed: unknown): FrameReport | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.ratio !== "number" || typeof record.threshold !== "number" || typeof record.pass !== "boolean") return null;
  return { ratio: record.ratio, threshold: record.threshold, pass: record.pass };
}

export function skipReason(reach: Reachability, appUrl: string): string {
  if (reach === "app-down") return `app not reachable at ${appUrl}`;
  if (reach === "runner-blocked") return "app not reachable from the runner";
  return "no convergence report produced";
}

function failVerdict(run: FrameRun, report: FrameReport | null, threshold: number, reason: string): FrameVerdict {
  return {
    frame: run.frame, status: "fail", playwrightExit: run.exitCode,
    ratio: report?.ratio ?? null, threshold,
    report: report ? `report/${run.frame}.json` : null, reason,
  };
}

function passVerdict(run: FrameRun, report: FrameReport, threshold: number): FrameVerdict {
  return { frame: run.frame, status: "pass", playwrightExit: 0, ratio: report.ratio, threshold, report: `report/${run.frame}.json`, reason: "" };
}

export function assessFrame(run: FrameRun, report: FrameReport | null, reach: Reachability, appUrl: string, fallbackRatio: number): FrameVerdict {
  const threshold = report?.threshold ?? fallbackRatio;
  if (run.exitCode !== 0) return failVerdict(run, report, threshold, `playwright exited ${run.exitCode}`);
  if (report && !report.pass) return failVerdict(run, report, threshold, `convergence ratio ${report.ratio.toFixed(4)} > threshold ${threshold}`);
  if (report) return passVerdict(run, report, threshold);
  return { frame: run.frame, status: "skipped", playwrightExit: 0, ratio: null, threshold, report: null, reason: skipReason(reach, appUrl) };
}

export function verdictFor(verdicts: FrameVerdict[]): AtomExit {
  if (verdicts.some((v) => v.status === "fail")) return 1;
  if (verdicts.length === 0 || verdicts.some((v) => v.status === "skipped")) return 2;
  return 0;
}

function verdictCounts(verdicts: FrameVerdict[]): { passed: number; failed: number; skipped: number; failedFrames: string[]; skippedFrames: string[] } {
  const failedFrames = verdicts.filter((v) => v.status === "fail").map((v) => v.frame);
  const skippedFrames = verdicts.filter((v) => v.status === "skipped").map((v) => v.frame);
  return { passed: verdicts.length - failedFrames.length - skippedFrames.length, failed: failedFrames.length, skipped: skippedFrames.length, failedFrames, skippedFrames };
}

export function buildSummary(invocation: Invocation, runId: string, verdicts: FrameVerdict[], error: string | null): Summary {
  const counts = verdictCounts(verdicts);
  return {
    schema: "visual-check/summary/v1", runId,
    invocation: { ...invocation, frames: verdicts.map((v) => v.frame) },
    total: verdicts.length, passed: counts.passed, failed: counts.failed, skipped: counts.skipped,
    failedFrames: counts.failedFrames, skippedFrames: counts.skippedFrames,
    frames: verdicts, exitCode: verdictFor(verdicts), error,
  };
}

export function invocationErrorSummary(invocation: Invocation, runId: string, message: string): Summary {
  return buildSummary(invocation, runId, [], message);
}
