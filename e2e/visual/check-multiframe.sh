#!/usr/bin/env bash
# Multi-frame shell-boundary check for the visual task atom (S0-v2 F2).
#
# The unit layer (summary.spec.ts) proves the pure contract but cannot catch a
# per-frame lifecycle bug in the wrapper: when the report/ clear ran INSIDE
# the frame loop, frame N+1's runner deleted frame N's report and every frame
# but the last was reported "no convergence report produced" — a false
# verdict. That only shows up on a real all-frames run, at the shell boundary.
#
# This check runs the atom WITHOUT PAGE (every frame in the registry) and
# asserts the contract end-to-end:
#   1. summary.json says exitCode 0 (every frame compared and passed)
#   2. every resolved frame appears in summary.frames with status "pass"
#   3. every resolved frame has its report/<frame>.json on disk
#
# The budget is loose (default 0.9999) ON PURPOSE: this check verifies the
# atom's contract, not frame convergence — converging the frames to the
# default RATIO=0.01 is the C4 card, and the Makefile default is pipeline
# config that must not be touched here. A loose budget still proves the bug
# class: it is violated by a skipped/missing report, which is what the
# clear-inside-loop mutation produces.
#
# Preconditions: docker + the Playwright image (or host playwright), and a
# reachable app at E2E_WEB_BASE_URL (start with `make dev-local`). The check
# is fail-closed: an unreachable app yields exitCode 2 and this check fails.
#
# Usage: e2e/visual/check-multiframe.sh [RATIO] [BASE_URL]
#   RATIO and BASE_URL override the defaults; env E2E_WEB_BASE_URL wins for
#   the URL when no positional arg is given.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VISUAL_DIR="$REPO_ROOT/e2e/visual"
REPORT_DIR="$VISUAL_DIR/report"
RATIO="${1:-0.9999}"
BASE_URL="${2:-${E2E_WEB_BASE_URL:-http://localhost:3000}}"

FRAME_KEYS="$(node --no-warnings --experimental-strip-types "$VISUAL_DIR/frames-cli.ts")" || {
  echo "check-multiframe FAIL: frame registry could not be resolved" >&2
  exit 1
}

FRAMES=""
while IFS= read -r frame; do
  [ -n "$frame" ] && FRAMES="$FRAMES $frame"
done <<< "$FRAME_KEYS"

echo "check-multiframe: frames:${FRAMES}  RATIO=$RATIO  BASE_URL=$BASE_URL"

ATOM_EXIT=0
VISUAL_PAGE="" VISUAL_RATIO="$RATIO" E2E_WEB_BASE_URL="$BASE_URL" \
  bash "$REPO_ROOT/scripts/visual-check.sh" || ATOM_EXIT=$?
if [ "$ATOM_EXIT" -gt 2 ]; then
  echo "check-multiframe FAIL: atom exited $ATOM_EXIT (contract says 0/1/2)" >&2
  exit 1
fi

node --no-warnings -e '
const fs = require("node:fs");
const [summaryPath, reportDir, ...frames] = process.argv.slice(1);
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const problems = [];
if (summary.exitCode !== 0) {
  problems.push(`summary.exitCode=${summary.exitCode} (expected 0)`);
}
const verdicts = new Map(summary.frames.map((v) => [v.frame, v]));
for (const frame of frames) {
  if (!verdicts.has(frame)) {
    problems.push(`frame ${frame} missing from summary.frames`);
  } else if (verdicts.get(frame).status !== "pass") {
    const v = verdicts.get(frame);
    problems.push(`frame ${frame} status=${v.status} (${v.reason})`);
  }
  if (!fs.existsSync(`${reportDir}/${frame}.json`)) {
    problems.push(`report/${frame}.json missing`);
  }
}
if (problems.length > 0) {
  console.error("check-multiframe FAIL:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-multiframe PASS: every frame has a report, all pass, exitCode 0");
' "$REPORT_DIR/summary.json" "$REPORT_DIR" $FRAMES
