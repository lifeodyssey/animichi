#!/usr/bin/env bash
# Shell-boundary contract check for the visual task atom (S0-v2 F2).
#
# The unit layer (summary.spec.ts) proves the pure contract but cannot catch a
# per-frame lifecycle bug in the wrapper: when the report/ clear ran INSIDE
# the frame loop, frame N+1's runner deleted frame N's report and every frame
# but the last was reported "no convergence report produced" — a false
# verdict. That only shows up on a real all-frames run, at the shell boundary.
#
# Phase 1 — multi-frame contract: runs the atom WITHOUT PAGE (every frame in
# the registry) and asserts:
#   1. summary.json says exitCode 0 (every frame compared and passed)
#   2. every resolved frame appears in summary.frames with status "pass"
#   3. every resolved frame has its report/<frame>.json on disk
#
# Phase 2 — invocation contract: a malformed RATIO must fail fast (exit 2)
# with a fresh summary recording the error — never a silent pass, and never a
# NaN that serializes to a null ratio inside the JSON.
#
# Phase 3 — host-arm contract: with docker unavailable and no resolvable
# Playwright binary, the host arm must fail fast with an environment summary
# (exit 2), not a bare "command not found" that leaves no contract record.
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
  [[ -n "$frame" ]] && FRAMES="$FRAMES $frame"
done <<< "$FRAME_KEYS"

echo "check-multiframe: frames:${FRAMES}  RATIO=$RATIO  BASE_URL=$BASE_URL"

# Phase 1 — every frame compared and passed.
ATOM_EXIT=0
VISUAL_PAGE="" VISUAL_RATIO="$RATIO" E2E_WEB_BASE_URL="$BASE_URL" \
  bash "$REPO_ROOT/scripts/visual-check.sh" || ATOM_EXIT=$?
if [[ "$ATOM_EXIT" -gt 2 ]]; then
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
console.log("check-multiframe PASS (phase 1): every frame has a report, all pass, exitCode 0");
' "$REPORT_DIR/summary.json" "$REPORT_DIR" $FRAMES || exit 1

# Phase 2 — a malformed RATIO fails fast with a fresh error summary.
BAD_RATIO_EXIT=0
VISUAL_PAGE="" VISUAL_RATIO="oops" E2E_WEB_BASE_URL="$BASE_URL" \
  bash "$REPO_ROOT/scripts/visual-check.sh" || BAD_RATIO_EXIT=$?
if [[ "$BAD_RATIO_EXIT" -ne 2 ]]; then
  echo "check-multiframe FAIL: malformed RATIO exited $BAD_RATIO_EXIT (expected 2)" >&2
  exit 1
fi
node --no-warnings -e '
const fs = require("node:fs");
const summary = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const problems = [];
if (summary.exitCode !== 2) problems.push(`summary.exitCode=${summary.exitCode} (expected 2)`);
if (!summary.error || !/ratio/i.test(summary.error)) problems.push(`summary.error=${summary.error} (expected a ratio error)`);
if (summary.invocation.ratio !== null) problems.push(`summary.invocation.ratio=${summary.invocation.ratio} (expected null for a malformed RATIO)`);
if (problems.length > 0) {
  console.error("check-multiframe FAIL (phase 2):\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-multiframe PASS (phase 2): malformed RATIO fails fast, exitCode 2, error recorded");
' "$REPORT_DIR/summary.json" || exit 1

# Phase 3 — host arm with no resolvable Playwright binary fails fast.
HOST_FAIL_EXIT=0
VISUAL_PLAYWRIGHT_BIN="$REPO_ROOT/e2e/.nonexistent-playwright-bin" \
VISUAL_PAGE="landing" E2E_WEB_BASE_URL="$BASE_URL" \
  PATH="$REPO_ROOT/e2e/.stub-bin:$PATH" \
  bash "$REPO_ROOT/scripts/visual-check.sh" || HOST_FAIL_EXIT=$?
if [[ "$HOST_FAIL_EXIT" -ne 2 ]]; then
  echo "check-multiframe FAIL: host arm with missing playwright exited $HOST_FAIL_EXIT (expected 2)" >&2
  exit 1
fi
node --no-warnings -e '
const fs = require("node:fs");
const summary = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const problems = [];
if (summary.exitCode !== 2) problems.push(`summary.exitCode=${summary.exitCode} (expected 2)`);
if (!summary.error || !/playwright/i.test(summary.error)) problems.push(`summary.error=${summary.error} (expected a playwright-path error)`);
if (problems.length > 0) {
  console.error("check-multiframe FAIL (phase 3):\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-multiframe PASS (phase 3): host arm fails fast when no playwright binary resolves");
' "$REPORT_DIR/summary.json" || exit 1

echo "check-multiframe PASS: all contract phases green"
