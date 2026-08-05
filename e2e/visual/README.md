# Visual Pipeline (S0-v2 C3)

Pixel-level comparison of the TanStack web app against the design mockups in
`docs/design/` and `docs/mockups/`. Machinery card: one frame
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
| `landing-day` | `docs/design/2026-07-06-design-sync/Landing - Seichijunrei.html` | `/` | 1280×800 | day |
| `landing-night` | same | `/` | 1280×800 | night |

Adding a frame = one entry in `e2e/visual/frames.ts` (key, mockup path,
route, viewport, mode) + `make visual-canonicalize` + accepting baselines.

## Commands

From the repo root:

```
make visual-check                      # PAGE=landing-day MODE=day RATIO=0.01
make visual-check PAGE=landing-night   # the night frame
make visual-check PAGE=landing MODE=night   # partial key + MODE → landing-night
make visual-check RATIO=0.05           # loosen the pixel budget
make visual-canonicalize               # regenerate canonical/ from the mockups
```

A PAGE that is already a full frame key wins; otherwise PAGE-MODE is tried
("landing" + "night" → "landing-night").

`visual-check` canonicalizes first (idempotent: identical inputs produce
byte-identical files, so no git churn), then runs the `@visual` Playwright
project. With docker available it runs inside
`mcr.microsoft.com/playwright:v1.62.0-noble` (`--network host`, repo mounted);
without docker it runs on the host and prints a WARNING that baselines are
host-rendered. **Exit code is the comparison result** in both arms. The app
tier skips with a message when `E2E_WEB_BASE_URL` (default
`http://localhost:3000`) is unreachable — start it with `make dev-local`.

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

- First real diff ratio is recorded in `report/first-run.md` (generated) —
  treat it as the starting point, not a passing result.
- Fonts differ between mockup and app (Lora absent, weight synthesis
  400/600/800 → 500/700); a convergence fail may be font-only. Confirm with
  the cluster boxes before touching the app.
- `make visual-check` needs `pnpm install` to have run (the `e2e/node_modules`
  must exist for the docker arm).
