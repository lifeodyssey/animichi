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
  assessFrame, buildSummary, invocationErrorSummary, parseFrameReport, parseFrameRuns, parseReachability,
  type FrameReport, type FrameRun, type FrameVerdict, type Invocation, type Reachability, type Summary,
} from "./summary.ts";

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "report");

interface CliArgs {
  page: string;
  mode: string;
  ratio: number;
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
    ratio: Number.parseFloat(flagValue(argv, "--ratio", "0.01")), baseUrl: flagValue(argv, "--base-url", "http://localhost:3000"),
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

function verdictsOf(args: CliArgs): FrameVerdict[] {
  return args.frames.map((run) => assessFrame(run, readFrameReport(run.frame), args.reachability, args.baseUrl, args.ratio));
}

function writeSummary(summary: Summary): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(path.join(REPORT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

function printVerdict(summary: Summary): void {
  const verdict = summary.error ?? (summary.failedFrames.length > 0 ? `FAILED ${summary.failedFrames.join(", ")}` : summary.skipped > 0 ? "unverified — fail-closed" : "all green");
  console.log(`visual-check: ${summary.passed}/${summary.total} passed — ${verdict} (run ${summary.runId}; e2e/visual/report/summary.json)`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const invocation = invocationOf(args);
  const summary = args.error
    ? invocationErrorSummary(invocation, args.runId, args.error)
    : buildSummary(invocation, args.runId, verdictsOf(args), null);
  writeSummary(summary);
  printVerdict(summary);
  process.exitCode = summary.exitCode;
}

main();
