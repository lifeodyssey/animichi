/**
 * Summary assembly CLI (S0-v2 F2) — a thin IO shell over summary.ts. Reads
 * each frame's per-frame report JSON and its playwright exit code, writes
 * e2e/visual/report/summary.json, prints the one-line verdict, and exits with
 * the atom verdict (0 pass / 1 visual diff / 2 environment or invocation).
 * Every path writes a fresh summary — pass `--error` to record an invocation
 * failure — so a stale summary.json can never be read as this run's result.
 *
 * Usage (repo root, Node >= 22.6):
 *   node --experimental-strip-types e2e/visual/summarize-cli.ts \
 *     --page PAGE --mode MODE --ratio 0.01 --base-url http://localhost:3000 \
 *     --runner docker --reachability compared --frames "landing-day=0" \
 *     [--run-id ID] [--error MESSAGE]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessFrame, buildSummary, invocationErrorSummary, parseFrameReport, parseFrameRuns, parseRatio, parseReachability,
  type FrameReport, type FrameRun, type FrameVerdict, type Invocation, type Reachability, type Summary,
} from "./summary.ts";

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "report");

interface CliArgs {
  page: string;
  mode: string;
  ratio: number | null;
  baseUrl: string;
  runner: string;
  reachability: Reachability;
  runId: string;
  error: string;
  frames: FrameRun[];
}

function flagValue(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  return {
    page: flagValue(argv, "--page", ""), mode: flagValue(argv, "--mode", "day"),
    ratio: parseRatio(flagValue(argv, "--ratio", "0.01")), baseUrl: flagValue(argv, "--base-url", "http://localhost:3000"),
    runner: flagValue(argv, "--runner", "host"), reachability: parseReachability(flagValue(argv, "--reachability", "app-down")),
    runId: flagValue(argv, "--run-id", new Date().toISOString()), error: flagValue(argv, "--error", ""),
    frames: parseFrameRuns(flagValue(argv, "--frames", "")),
  };
}

function readFrameReport(frame: string): FrameReport | null {
  const file = path.join(REPORT_DIR, `${frame}.json`);
  if (!existsSync(file)) return null;
  try {
    return parseFrameReport(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function invocationOf(args: CliArgs): Invocation {
  return { page: args.page, mode: args.mode, ratio: args.ratio, baseUrl: args.baseUrl, runner: args.runner, frames: [] };
}

function verdictsOf(args: CliArgs, fallbackRatio: number): FrameVerdict[] {
  const context = { reach: args.reachability, appUrl: args.baseUrl, fallbackRatio };
  return args.frames.map((run) => assessFrame(run, readFrameReport(run.frame), context));
}

function writeSummary(summary: Summary): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(path.join(REPORT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

function verdictLine(summary: Summary): string {
  if (summary.error) return summary.error;
  if (summary.failedFrames.length > 0) return `FAILED ${summary.failedFrames.join(", ")}`;
  if (summary.skipped > 0) return "unverified — fail-closed";
  return "all green";
}

function printVerdict(summary: Summary): void {
  console.log(`visual-check: ${summary.passed}/${summary.total} passed — ${verdictLine(summary)} (run ${summary.runId}; e2e/visual/report/summary.json)`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.ratio === null) {
    const message = `invalid --ratio '${flagValue(argv, "--ratio", "0.01")}' (expected a finite number, 0 < ratio <= 1)`;
    const summary = invocationErrorSummary(invocationOf(args), args.runId, message);
    writeSummary(summary);
    printVerdict(summary);
    process.exitCode = 2;
    return;
  }
  const invocation = invocationOf(args);
  const summary = args.error
    ? invocationErrorSummary(invocation, args.runId, args.error)
    : buildSummary(invocation, { runId: args.runId, verdicts: verdictsOf(args, args.ratio), error: null });
  writeSummary(summary);
  printVerdict(summary);
  process.exitCode = summary.exitCode;
}

main();
