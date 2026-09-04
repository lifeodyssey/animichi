#!/usr/bin/env bash
# Visual pipeline task atom (S0-v2 F2): parameterized, re-entrant wrapper over
# the @visual Playwright project. Resolves frames through the registry, runs
# each frame (docker arm when available), then writes the machine-readable
# contract e2e/visual/report/summary.json on EVERY path — including
# invocation failures — so no stale file can be misread as this run's verdict.
#
# Exit code: 0 pass / 1 visual diff / 2 environment or invocation problem.
# Through `make` GNU make remaps any recipe failure to its own exit 2, so the
# authoritative verdict is summary.json: `exitCode` (0/1/2) + `error`.
#
# Invocation contract: RATIO must be a finite number in (0, 1]. The wrapper
# pre-filters typos before any docker run; the summarize CLI re-validates
# finiteness and range on every path, so a malformed RATIO always lands as a
# fresh exitCode-2 summary with an error, never as NaN→null inside the JSON.
#
# Host arm: Playwright resolves from e2e/node_modules (the documented e2e
# setup: `cd e2e && npm ci`), falling back to the workspace-root bin; if
# neither exists the arm fails fast with an environment summary (exit 2)
# instead of a bare "command not found" with no contract record.
#
# Usage: make visual-check [PAGE=landing] [MODE=day] [RATIO=0.01]
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VISUAL_DIR="$REPO_ROOT/e2e/visual"
REPORT_DIR="$VISUAL_DIR/report"
E2E_DIR="$REPO_ROOT/e2e"
PLAYWRIGHT_BIN="${VISUAL_PLAYWRIGHT_BIN:-}"
if [[ -z "$PLAYWRIGHT_BIN" ]]; then
  PLAYWRIGHT_BIN="$E2E_DIR/node_modules/.bin/playwright"
  if [[ ! -x "$PLAYWRIGHT_BIN" ]]; then
    PLAYWRIGHT_BIN="$REPO_ROOT/node_modules/.bin/playwright"
  fi
fi

PAGE="${VISUAL_PAGE:-${PAGE:-}}"
MODE="${VISUAL_MODE:-${MODE:-day}}"
RATIO="${VISUAL_RATIO:-${RATIO:-0.01}}"
IMAGE="${VISUAL_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.62.0-noble}"
BASE_URL="${E2E_WEB_BASE_URL:-http://localhost:3000}"

echo "visual-check: PAGE='${PAGE:-<all frames>}' MODE=$MODE RATIO=$RATIO"

# 1. Stale-file doctrine. report/ is never cleared from the host shell: rm on
#    a Docker Desktop bind mount can leave the VM's dentry cache holding
#    deleted names, and the container's later write of the same name then
#    fails ENOENT (observed on the convergence tier). Instead the *runner*
#    clears report/ once, before the frame loop (container arm and host arm
#    each do it in step 6) — never per frame, or frame N+1 would delete frame
#    N's report and every frame but the last would be misread as "no
#    convergence report produced". Every host-side failure path still
#    overwrites summary.json with a fresh error summary — so a stale
#    summary.json can never be read as this run's verdict.
mkdir -p "$REPORT_DIR"

# 2. Invocation pre-filter: a malformed RATIO is an invocation error, fail
#    fast before any docker run. The summarize CLI re-validates finiteness
#    and range on every path (authoritative); this regex only catches typos.
if ! [[ "$RATIO" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  node --no-warnings --experimental-strip-types "$VISUAL_DIR/summarize-cli.ts" \
    --page "$PAGE" --mode "$MODE" --ratio "$RATIO" --base-url "$BASE_URL" --frames ""
  echo "visual-check: invocation error (exit 2)" >&2
  exit 2
fi

# 3. Canonicalize (idempotent: same inputs → byte-identical files). Runs here,
#    not as a make prerequisite, so this script owns every failure path and
#    each one ends in a fresh error summary.
if ! node --no-warnings --experimental-strip-types "$VISUAL_DIR/canonicalize-cli.ts" \
     --out "$VISUAL_DIR/canonical" --fonts "$REPO_ROOT/apps/web/src/styles/fonts.css"; then
  node --no-warnings --experimental-strip-types "$VISUAL_DIR/summarize-cli.ts" \
    --page "$PAGE" --mode "$MODE" --ratio "$RATIO" --base-url "$BASE_URL" \
    --error "visual-canonicalize failed" --frames ""
  exit 2
fi

# 4. Resolve frames through the registry (frames.ts) — one source of truth for
#    the PAGE/MODE → frame mapping. An unknown PAGE fails here; the error is
#    recorded in a fresh summary (exitCode 2), never left for a stale pass.
FRAMES_ERR="$REPORT_DIR/.frames-cli.err"
FRAME_OUT="$(node --no-warnings --experimental-strip-types "$VISUAL_DIR/frames-cli.ts" --page "$PAGE" --mode "$MODE" 2>"$FRAMES_ERR")"
if [[ $? -ne 0 ]]; then
  ERROR_MSG="$(cat "$FRAMES_ERR")"
  rm -f "$FRAMES_ERR"
  node --no-warnings --experimental-strip-types "$VISUAL_DIR/summarize-cli.ts" \
    --page "$PAGE" --mode "$MODE" --ratio "$RATIO" --base-url "$BASE_URL" \
    --error "$ERROR_MSG" --frames ""
  echo "visual-check: invocation error (exit 2)" >&2
  exit 2
fi
rm -f "$FRAMES_ERR"
FRAMES=()
while IFS= read -r frame; do
  [[ -n "$frame" ]] && FRAMES+=("$frame")
done <<< "$FRAME_OUT"

# 5. Probe the app once from the host. Unreachable → every app tier skips and
#    no pixel is compared; the summary must then report exitCode 2 (fail-
#    closed), never a green.
APP_REACHABLE=0
if curl -fsS -o /dev/null -m 5 "$BASE_URL/" 2>/dev/null; then
  APP_REACHABLE=1
else
  echo "visual-check: WARNING app not reachable at $BASE_URL — no comparison will run"
fi

# 6. Container reachability. With --network host on Docker Desktop the
#    container's loopback is the Linux VM's, not the host's, so a host-bound
#    app must be reached through the host gateway IP (vite allows raw-IP Host
#    headers; Chromium connects to the literal IP). On Linux host-network the
#    original URL works and is kept. If neither works the spec skips the app
#    tiers and the frames are reported skipped.
container_fetch_ok() {
  local url="$1"
  docker run --rm --network host "$IMAGE" node -e \
    "fetch('${url}/',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  return $?
}
container_gateway_ip() {
  docker run --rm --network host "$IMAGE" node -e \
    "require('node:dns').lookup('host.docker.internal',{family:4},(e,a)=>{if(e){process.exit(1)}process.stdout.write(a)})"
  return $?
}
container_port_of() {
  local url="$1"
  case "$url" in
    http://localhost:*) echo "${url#http://localhost:}" ;;
    http://127.0.0.1:*) echo "${url#http://127.0.0.1:}" ;;
    http://\[::1\]:*) echo "${url#http://[::1]:}" ;;
    *) return 1 ;;
  esac
}
container_gateway_alias() {
  local url="$1" port="$2" rest scheme ip
  rest="${url#*:${port}}"
  scheme="${url%%://*}"
  ip="$(container_gateway_ip)" || return 1
  echo "${scheme}://${ip}:${port}${rest}"
}
resolve_container_url() {
  local url="$1" port alias_url
  if container_fetch_ok "$url"; then echo "$url"; return 0; fi
  port="$(container_port_of "$url")" || return 1
  alias_url="$(container_gateway_alias "$url" "$port")" || return 1
  if container_fetch_ok "$alias_url"; then echo "$alias_url"; return 0; fi
  return 1
}

# 7. One playwright run per frame, preserving the C3 docker/host split. The
#    report/ clear is a single runner-side step BEFORE the loop (never inside
#    it): per-frame reports are per-run artifacts, so deleting them on frame
#    N+1 would destroy frame N's verdict.
RUN_SPEC=""
CONTAINER_REACHABLE=0
if docker info >/dev/null 2>&1; then
  RUNNER="docker"
  echo "visual-check: running in Playwright docker image $IMAGE"
  if ! docker run --rm --network host \
       -v "$REPO_ROOT":/work -w /work/e2e \
       "$IMAGE" sh -c "rm -rf visual/report"; then
    node --no-warnings --experimental-strip-types "$VISUAL_DIR/summarize-cli.ts" \
      --page "$PAGE" --mode "$MODE" --ratio "$RATIO" --base-url "$BASE_URL" \
      --error "visual report clear failed in the docker runner" --frames ""
    echo "visual-check: environment error (exit 2)" >&2
    exit 2
  fi
  CONTAINER_BASE_URL="$(resolve_container_url "$BASE_URL")" || true
  if [[ -n "$CONTAINER_BASE_URL" ]]; then
    CONTAINER_REACHABLE=1
  else
    CONTAINER_BASE_URL="$BASE_URL"
    echo "visual-check: WARNING app not reachable from the docker runner — app tiers will skip"
  fi
  for frame in "${FRAMES[@]}"; do
    echo "visual-check: frame $frame"
    docker run --rm --network host \
      -v "$REPO_ROOT":/work -w /work/e2e \
      -e VISUAL_CHECK=1 -e VISUAL_PAGE="$frame" -e VISUAL_MODE="$MODE" \
      -e VISUAL_RATIO="$RATIO" -e E2E_WEB_BASE_URL="$CONTAINER_BASE_URL" \
      "$IMAGE" sh -c "exec npx playwright test --project=visual --grep @visual"
    RUN_SPEC="$RUN_SPEC $frame=$?"
  done
else
  RUNNER="host"
  CONTAINER_BASE_URL="$BASE_URL"
  [[ "$APP_REACHABLE" = "1" ]] && CONTAINER_REACHABLE=1
  echo "WARNING: docker unavailable — visual baselines are host-rendered, not container-rendered"
  if [[ ! -x "$PLAYWRIGHT_BIN" ]]; then
    node --no-warnings --experimental-strip-types "$VISUAL_DIR/summarize-cli.ts" \
      --page "$PAGE" --mode "$MODE" --ratio "$RATIO" --base-url "$BASE_URL" \
      --error "host playwright not found at $PLAYWRIGHT_BIN (run make e2e-setup)" --frames ""
    echo "visual-check: environment error (exit 2)" >&2
    exit 2
  fi
  (cd "$E2E_DIR" && rm -rf visual/report)
  for frame in "${FRAMES[@]}"; do
    echo "visual-check: frame $frame"
    (cd "$E2E_DIR" && VISUAL_CHECK=1 VISUAL_PAGE="$frame" VISUAL_MODE="$MODE" \
      VISUAL_RATIO="$RATIO" E2E_WEB_BASE_URL="$BASE_URL" \
      "$PLAYWRIGHT_BIN" test --project=visual --grep @visual)
    RUN_SPEC="$RUN_SPEC $frame=$?"
  done
fi

# 8. Reachability — the named three-state concept the summary reasons on.
if [[ "$APP_REACHABLE" = "1" ]] && [[ "$CONTAINER_REACHABLE" = "1" ]]; then
  REACH="compared"
elif [[ "$APP_REACHABLE" = "1" ]]; then
  REACH="runner-blocked"
else
  REACH="app-down"
fi

# 9. Summarize — always runs, always writes a fresh summary; its exit code is
#    the atom verdict (0/1/2) and the script's.
node --no-warnings --experimental-strip-types "$VISUAL_DIR/summarize-cli.ts" \
  --page "$PAGE" --mode "$MODE" --ratio "$RATIO" --base-url "$BASE_URL" \
  --runner "$RUNNER" --reachability "$REACH" --frames "$RUN_SPEC"
