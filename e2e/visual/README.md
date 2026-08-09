# Visual Pipeline (S0-v2 C3)

Pixel-level comparison of the TanStack web app against the design mockups in
`docs/archive/design-sync/` and `docs/archive/mockups-demo/`. Machinery card: one frame
(`landing-day`) proven end-to-end; frame convergence is a later card.

## The two-tier doctrine

Every frame is checked on two independent axes:

| Tier | Compares | Baseline | Fail means | Threshold |
|---|---|---|---|---|
| **Convergence** | app screenshot vs canonical mockup screenshot | frozen canonical HTML (committed) | the app has drifted from the approved mockup | pixel ratio ≤ `VISUAL_RATIO` (default `0.01`, i.e. 1% of pixels) |
| **Regression** | app screenshot vs its accepted baseline | `toHaveScreenshot` baseline (committed) | the app changed since its last accepted state | `maxDiffPixelRatio` = `VISUAL_RATIO` |

Convergence answers *"are we building the right thing?"*; regression answers
*"did we break what was accepted?"*. They are deliberately independent:
regression can stay green while convergence is red (app still matches its old
state, but the mockup moved) and vice versa (app changed, still within the
mockup budget).

Tier artifacts per frame `f`, all under `e2e/visual/`:

```
canonical/f.html            frozen canonical mockup (committed, deterministic)
canonical/assets/…          mockup images copied at canonicalize time
canonical-shots/f.png       canonical render at the frame viewport (generated)
app-shots/f.png             app render at the same viewport (generated)
report/f.diff.png           diff heatmap: differing pixels red (generated)
report/f.json               ratio + top-20 diff-cluster bounding boxes (generated)
regression-baselines/       toHaveScreenshot baselines (committed, per platform)
```

`report/f.json` is the machine-readable handoff: `{frame, width, height,
ratio, threshold, pass, clusters:[{x,y,width,height,area}…]}`. A text-model
executor (the convergence card) can act on the cluster boxes without reading
the heatmap.

## Frames

| Frame | Mockup | App route | Viewport | Mode |
|---|---|---|---|---|
| `landing-day` | `docs/archive/design-sync/Landing - Seichijunrei.html` | `/` | 1280×800 | day |
| `landing-night` | same | `/` | 1280×800 | night |

Adding a frame = one entry in `e2e/visual/frames.ts` (key, mockup path,
route, viewport, mode) + `make visual-canonicalize` + accepting baselines.

## Commands

From the repo root:

```
make visual-check                      # every frame in the registry
make visual-check PAGE=landing          # partial key → landing-day
make visual-check PAGE=landing-night    # a full frame key wins
make visual-check PAGE=landing MODE=night   # partial key + MODE → landing-night
make visual-check RATIO=0.05            # loosen the pixel budget (threshold config)
make visual-canonicalize               # regenerate canonical/ from the mockups
make visual-check-self-test            # shell-boundary contract check: no PAGE,
                                       # every frame must have a report and pass
```

A PAGE that is already a full frame key wins; otherwise PAGE-MODE is tried
("landing" + "night" → "landing-night"). No PAGE means the whole registry
(landing-day + landing-night today).

`visual-check` canonicalizes first (idempotent: identical inputs produce
byte-identical files, so no git churn), then runs the `@visual` Playwright
project once per frame. With docker available it runs inside
`mcr.microsoft.com/playwright:v1.62.0-noble` (`--network host`, repo mounted);
without docker it runs on the host and prints a WARNING that baselines are
host-rendered. The host arm resolves Playwright from `e2e/node_modules`
(the documented e2e setup), falling back to the workspace-root
`node_modules/.bin/playwright`, and fails fast with an environment summary
(`exitCode: 2`) if neither exists. The wrapper resolves the app URL the
runner can actually reach:
under Docker Desktop the container's loopback is the Linux VM's, so a
host-bound app is reached via the `host.docker.internal` gateway IP (vite
accepts raw-IP Host headers; Linux host-network keeps the original URL).
**Exit code is the comparison result** in both arms. When `E2E_WEB_BASE_URL`
(default `http://localhost:3000`) is unreachable the app tiers skip and the
atom fails closed (`summary.exitCode` 2 — see the result contract below):
start the app with `make dev-local`.

The plain suite (`make e2e`) does not run the pixel tiers: the visual suite is
opt-in via `VISUAL_CHECK=1` (which `visual-check` sets). Its pure-module unit
tests (`e2e/visual/units.spec.ts`) do run in the plain suite.

## Determinism contract

`canonicalize.ts` is a pure transform — same inputs, byte-identical output.
Invariants enforced on every canonical page:

1. **No network fonts** — Google Fonts links and the mockup's CDN
   `assets/fonts.css` are dropped; the app's self-hosted `@font-face` CSS
   (`apps/web/src/styles/fonts.css`) is inlined verbatim. The local test
   server serves `/fonts/…` from `apps/web/public/fonts`, so both sides of a
   comparison render the same font files. Fonts the app does not self-host
   (e.g. the mockup's Lora) fall back per the mockup's own stack (Georgia).
2. **No scripts** — all `<script>` tags are stripped (scene-cut, image-slot,
   login, mode-toggle).
3. **No dev chrome** — the `#modeTg` day/night toggle is removed.
4. **No motion** — an injected style kills animations/transitions
   unconditionally, plus a `prefers-reduced-motion` block; the Playwright
   project also emulates `reducedMotion: "reduce"` and screenshots with
   `animations: "disabled"`.
5. **Mode is baked into the bytes** — night frames get `class="night"` on
   `<body>`, day frames nothing. No localStorage, no clicks.

The app side gets the same treatment: `reducedMotion: "reduce"`,
`serviceWorkers: "block"` (the app ships a `sw.js`), `animations: "disabled"`
on every screenshot, fonts awaited via `document.fonts.ready`, and the
splash's CSS-driven dismissal awaited (`[data-splash="static"]` hidden).

## Result contract (task atom, F2)

`visual-check` is a re-entrant task atom: same invocation shape every time,
machine-readable output, exit code as verdict. An orchestration layer can
dispatch it without touching the pipeline.

**Inputs** — make variables, each with a pipeline default; none required:

| Var | Default | Meaning |
|---|---|---|
| `PAGE` | empty = all frames | full frame key (`landing-night`) or partial key (`landing`) |
| `MODE` | `day` | frame mode, used only for partial keys |
| `RATIO` | `0.01` | the pixel budget (threshold). It is config: read from this variable, forwarded as `VISUAL_RATIO`, never recomputed per frame. Must be a finite number in `(0, 1]` — a malformed value is an invocation error (`exitCode: 2` with `error`), never a silent `NaN`→`null` in the JSON. The wrapper pre-filters typos before any docker run; the summarize CLI re-validates finiteness and range on every path (authoritative) |
| `E2E_WEB_BASE_URL` | `http://localhost:3000` | app under test |

**Outputs**:

- **`e2e/visual/report/summary.json` is the single authoritative verdict.**
  It is written fresh on *every* invocation path — a normal run, a visual
  diff, or an invocation failure (`exitCode: 2` with an `error` message) —
  and the per-frame reports are cleared by the *runner* once, before the
  frame loop (the docker container and the host arm each do
  `rm -rf visual/report` first). The clear is deliberately NOT inside the
  loop: per-frame reports are per-run artifacts, so clearing on frame N+1
  would delete frame N's report and every frame but the last would be
  misreported as "no convergence report produced". report/ is never cleared
  from the host shell: rm on a Docker Desktop bind mount can leave the VM's
  dentry cache holding deleted names, and the container's later write of the
  same name then fails ENOENT (observed on the convergence tier). The
  stale-file guarantee is the combination: fresh per-frame JSON per run + a
  fresh summary.json on every path, including failures. `runId` (ISO
  timestamp) is echoed on the last stdout line and stored in the JSON; a
  dispatcher that wants to guard against interleaved runs compares the two.
  Because of `runId`, repeated runs are verdict-identical but not
  byte-identical.
- **Exit code semantics** — three states, distinguished by `summary.exitCode`:

  | `exitCode` | Meaning | When |
  |---|---|---|
  | `0` | pass | every frame compared and under threshold |
  | `1` | visual diff | ≥1 frame failed (ratio over threshold, or a nonzero playwright/runner exit) |
  | `2` | environment or invocation | no frames resolved (unknown `PAGE`), a malformed `RATIO`, **or** ≥1 frame produced no comparison (app unreachable, app unreachable from the docker runner, missing convergence report) — fail-closed: zero compared pixels is never green |

  `scripts/visual-check.sh` exits 0/1/2 directly. Invoked through `make`, GNU
  make remaps *any* recipe failure to its own exit `2` (still nonzero) — the
  1-vs-2 distinction survives only in `summary.exitCode`, which is why it is
  the contract.
- **Per-frame detail** — `summary.frames[]` carries each frame's `status`
  (`pass`/`fail`/`skipped`), `ratio`, `threshold`, and `reason`; `failedFrames`
  and `skippedFrames` are the flat lists; `invocation` echoes the inputs and
  the resolved frame order. Pixel-level detail (diff heatmap + cluster boxes)
  stays in `report/<frame>.json`.
- Human progress on stdout; the last line is the one-line verdict including
  the `runId`.

Orchestration recipe: run the atom, read `report/summary.json`; branch on
`summary.exitCode` — `2` → stop (read `summary.error` or each skipped frame's
`reason`: app down, runner blocked, or bad `PAGE`); `1` → act per
`summary.failedFrames` (each failing frame's `reason` names the threshold
breach or the runner exit); `0` → green. The dispatcher can act without
re-reading heatmaps.

> **TODO (convergence card, C4):** under the default `RATIO=0.01` the frames
> are **not converged yet** — `landing-day` sits around `0.964` of pixels
> differing from the mockup (font + layout work, see Known gaps below). The
> atom reports that honestly as `exitCode 1`; converging the frames to
> `0.01` is the convergence card's job, **not** this atom's. Until C4 lands,
> acceptance runs must pass an explicit loose `RATIO` (e.g.
> `make visual-check PAGE=landing RATIO=0.9999`). The default `RATIO` is
> pipeline config and must not be loosened here.

## Contract self-test

`make visual-check-self-test` (`e2e/visual/check-multiframe.sh`) is the
shell-boundary check that the unit layer cannot provide. Three phases:

1. **Multi-frame contract** — runs the atom WITHOUT `PAGE` (every frame in
   the registry) and asserts the contract end-to-end — every resolved frame
   has its `report/<frame>.json` on disk, every verdict is `pass`, and
   `summary.exitCode` is `0`. This is what catches a per-frame lifecycle
   regression like the clear-inside-the-loop bug (frame N+1 deletes frame
   N's report): the pure-module tests never see the shell, and a single-frame
   run never exercises the ordering.
2. **Invocation contract** — a malformed `RATIO` must fail fast (atom exit
   `2`) with a fresh summary whose `exitCode` is `2`, whose `error` names the
   ratio, and whose `invocation.ratio` is `null` — never a stale pass, never
   a silently coerced value.
3. **Host-arm contract** — with docker unavailable (the `e2e/.stub-bin/docker`
   stub) and no resolvable Playwright binary, the host arm fails fast with an
   environment summary (`exitCode: 2`), not a bare "command not found" that
   leaves no contract record.

The budget is loose on purpose (`RATIO=0.9999`, documented in the script):
the self-test verifies the *contract*, not frame *convergence* — converging
to the default `RATIO=0.01` is the C4 card. A loose budget still catches the
bug class: a skipped or missing report is a contract violation, not a
convergence matter. The Makefile `RATIO ?= 0.01` default is not touched.

Preconditions: docker + the Playwright image (or a resolvable host
Playwright binary) and a reachable app (`E2E_WEB_BASE_URL`, default
`http://localhost:3000` — start `make dev-local`). It is fail-closed: an
unreachable app makes the atom exit `2` and the self-test fails.

## Baseline policy

- `canonical/` — committed. Regenerate only when the mockup changes; review
  the diff like any source change.
- `regression-baselines/` — committed, per platform
  (`landing-day-darwin.png` vs `landing-day-linux.png`): a render accepted on
  a host must never silently gate docker/CI.
- `canonical-shots/`, `app-shots/`, `report/` — gitignored, rebuilt on every
  run.

**Owner-gated frame removal.** A frame is removed only via a PR that (a)
drops the entry from `e2e/visual/frames.ts`, (b) deletes its `canonical/`
HTML, its `regression-baselines/` and shots, (c) is approved by the visual
pipeline owner (product/design sign-off that the frame is truly dead). No
`VISUAL_FRAME`-style env carving exceptions; the table is the truth.

## Known gaps (convergence card)

- **Not converged under the default threshold — see the C4 TODO in the result
  contract above.** `landing-day` currently reports ~0.96 of pixels differing
  from the mockup; converging to `RATIO=0.01` is the convergence card's work
  (this card only made the atom callable and machine-honest about it).
- First real diff ratio is recorded in `report/first-run.md` (generated) —
  treat it as the starting point, not a passing result.
- Fonts differ between mockup and app (Lora absent, weight synthesis
  400/600/800 → 500/700); a convergence fail may be font-only. Confirm with
  the cluster boxes before touching the app.
- `make visual-check` needs the e2e deps installed: the docker arm mounts the
  repo and runs `npx playwright` inside the image with `e2e/node_modules`
  (`cd e2e && npm ci` via `make e2e-setup`, or `pnpm install` from the repo
  root); the host arm needs `e2e/node_modules/.bin/playwright` or the
  workspace-root `node_modules/.bin/playwright` and fails fast otherwise.
