# Pic-to-Code Plan 5: Align Driver (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** The parametric align driver. Given target regions and a per-component knob contract, compute each knob's value deterministically from the target geometry, detect conflicts, enforce a no-overlap-regression invariant, and run an iterate-until-converged loop whose measure/score/apply are injected (so the algorithm is unit-tested without a browser). A documented integration entry wires the real `render.cjs` + gate for the hero acceptance.

**Architecture:** New module `picode/align.py`. `Knob` (pydantic) declares how a normalized geometry property drives a CSS variable. Pure functions compute values, detect conflicts, and check invariants. `align_loop` takes injected `measure`/`score`/`apply` callables so convergence and max-iterations are testable with fakes. Composes plan-1 `coords`/`manifest` and plan-4 `gate`.

**Tech Stack:** Python 3.12, pydantic v2, pytest.

---

## File Structure

- `~/.claude/skills/pic-to-code/src/picode/align.py`
- `~/.claude/skills/pic-to-code/tests/test_align.py`

`$ROOT = ~/.claude/skills/pic-to-code`.

---

### Task 1: Knob schema + compute_knob_value (px / rem, clamp)

**Files:** Create `$ROOT/src/picode/align.py`; Test `$ROOT/tests/test_align.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_align.py
import pytest
from picode.coords import Box
from picode.manifest import Region
from picode.align import Knob, compute_knob_value


def _region(box):
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    return Region(component_id="hero.fox", kind="graphic-asset", bbox=box,
                  centroid=(cx, cy), confidence=1.0)


def test_compute_knob_value_px_from_bbox_width():
    # normalized bbox width 0.2, reference width 2000 -> 400px
    target = _region(Box(0.5, 0.1, 0.2, 0.15))
    knob = Knob(name="fox.w", css_var="--fox-w", unit="px",
                driven_by="bbox.width", min=120, max=400)
    assert compute_knob_value(knob, target, ref_w=2000, ref_h=1000) == 400.0


def test_compute_knob_value_rem_from_bbox_top():
    # normalized y 0.1, ref height 1000 -> 100px -> 100/16 = 6.25rem
    target = _region(Box(0.5, 0.1, 0.2, 0.15))
    knob = Knob(name="fox.top", css_var="--fox-top", unit="rem",
                driven_by="bbox.y", min=0, max=50)
    assert compute_knob_value(knob, target, ref_w=2000, ref_h=1000) == 6.25


def test_compute_knob_value_clamps_to_max():
    target = _region(Box(0.5, 0.1, 0.9, 0.15))  # 0.9 * 2000 = 1800 px
    knob = Knob(name="fox.w", css_var="--fox-w", unit="px",
                driven_by="bbox.width", min=120, max=400)
    assert compute_knob_value(knob, target, ref_w=2000, ref_h=1000) == 400.0  # clamped
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_align.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.align'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/align.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from picode.manifest import Region

DrivenBy = Literal[
    "bbox.width", "bbox.height", "bbox.x", "bbox.y", "centroid.x", "centroid.y"
]
Unit = Literal["px", "rem"]


class Knob(BaseModel):
    name: str
    css_var: str
    unit: Unit
    driven_by: DrivenBy
    min: float
    max: float


def _norm_value(region: Region, driven_by: DrivenBy) -> float:
    b = region.bbox
    return {
        "bbox.width": b.w,
        "bbox.height": b.h,
        "bbox.x": b.x,
        "bbox.y": b.y,
        "centroid.x": region.centroid[0],
        "centroid.y": region.centroid[1],
    }[driven_by]


def compute_knob_value(
    knob: Knob, target: Region, ref_w: int, ref_h: int, rem_base: int = 16
) -> float:
    norm = _norm_value(target, knob.driven_by)
    ref = ref_w if knob.driven_by in ("bbox.width", "bbox.x", "centroid.x") else ref_h
    px = norm * ref
    value = px if knob.unit == "px" else px / rem_base
    return float(min(knob.max, max(knob.min, value)))
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_align.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(align): Knob schema + compute_knob_value (px/rem, clamped)"
```

---

### Task 2: plan_knob_settings + conflict detection (fail-closed)

**Files:** Modify `$ROOT/src/picode/align.py`; Test `$ROOT/tests/test_align.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.align import plan_knob_settings


def test_plan_knob_settings_maps_each_knob_to_value():
    target = _region(Box(0.5, 0.1, 0.2, 0.15))
    knobs = [
        Knob(name="fox.w", css_var="--fox-w", unit="px", driven_by="bbox.width", min=0, max=999),
        Knob(name="fox.top", css_var="--fox-top", unit="rem", driven_by="bbox.y", min=0, max=99),
    ]
    settings = plan_knob_settings(knobs, target, ref_w=2000, ref_h=1000)
    assert settings == {"--fox-w": 400.0, "--fox-top": 6.25}


def test_plan_knob_settings_rejects_conflicting_driven_by():
    target = _region(Box(0.5, 0.1, 0.2, 0.15))
    knobs = [
        Knob(name="a", css_var="--a", unit="px", driven_by="bbox.width", min=0, max=999),
        Knob(name="b", css_var="--b", unit="px", driven_by="bbox.width", min=0, max=999),
    ]
    with pytest.raises(ValueError, match="conflict"):
        plan_knob_settings(knobs, target, ref_w=2000, ref_h=1000)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_align.py -k plan_knob -q`
Expected: FAIL — `ImportError: cannot import name 'plan_knob_settings'`.

- [ ] **Step 3: Write minimal implementation (append to align.py)**

```python
def plan_knob_settings(
    knobs: list[Knob], target: Region, ref_w: int, ref_h: int
) -> dict[str, float]:
    seen: dict[str, str] = {}  # driven_by -> css_var
    out: dict[str, float] = {}
    for knob in knobs:
        if knob.driven_by in seen:
            raise ValueError(
                f"conflict: {knob.css_var} and {seen[knob.driven_by]} both drive "
                f"{knob.driven_by}"
            )
        seen[knob.driven_by] = knob.css_var
        out[knob.css_var] = compute_knob_value(knob, target, ref_w, ref_h)
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_align.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(align): plan_knob_settings + fail-closed conflict detection"
```

---

### Task 3: no-overlap-regression invariant

A knob change must not introduce a NEW overlap between two regions that did not overlap before (this is what catches "fixed one bbox but the fox now covers the chips").

**Files:** Modify `$ROOT/src/picode/align.py`; Test `$ROOT/tests/test_align.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.align import overlap_regression


def _r(cid, box):
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    return Region(component_id=cid, kind="layout-component", bbox=box,
                  centroid=(cx, cy), confidence=1.0)


def test_overlap_regression_detects_new_overlap():
    before = [_r("fox", Box(0.7, 0.1, 0.1, 0.1)), _r("chips", Box(0.1, 0.6, 0.3, 0.1))]
    # after: fox grew and now overlaps chips
    after = [_r("fox", Box(0.05, 0.55, 0.4, 0.2)), _r("chips", Box(0.1, 0.6, 0.3, 0.1))]
    assert overlap_regression(before, after, iou_threshold=0.01) == [("fox", "chips")]


def test_overlap_regression_none_when_no_new_overlap():
    before = [_r("fox", Box(0.7, 0.1, 0.1, 0.1)), _r("chips", Box(0.1, 0.6, 0.3, 0.1))]
    after = [_r("fox", Box(0.72, 0.1, 0.09, 0.09)), _r("chips", Box(0.1, 0.6, 0.3, 0.1))]
    assert overlap_regression(before, after, iou_threshold=0.01) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_align.py -k overlap_regression -q`
Expected: FAIL — `ImportError: cannot import name 'overlap_regression'`.

- [ ] **Step 3: Write minimal implementation (append to align.py)**

```python
from itertools import combinations

from picode.gate import _iou


def overlap_regression(
    before: list[Region], after: list[Region], iou_threshold: float
) -> list[tuple[str, str]]:
    def overlaps(regs: list[Region]) -> set[tuple[str, str]]:
        out = set()
        for a, b in combinations(regs, 2):
            if _iou(a.bbox, b.bbox) >= iou_threshold:
                out.add(tuple(sorted((a.component_id, b.component_id))))
        return out

    new = overlaps(after) - overlaps(before)
    return [tuple(p) for p in sorted(new)]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_align.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(align): overlap_regression invariant (catches fox-covers-chips)"
```

---

### Task 4: align_loop with injected measure/score/apply

The convergence loop. `measure()` returns current regions by component_id; `score(target, current)` returns pass/fail per component; `apply(settings)` mutates the surface. Injecting these makes the loop deterministic and browser-free in tests.

**Files:** Modify `$ROOT/src/picode/align.py`; Test `$ROOT/tests/test_align.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.align import align_loop, AlignResult


def test_align_loop_converges_then_stops():
    target = _region(Box(0.5, 0.1, 0.2, 0.15))
    knobs = [Knob(name="fox.w", css_var="--fox-w", unit="px",
                  driven_by="bbox.width", min=0, max=999)]
    calls = {"apply": 0}

    def apply(settings):
        calls["apply"] += 1  # pretend we mutated the surface

    # score passes on the 2nd measure (simulate convergence after one apply)
    state = {"n": 0}

    def measure():
        return {"hero.fox": target}

    def score(tgt, cur):
        state["n"] += 1
        return state["n"] >= 2  # fail first check, pass second

    res = align_loop(
        targets={"hero.fox": target}, knobs_by_id={"hero.fox": knobs},
        measure=measure, score=score, apply=apply,
        ref_w=2000, ref_h=1000, max_iter=5,
    )
    assert isinstance(res, AlignResult)
    assert res.converged is True
    assert res.iterations == 2
    assert calls["apply"] == 1  # applied once before the passing measure


def test_align_loop_gives_up_at_max_iter():
    target = _region(Box(0.5, 0.1, 0.2, 0.15))
    knobs = [Knob(name="fox.w", css_var="--fox-w", unit="px",
                  driven_by="bbox.width", min=0, max=999)]
    res = align_loop(
        targets={"hero.fox": target}, knobs_by_id={"hero.fox": knobs},
        measure=lambda: {"hero.fox": target},
        score=lambda tgt, cur: False,  # never converges
        apply=lambda settings: None,
        ref_w=2000, ref_h=1000, max_iter=3,
    )
    assert res.converged is False
    assert res.iterations == 3
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_align.py -k align_loop -q`
Expected: FAIL — `ImportError: cannot import name 'align_loop'`.

- [ ] **Step 3: Write minimal implementation (append to align.py)**

```python
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class AlignResult:
    converged: bool
    iterations: int


def align_loop(
    targets: dict[str, Region],
    knobs_by_id: dict[str, list[Knob]],
    measure: Callable[[], dict[str, Region]],
    score: Callable[[Region, Region], bool],
    apply: Callable[[dict[str, float]], None],
    ref_w: int,
    ref_h: int,
    max_iter: int,
) -> AlignResult:
    for i in range(1, max_iter + 1):
        current = measure()
        if all(
            score(targets[cid], current[cid]) for cid in targets if cid in current
        ):
            return AlignResult(converged=True, iterations=i)
        for cid, tgt in targets.items():
            settings = plan_knob_settings(knobs_by_id.get(cid, []), tgt, ref_w, ref_h)
            if settings:
                apply(settings)
    return AlignResult(converged=False, iterations=max_iter)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_align.py -q`
Expected: PASS (9 passed). Note: `test_align_loop_converges_then_stops` relies on `score` being called once per component per iteration and passing on the 2nd call; with one component and the apply-after-fail flow this yields `iterations==2`, `apply==1`.

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(align): align_loop with injected measure/score/apply"
```

---

### Task 5: integration entry doc (browser wiring, not unit-tested)

A thin orchestrator + a README note. NOT run in the unit loop; it wires the real pieces for the hero acceptance.

**Files:** Create `$ROOT/src/picode/integrate.py`; Create `$ROOT/INTEGRATION.md`.

- [ ] **Step 1: Write the orchestrator stub**

```python
# src/picode/integrate.py
"""Integration wiring for align mode. NOT unit-tested (needs a browser + models).

Pipeline for the hero acceptance:
  1. run_grounded_sam(target_image, prompts-from-manifest)  -> raw candidates
  2. resolve(candidates, mapping_manifest)                  -> Detections
  3. build_segmentation(detections, CoordinateSpace(img_w, img_h)) -> target Segmentation
  4. measure(): drive ~/.claude/skills/pixel-match/scripts/render.cjs on the live
     surface to read data-measure rects -> current Regions (dom_rect_to_norm)
  5. score(target, current): gate.geometry_pass (+ style_pass on sampled crop colour)
  6. apply(settings): write the CSS variables into the component's tokens
  7. align_loop(...) until converged or max_iter; then overlap_regression check at
     2-3 breakpoints; on regression, revert the last apply and report.

Transaction: snapshot the git worktree before the first apply; on failure or
non-convergence, restore it. Crops are written by component_id (idempotent).
"""
```

- [ ] **Step 2: Write `INTEGRATION.md`** with the same pipeline plus the exact commands to run the hero acceptance:

```markdown
# Align-mode integration (hero acceptance)

Target: `agent-review/hero-redraw.png`. Surface: the running Seichijunrei dev
server (`http://localhost:3001/`). Components: LandingHeader, HeroIntro,
HeroSceneCard, FoxGuide, RouteBackdrop, SharedFooter (data-measure names must
match the mapping manifest).

Manual run (until a CLI lands in a later plan):
1. Author the mapping manifest (componentId / data-measure / detector prompts /
   kind / cardinality / knobs) for the hero.
2. `picode.integrate` wires the steps in the module docstring.
3. Inspect `score.json` + `iteration.log`; review the Storybook Design tab
   (crops written to `frontend/public/design-targets/<id>.png`).

This file is the integration contract; the unit-tested algorithm lives in
`picode.align`, `picode.gate`, `picode.segment`, `picode.resolve`.
```

- [ ] **Step 3: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "docs(align): integration wiring stub + INTEGRATION.md for hero acceptance"
```

---

## Done criteria

`cd ~/.claude/skills/pic-to-code && uv run pytest -q` — all pass (39 from plans 1-4 + 9 new = 48). The align driver now: computes knob values from target geometry (px/rem, clamped), rejects conflicting knobs, detects overlap regressions, and converges via an injected-dependency loop. The browser-bound hero acceptance is documented in `INTEGRATION.md` and wired in `integrate.py` (run manually; not in the unit loop).
