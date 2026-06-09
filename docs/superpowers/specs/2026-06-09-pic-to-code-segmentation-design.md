# Pic-to-Code with Grounded-SAM Segmentation — Design Spec

**Date:** 2026-06-09
**Status:** Design approved, pending implementation plan

## Purpose

Turn one design image into working frontend through deterministic image
algorithms, not LLM-as-judge. The skill segments a design image into named
regions, classifies each region, and routes it down one of three paths:
vectorize a graphic asset, align an existing component, or scaffold a new
component. An algorithmic score gate closes the loop.

The skill composes existing parts rather than reinventing them:

- `pixel-match` — `render.cjs` (DOM `data-measure` rects), `score.py` (3-layer
  geometric scoring), `target_extract.py` (Grounded-SAM = Grounding DINO + SAM).
- `raster-to-svg` — vtracer vectorization pipeline.
- Storybook + `@storybook/addon-designs` — component catalog + per-component
  design-target tab.
- Managed Codex imagegen (PR #357 backend, via the baoyu adapter) — generates
  the target image without the hang/quota problems of bare `codex exec`.

## Guiding principle

**Image-related judgement is done by deterministic image/geometry algorithms,
never by an LLM acting as judge.**

- Detection (Grounded-SAM), current-state measurement (`render.cjs` DOM rects),
  delta computation (geometry), convergence scoring (`score.py`: IoU, centroid
  distance, size ratio, overlap) are all algorithmic. No LLM judges "does this
  look right."
- The LLM appears in exactly one place: writing/editing source text. Two levers
  keep even that minimal:
  1. **Parametric components** — many adjustments become "rect → computed value
     → set a CSS variable / prop," no LLM at all.
  2. When the LLM must edit structure, the **judge is still `score.py`**. The LLM
     proposes; the algorithm grades and decides convergence.

## Scope

One skill, two modes, sharing a segmentation core:

- `align` — a component tree / running surface already exists. Segment the
  target, measure current rects, drive each component toward its target rect.
- `scaffold` — greenfield. Segment, classify, generate new component files.

Plus a third downstream branch off the segmentation core for **graphic assets**
(mascot/icon/decoration) that should become SVG, not React layout.

## Architecture

```
        Shared algorithmic core (no LLM judgement):
codex target image ──▶ Grounded-SAM segmentation
                        labels: Storybook component names (LLM only PROPOSES
                        labels for anything not already in the catalog)
                        each region → thick manifest entry + crop.png
                        crops → public/design-targets/<name>.png (Storybook tab)
                                          │
                            classifier per region: graphic-asset | layout-component
                            source of truth: Storybook component kind (align mode),
                            label semantics, region visual nature (heuristic, NOT LLM judge)
        ┌─────────────────────────┼──────────────────────────────┐
   [graphic asset]        [layout component · exists]      [layout component · new]
  crop → raster-to-svg    render.cjs measures DOM rect      crop → scaffold component
  (vtracer, deterministic) delta = target − current (geom)  (LLM writes v1, algo verifies)
  → <name>.svg            ① parametric → compute & set       register in registry/Storybook
  → component references     CSS var/prop (no LLM)
                          ② else → LLM edits source
        └─────────────────────────┴──────────────────────────────┘
                                          ▼
                  render.cjs re-render → score.py 3-layer score (algorithmic judge)
                                          ▼  below gate → iterate ①; at gate → stop
```

### Naming contract (what makes matching deterministic)

The same name is used on all three sides:

```
Storybook story name  ==  data-measure="<name>"  ==  Grounded-SAM label
```

Matching a target region to a concrete component is therefore a table lookup,
not a model guess. The only residual uncertainty is SAM's detection accuracy,
which every approach shares. Overlapping regions (fox on card) where name
alignment is ambiguous fall back to mask-IoU / containment, recording the
relation (fox centroid above card top = "draped on," not "sunk in").

## I/O contract

### Inputs

- `target` — the design image (source of truth).
- `mode` — `align` | `scaffold`. Auto-detect: `align` if the surface has an
  existing component tree / runnable page.
- `surface` — (align) running page URL or Storybook, for render + DOM measure.
- `manifest?` — optional override/constraint on labels or regions to find.
- `config` — thresholds: min detection confidence, score gate, max iterations.

### Outputs (artifacts)

- `segmentation.json` — per region: `{label, kind(graphic|component), bbox +
  centroid + ratio + area, crop path, confidence, overlap/containment, relative
  layout relations}`.
- `public/design-targets/<name>.png` — per-region crops, populate the Storybook
  Design tab.
- `<name>.svg` — vectorized graphic-asset output.
- Code changes — align: edited components; scaffold: new component files +
  registry entries.
- `score.json` — per-component L1/L2/L3 + composite + pass/fail vs gate.
- `iteration.log` — what changed each round + score trajectory (visible convergence).

## Cases / failure handling

| Case | Handling |
|---|---|
| SAM misses a region | Mark `unmatched` in manifest; align skips that component + warns; never silently drop (no silent caps). |
| Low confidence | Below threshold → flag for human review, do not auto-apply. |
| Overlap (fox on card corner) | Name alignment ambiguous → mask-IoU / containment tiebreaker; record centroid-vs-card-top relation. |
| Target image text garbled (codex redraw) | Text regions are NOT pixel-matched (`render.cjs` masks text via `data-match-ignore`); copy comes from the real i18n dict, not the image. Garbled glyphs are harmless; only geometry is aligned. |
| Target fox is a generated drawing, not the real SVG | Graphic-asset has two settings: `reuse-existing` (align size/position of the existing asset only — DEFAULT, the fox SVG has been iterated heavily) and `vectorize-new` (re-vectorize the crop, only on explicit request). |
| Vectorization quality | raster-to-svg fidelity tiers + magenta transparency check; flag if poor. |
| Scaffold component boundaries | Self-contained block → component; nested regions (chip in search area) attach to the parent per the manifest's containment relations. |
| Align does not converge | At max iterations without passing → stop, output best state + residual deltas as a manual punch-list (degrades to "suggestions only"). |
| Responsive | Segmentation done at one reference width; after alignment, verify at 2-3 breakpoints; warn if a fix breaks another width (e.g. fox overlapping chips at tablet). Never hardcode px that break mobile. |

## Units (each one purpose, interface, dependency)

- **Segmenter** — wraps `target_extract.py` (Grounded-SAM). In: image + labels.
  Out: thick manifest + crops. Dep: Grounding DINO + SAM env.
- **Classifier** — per region: graphic-asset vs layout-component. In: manifest
  entry + Storybook kind / label / region stats. Out: kind tag. Algorithmic.
- **Vectorizer** — wraps `raster-to-svg`. In: crop. Out: `<name>.svg` + quality
  verdict.
- **Measurer** — wraps `render.cjs`. In: running surface. Out: current DOM rects
  by `data-measure` name.
- **Delta engine** — geometry only. In: target rect + current rect. Out: deltas
  (position / size / ratio / overlap relation).
- **Align driver** — parametric-first; LLM-edit fallback. In: delta + component
  source. Out: edited source.
- **Scaffold driver** — In: crop + manifest entry. Out: new component file +
  registry entry.
- **Scorer** — wraps `score.py`. In: re-rendered rects vs target rects. Out:
  L1/L2/L3 + composite + pass/fail. The single source of "is it aligned yet."
- **Loop** — drives iterate-until-gate or max-iterations.

## Open items for the implementation plan

- Exact `segmentation.json` schema fields and units (normalized vs px).
- Classifier heuristic specifics (how Storybook kind is read; greenfield rules).
- Parametric-component conventions (which knobs components must expose so the
  align driver can set values without an LLM).
- Score gate thresholds per layer and per component class.
- Breakpoint set for responsive verification.
