# Pic-to-Code with Grounded-SAM Segmentation — Design Spec

**Date:** 2026-06-09
**Status:** Design approved (revised after Codex adversarial review), pending implementation plan

## Purpose

Turn one design image into working frontend through deterministic image
algorithms wherever possible, not LLM-as-judge. The skill segments a design
image into named regions, classifies each region, and routes it down one of
three paths: vectorize a graphic asset, align an existing component, or scaffold
a new component. Algorithmic gates plus one explicit human-review gate close the
loop.

Composes existing parts rather than reinventing them: `pixel-match`
(`render.cjs`, `score.py`, `target_extract.py` Grounded-SAM), `raster-to-svg`
(vtracer), Storybook + `@storybook/addon-designs`, and the managed Codex imagegen
backend (PR #357, via the baoyu adapter).

## Guiding principle (scoped after review)

**Geometry and measurable style are judged by deterministic algorithms; the LLM
only writes source text and is graded by those algorithms; visual correctness
beyond what can be measured goes through one explicit human-review gate.**

Three judgement tiers, in order:

1. **Geometry gate (algorithmic).** `score.py` over rect IoU, centroid distance,
   size ratio, overlap/containment. Authority for "is each region in the right
   place and size."
2. **Measurable-style gate (algorithmic).** Read from `getComputedStyle` on the
   measured nodes and compare against tokens: color, background, border-radius,
   box-shadow, font-family/size/weight, z-index ordering. These are checkable
   without an LLM and were missing from v1. They catch "passes geometry but looks
   wrong" for everything that reduces to a CSS value.
3. **Human-review gate (one explicit stop).** Whatever neither gate can score —
   overall taste, illustration fidelity, emotional fit. Generated edits are NOT
   considered shippable until a human approves at this gate. The skill surfaces
   before/after + score deltas for that decision.

The LLM appears only when writing/editing source. It never decides convergence.

## Scope

One skill, two modes (`align`, `scaffold`) sharing a segmentation core, plus a
third graphic-asset SVG branch.

## Architecture

```
        Shared algorithmic core (no LLM judgement):
codex target image ──▶ Grounded-SAM segmentation (detector prompts from the mapping
                        manifest; LLM only PROPOSES new prompts for uncatalogued regions)
                        each region → thick manifest entry + crop.png
                        crops → public/design-targets/<componentId>.png (Storybook tab)
                                          │
                            classifier per region (see Classifier section)
                            → graphic-asset | layout-component | UNCERTAIN(→manifest/human)
        ┌─────────────────────────┼──────────────────────────────┐
   [graphic asset]        [layout component · exists]      [layout component · new]
  crop → raster-to-svg    measure DOM rect + computed       crop → scaffold component
  (vtracer)                style (render.cjs)                (LLM writes v1)
  → <id>.svg              delta = target − current (geom)    register in registry/Storybook
  reuse-existing default  ① knob in component's knob table →
                            compute value & set (no LLM)
                          ② else → LLM edits source
        └─────────────────────────┴──────────────────────────────┘
                                          ▼
          render.cjs re-render → geometry gate + measurable-style gate (algorithmic)
                                          ▼  below gate → iterate ①; at gate → human-review gate
```

## Mapping manifest (replaces the v1 "names are equal" claim)

v1 assumed `Storybook name == data-measure == SAM label`. That collapses three
namespaces (variant descriptors, DOM instance IDs, open-vocab detector prompts)
and can align the wrong region while looking deterministic. Replaced with an
explicit, version-stamped mapping manifest, the single source of identity:

```
{
  manifestVersion: 1,
  components: [
    {
      componentId: "hero.sceneCard",        // stable identity, the join key
      storyId: "landing-hero-scenecard--default",
      dataMeasure: "card",                   // the render.cjs rect name
      detector: { prompts: ["before/after comparison photo card",
                            "tilted photo card"], aliases: [...] },
      kind: "layout-component",              // or graphic-asset
      cardinality: "1",                      // "1" | "0..1" | "n"; n needs instanceId
      knobs: [ ...see Component knob contract... ]
    },
    ...
  ]
}
```

Rules: identity is `componentId`, never a fuzzy name match. Duplicate/repeated
components carry an `instanceId`. Detection produces a candidate set; mapping
resolves by `componentId` via the manifest, and **hard-fails closed** on
ambiguous (multiple regions claim one `componentId` beyond its cardinality) or
missing (a required `componentId` has no region) mappings — it does not guess.

## Component knob contract (makes parametric-first executable)

For `align` ① to set a value without an LLM, the component must declare its
tunable knobs in the manifest:

```
knobs: [
  { name: "fox.size",  css: "--fox-w", unit: "px",  drivenBy: "bbox.width",
    min: 120, max: 280, breakpoints: { base: "...", lg: "..." } },
  { name: "fox.top",   css: "--fox-top", unit: "rem", drivenBy: "bbox.top" },
  { name: "card.maxW", css: "--card-max", unit: "px", drivenBy: "bbox.width" }
]
```

- A delta maps to a knob only if a knob declares `drivenBy` for that property;
  otherwise it is **structural** and escalates to the LLM-edit path.
- Knobs are CSS variables (responsive via breakpoint values), so setting one
  cannot silently break another width.
- After any knob set, **parent/sibling invariants** are checked (no overlap
  regressions, container still fits) at the verification breakpoints; a violation
  reverts the knob and escalates.

## Classifier (specified; algorithmic, fail-closed)

Routes each region to graphic-asset / layout-component / UNCERTAIN.

- **align mode:** the manifest's `kind` is authoritative. No inference.
- **scaffold mode (no manifest kind):** ordered features, all algorithmic —
  (1) edge/colour-histogram + alpha complexity (illustrations are high-entropy,
  non-rectilinear), (2) aspect/area heuristics, (3) presence of crisp text/UI
  chrome. Each yields a score; route only if the margin clears a confidence
  threshold.
- **UNCERTAIN** (low margin, or mixed region) → no mutation; require a manifest
  entry or human override first. Misroute is destructive, so the default is to
  stop, not guess.

## Coordinate system & manifest versioning (closes the producer/consumer skew)

All producers/consumers share one canonical space, stamped on every artifact:

- `manifestVersion` on `segmentation.json`; consumers reject mismatched versions
  (fail closed).
- Canonical coordinates: **normalized 0..1 against the target image's natural
  size**, plus the capture context (viewport, DPR, image natural WxH). px is
  derived, never stored as the source of truth.
- Defined conversions: SAM mask → bbox (tight, with documented padding), DOM
  rect → normalized (against the same reference width), rounding rule (half-up,
  fixed precision). `render.cjs` and `score.py` consume the same normalized space
  so a px-vs-normalized mismatch cannot score against the wrong geometry.

## I/O contract

**Inputs:** `target` (design image), `mode` (`align`|`scaffold`, auto: align if a
runnable surface + manifest exist), `surface` (URL/Storybook for align), `manifest`
(the mapping manifest; required for align, optional override for scaffold),
`config` (min confidence, geometry gate, style gate, max iterations).

**Outputs:** `segmentation.json` (versioned, normalized coords, per region:
componentId/instanceId, kind, bbox+centroid+ratio+area, crop path, confidence,
overlap/containment, relative layout); `public/design-targets/<id>.png` crops;
`<id>.svg` for graphic assets; code changes (align: edited components; scaffold:
new files + registry); `score.json` (geometry + measurable-style per component +
pass/fail); `iteration.log` (changes + score trajectory).

## Iteration safety (rollback / idempotency / stale artifacts)

Each run is a transaction:

- **Dry-run first:** produce the full diff (artifacts + code) without writing;
  apply only on confirmation / when the gates pass.
- **Workspace snapshot** (git stash/worktree marker) before mutation; on partial
  failure, roll back to it.
- **Idempotent artifacts:** crops/SVGs/registry entries keyed by `componentId`;
  re-runs overwrite-by-key, never append. Orphan crops/targets for components no
  longer in the manifest are detected and cleaned.
- **Artifact versioning:** every emitted file carries the producing
  `manifestVersion` so stale mixed-version artifacts are detectable and rejected.

## Cases / failure handling

| Case | Handling |
|---|---|
| SAM misses a region | `unmatched` in manifest; align skips + warns; never silently drop. Required componentId missing → hard-fail. |
| Low confidence | Below threshold → human-review, no auto-apply. |
| Overlap (fox on card) | Name match ambiguous → mask-IoU / containment tiebreaker; record centroid-vs-card-top relation. |
| Target text garbled (codex redraw) | Text not pixel-matched (`data-match-ignore`); copy from i18n dict, not the image. Only geometry/style aligned. |
| Target fox is a drawing, not the real SVG | Graphic-asset: `reuse-existing` (align transform only — DEFAULT) vs `vectorize-new` (explicit). |
| Vectorization quality | raster-to-svg tiers + magenta transparency check; flag if poor. |
| Scaffold boundaries | Self-contained block → component; nested (chip in search) attaches to parent per containment. |
| Align non-convergence | Max iterations without passing → stop, output best state + residual deltas as a manual punch-list; rollback uncommitted churn. |
| Responsive | Segment at reference width; verify at 2-3 breakpoints; a fix that breaks another width is reverted + flagged. |
| Misclassification risk | UNCERTAIN regions never mutate; require manifest/human override. |
| Partial run / rerun | Dry-run + snapshot + idempotent keyed artifacts (see Iteration safety). |

## Units (each: one purpose, interface, dependency)

Segmenter (Grounded-SAM) · Classifier · Vectorizer (raster-to-svg) · Measurer
(render.cjs: rects + computed style) · Delta engine (geometry) · Style checker
(computed-style vs tokens) · Align driver (knob-first, LLM-edit fallback) ·
Scaffold driver · Scorer (score.py: geometry + style gates) · Transaction/loop
(dry-run, snapshot, rollback, idempotent emit).

## Review log

- 2026-06-09 Codex adversarial-review (verdict: needs-attention) raised 6 issues:
  fragile naming equality, geometry-only judge, non-executable parametric
  contract, underspecified classifier, no rollback/idempotency, coordinate-system
  skew. All six folded into this revision (mapping manifest, three-tier judge +
  measurable-style gate, knob contract, specified classifier, iteration-safety
  section, canonical coordinate/version section).
