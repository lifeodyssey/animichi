# Pic-to-Code Plan 3: Mapping Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Resolve raw detector candidates (the prompt that matched + box + score) into `Detection`s keyed by stable `component_id`, using the mapping manifest as the only identity source. Deduplicate by cardinality (NMS-keep-top for single, instance IDs for `n`), and validate fail-closed via plan-1's `validate_mapping`.

**Architecture:** New module `picode/resolve.py`. Pure functions over plan-1 `picode.manifest` (`MappingManifest`, `validate_mapping`) and plan-2 `picode.segment` (`Detection`). Builds a prompt→component index, groups candidates, applies cardinality rules, then validates. No models, fully unit-tested.

**Tech Stack:** Python 3.12, pydantic v2, pytest.

---

## File Structure

- `~/.claude/skills/pic-to-code/src/picode/resolve.py` — `Candidate`, `resolve`.
- `~/.claude/skills/pic-to-code/tests/test_resolve.py`.

`$ROOT = ~/.claude/skills/pic-to-code`.

---

### Task 1: Candidate type + prompt→component index, single resolve, unknown-prompt fail-closed

**Files:** Create `$ROOT/src/picode/resolve.py`; Test `$ROOT/tests/test_resolve.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_resolve.py
import pytest
from picode.coords import Box
from picode.manifest import ComponentMapping, MappingManifest
from picode.resolve import Candidate, resolve


def _manifest(*maps):
    return MappingManifest(components=list(maps))


CARD = ComponentMapping(
    component_id="hero.card", data_measure="card",
    detector_prompts=["before/after comparison card", "photo card"],
    kind="layout-component", cardinality="1",
)
FOX = ComponentMapping(
    component_id="hero.fox", data_measure="fox",
    detector_prompts=["a small fox", "guide fox"],
    kind="graphic-asset", cardinality="1",
)


def test_resolve_maps_prompt_to_component():
    mm = _manifest(CARD, FOX)
    cands = [
        Candidate(prompt="photo card", box=Box(400, 400, 400, 300), score=0.9),
        Candidate(prompt="a small fox", box=Box(650, 250, 200, 200), score=0.8),
    ]
    dets = resolve(cands, mm)
    by_id = {d.component_id: d for d in dets}
    assert by_id["hero.card"].kind == "layout-component"
    assert by_id["hero.fox"].kind == "graphic-asset"
    assert by_id["hero.card"].box == Box(400, 400, 400, 300)


def test_resolve_rejects_unknown_prompt():
    mm = _manifest(CARD)
    with pytest.raises(ValueError, match="no component"):
        resolve([Candidate(prompt="a teapot", box=Box(0, 0, 1, 1), score=0.5)], mm)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_resolve.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.resolve'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/resolve.py
from __future__ import annotations

from dataclasses import dataclass

from picode.coords import Box
from picode.manifest import ComponentMapping, MappingManifest, validate_mapping
from picode.segment import Detection


@dataclass
class Candidate:
    prompt: str        # the detector prompt this candidate matched
    box: Box           # pixel coords against the target image
    score: float
    mask: list[list[bool]] | None = None


def _prompt_index(manifest: MappingManifest) -> dict[str, ComponentMapping]:
    index: dict[str, ComponentMapping] = {}
    for comp in manifest.components:
        for p in comp.detector_prompts:
            index[p] = comp
    return index


def resolve(candidates: list[Candidate], manifest: MappingManifest) -> list[Detection]:
    index = _prompt_index(manifest)
    dets: list[Detection] = []
    for c in candidates:
        comp = index.get(c.prompt)
        if comp is None:
            raise ValueError(f"no component for detector prompt: {c.prompt!r}")
        dets.append(
            Detection(
                component_id=comp.component_id, kind=comp.kind,
                box=c.box, score=c.score, mask=c.mask,
            )
        )
    validate_mapping(manifest, [d.component_id for d in dets])
    return dets
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_resolve.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(resolve): Candidate + prompt-indexed resolve, fail-closed on unknown prompt"
```

---

### Task 2: cardinality "1" dedup — NMS keep highest score

When two candidates resolve to the same single-cardinality component, keep the highest-scoring one (the other is a duplicate detection). Without this, `validate_mapping` would hard-fail on ordinary duplicate detections.

**Files:** Modify `$ROOT/src/picode/resolve.py`; Test `$ROOT/tests/test_resolve.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
def test_resolve_dedups_single_cardinality_keeping_top_score():
    mm = _manifest(CARD)
    cands = [
        Candidate(prompt="photo card", box=Box(400, 400, 400, 300), score=0.7),
        Candidate(prompt="before/after comparison card", box=Box(405, 402, 398, 299), score=0.92),
    ]
    dets = resolve(cands, mm)
    assert len(dets) == 1
    assert dets[0].component_id == "hero.card"
    assert dets[0].score == 0.92  # kept the higher-scoring detection
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_resolve.py::test_resolve_dedups_single_cardinality_keeping_top_score -q`
Expected: FAIL — `ValueError: cardinality: hero.card has 2 regions...` (validate_mapping rejects the un-deduped duplicate).

- [ ] **Step 3: Update `resolve` to dedup before validation**

Replace the body of `resolve` (after `_prompt_index`) with:

```python
def resolve(candidates: list[Candidate], manifest: MappingManifest) -> list[Detection]:
    index = _prompt_index(manifest)
    grouped: dict[str, list[tuple[Candidate, ComponentMapping]]] = {}
    for c in candidates:
        comp = index.get(c.prompt)
        if comp is None:
            raise ValueError(f"no component for detector prompt: {c.prompt!r}")
        grouped.setdefault(comp.component_id, []).append((c, comp))

    dets: list[Detection] = []
    for cid, items in grouped.items():
        comp = items[0][1]
        items.sort(key=lambda it: it[0].score, reverse=True)
        if comp.cardinality in ("1", "0..1"):
            c, _ = items[0]  # keep highest score only
            dets.append(
                Detection(component_id=cid, kind=comp.kind, box=c.box,
                          score=c.score, mask=c.mask)
            )
        else:  # "n"
            for i, (c, _) in enumerate(items):
                dets.append(
                    Detection(component_id=cid, kind=comp.kind, box=c.box,
                              score=c.score, mask=c.mask,
                              instance_id=f"{cid}#{i}")
                )
    validate_mapping(manifest, [d.component_id for d in dets])
    return dets
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_resolve.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(resolve): NMS dedup for single cardinality (keep top score)"
```

---

### Task 3: cardinality "n" → instance IDs by score rank

**Files:** Test `$ROOT/tests/test_resolve.py` (implementation already added in Task 2).

- [ ] **Step 1: Write the failing test (append)**

```python
SPOT = ComponentMapping(
    component_id="route.spot", data_measure="spot",
    detector_prompts=["map pin", "route marker"],
    kind="graphic-asset", cardinality="n",
)


def test_resolve_assigns_instance_ids_for_cardinality_n_by_score():
    mm = _manifest(SPOT)
    cands = [
        Candidate(prompt="map pin", box=Box(10, 10, 5, 5), score=0.6),
        Candidate(prompt="route marker", box=Box(50, 50, 5, 5), score=0.95),
        Candidate(prompt="map pin", box=Box(90, 90, 5, 5), score=0.8),
    ]
    dets = resolve(cands, mm)
    assert len(dets) == 3
    ids = [d.instance_id for d in dets]
    assert ids == ["route.spot#0", "route.spot#1", "route.spot#2"]
    # #0 is the highest score (0.95)
    assert dets[0].score == 0.95
```

- [ ] **Step 2: Run to verify it passes (logic already present)**

Run: `cd $ROOT && uv run pytest tests/test_resolve.py::test_resolve_assigns_instance_ids_for_cardinality_n_by_score -q`
Expected: PASS. (If it FAILS, fix the `"n"` branch in `resolve`; do not change the test.)

- [ ] **Step 3: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "test(resolve): cardinality n assigns score-ranked instance ids"
```

---

### Task 4: fail-closed on missing required component

**Files:** Test `$ROOT/tests/test_resolve.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
def test_resolve_fails_closed_when_required_component_missing():
    mm = _manifest(CARD, FOX)  # both cardinality "1" (required)
    cands = [Candidate(prompt="photo card", box=Box(0, 0, 10, 10), score=0.9)]
    # hero.fox has no candidate -> validate_mapping must hard-fail
    with pytest.raises(ValueError, match="missing"):
        resolve(cands, mm)
```

- [ ] **Step 2: Run to verify it passes (validate_mapping enforces this)**

Run: `cd $ROOT && uv run pytest tests/test_resolve.py::test_resolve_fails_closed_when_required_component_missing -q`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "test(resolve): fail-closed when a required component has no candidate"
```

---

## Done criteria

`cd ~/.claude/skills/pic-to-code && uv run pytest -q` — all pass (26 from plans 1+2 + 6 new = 32). The resolver turns raw detector candidates into `Detection`s by stable `component_id`: prompt-indexed identity, NMS dedup for single cardinality, score-ranked instance IDs for `n`, and fail-closed validation (unknown prompt, missing required). Output flows straight into plan-2's `build_segmentation`.
