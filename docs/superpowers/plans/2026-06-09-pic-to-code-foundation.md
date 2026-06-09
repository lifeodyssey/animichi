# Pic-to-Code Foundation (coords + manifest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the canonical coordinate system and versioned manifest schema that every other pic-to-code subsystem produces into and consumes from, so a px-vs-normalized or version mismatch can never score against the wrong geometry.

**Architecture:** A small Python package `picode` in a new git repo at `~/.claude/skills/pic-to-code/`. One module for the coordinate space (normalized 0..1 against the target image's natural size, with explicit mask→bbox and DOM-rect→normalized conversions and a fixed rounding rule), one module for the manifest schema (versioned `segmentation.json` regions + the mapping manifest), each with validators that fail closed. Pure functions, no I/O beyond JSON load/dump, so each unit is testable in isolation. Later subsystems (segmenter, resolver, score-gate) import these.

**Tech Stack:** Python 3.12, `uv` for env, `pytest`, `pydantic` v2 for schema + validation. No model weights in this repo (it composes `~/.claude/skills/pixel-match` by path later, not in this plan).

---

## File Structure

- `~/.claude/skills/pic-to-code/pyproject.toml` — package + dev deps (pytest, pydantic).
- `~/.claude/skills/pic-to-code/.gitignore` — `.venv/`, `__pycache__/`, `*.pyc`.
- `~/.claude/skills/pic-to-code/src/picode/__init__.py` — package marker + version.
- `~/.claude/skills/pic-to-code/src/picode/coords.py` — `CoordinateSpace`, `Box`, conversions, rounding.
- `~/.claude/skills/pic-to-code/src/picode/manifest.py` — `Region`, `Segmentation`, `MappingManifest`, validators.
- `~/.claude/skills/pic-to-code/tests/test_coords.py`
- `~/.claude/skills/pic-to-code/tests/test_manifest.py`

All paths below are absolute under `~/.claude/skills/pic-to-code/` (call it `$ROOT`).

---

### Task 0: Scaffold the repo

**Files:**
- Create: `$ROOT/pyproject.toml`, `$ROOT/.gitignore`, `$ROOT/src/picode/__init__.py`

- [ ] **Step 1: Create the directory, git repo, and venv**

```bash
ROOT=~/.claude/skills/pic-to-code
mkdir -p "$ROOT/src/picode" "$ROOT/tests"
cd "$ROOT"
git init -q
printf '.venv/\n__pycache__/\n*.pyc\n.pytest_cache/\n' > .gitignore
```

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[project]
name = "picode"
version = "0.0.1"
requires-python = ">=3.12"
dependencies = ["pydantic>=2.7"]

[dependency-groups]
dev = ["pytest>=8.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/picode"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 3: Write `src/picode/__init__.py`**

```python
"""pic-to-code: deterministic image-driven frontend alignment."""

__version__ = "0.0.1"
MANIFEST_VERSION = 1
```

- [ ] **Step 4: Create the env and confirm pytest runs (no tests yet)**

Run: `cd $ROOT && uv sync && uv run pytest -q`
Expected: `no tests ran` (exit 5) — env works, nothing to run yet.

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "chore: scaffold picode package"
```

---

### Task 1: CoordinateSpace — normalized ↔ px with fixed rounding

A `CoordinateSpace` holds the target image natural size and converts px↔normalized. Rounding is half-up to a fixed precision so producer and consumer agree exactly.

**Files:**
- Create: `$ROOT/src/picode/coords.py`
- Test: `$ROOT/tests/test_coords.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_coords.py
import pytest
from picode.coords import CoordinateSpace, Box


def test_px_to_norm_and_back_is_identity():
    space = CoordinateSpace(image_w=2000, image_h=1000)
    box_px = Box(x=500, y=250, w=400, h=200)
    norm = space.to_norm(box_px)
    assert norm == Box(x=0.25, y=0.25, w=0.2, h=0.2)
    assert space.to_px(norm) == box_px


def test_rounding_is_half_up_fixed_precision():
    space = CoordinateSpace(image_w=3, image_h=3, precision=4)
    # 1/3 = 0.33333..., half-up to 4 dp = 0.3333
    assert space.to_norm(Box(x=1, y=1, w=1, h=1)).x == 0.3333


def test_to_px_rounds_to_int_pixels():
    space = CoordinateSpace(image_w=2000, image_h=1000)
    # 0.12345 * 2000 = 246.9 -> 247
    assert space.to_px(Box(x=0.12345, y=0, w=0, h=0)).x == 247
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_coords.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.coords'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/coords.py
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal


def _round(value: float, precision: int) -> float:
    q = Decimal(1).scaleb(-precision)
    return float(Decimal(str(value)).quantize(q, rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True)
class CoordinateSpace:
    image_w: int
    image_h: int
    precision: int = 6

    def to_norm(self, box: Box) -> Box:
        p = self.precision
        return Box(
            x=_round(box.x / self.image_w, p),
            y=_round(box.y / self.image_h, p),
            w=_round(box.w / self.image_w, p),
            h=_round(box.h / self.image_h, p),
        )

    def to_px(self, box: Box) -> Box:
        return Box(
            x=int(_round(box.x * self.image_w, 0)),
            y=int(_round(box.y * self.image_h, 0)),
            w=int(_round(box.w * self.image_w, 0)),
            h=int(_round(box.h * self.image_h, 0)),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_coords.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(coords): CoordinateSpace px<->norm with half-up rounding"
```

---

### Task 2: mask → bbox (tight, with documented padding)

A binary mask (list of [row, col] foreground pixels, or a 2D bool grid) becomes a tight bbox in px, optionally padded by a fraction of its own size. This is the only sanctioned mask→bbox conversion.

**Files:**
- Modify: `$ROOT/src/picode/coords.py`
- Test: `$ROOT/tests/test_coords.py`

- [ ] **Step 1: Write the failing test (append to test_coords.py)**

```python
from picode.coords import mask_to_bbox


def test_mask_to_bbox_tight():
    # 5x5 grid, foreground at rows 1..2, cols 1..3
    mask = [[False] * 5 for _ in range(5)]
    for r in (1, 2):
        for c in (1, 2, 3):
            mask[r][c] = True
    assert mask_to_bbox(mask) == Box(x=1, y=1, w=3, h=2)


def test_mask_to_bbox_padding_clamps_to_image():
    mask = [[False] * 5 for _ in range(5)]
    mask[0][0] = True
    # pad 1.0 of a 1x1 box = 1px each side, clamped at 0
    assert mask_to_bbox(mask, pad=1.0) == Box(x=0, y=0, w=2, h=2)


def test_mask_to_bbox_empty_raises():
    with pytest.raises(ValueError):
        mask_to_bbox([[False, False], [False, False]])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_coords.py::test_mask_to_bbox_tight -q`
Expected: FAIL — `ImportError: cannot import name 'mask_to_bbox'`.

- [ ] **Step 3: Write minimal implementation (append to coords.py)**

```python
def mask_to_bbox(mask: list[list[bool]], pad: float = 0.0) -> Box:
    rows = [r for r, row in enumerate(mask) if any(row)]
    if not rows:
        raise ValueError("mask has no foreground pixels")
    cols = [c for row in mask for c, v in enumerate(row) if v]
    y0, y1 = min(rows), max(rows)
    x0, x1 = min(cols), max(cols)
    w, h = x1 - x0 + 1, y1 - y0 + 1
    if pad:
        dx, dy = round(w * pad), round(h * pad)
        x0, y0 = max(0, x0 - dx), max(0, y0 - dy)
        img_h, img_w = len(mask), len(mask[0])
        x1, y1 = min(img_w - 1, x1 + dx), min(img_h - 1, y1 + dy)
        w, h = x1 - x0 + 1, y1 - y0 + 1
    return Box(x=x0, y=y0, w=w, h=h)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_coords.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(coords): mask_to_bbox tight + clamped padding"
```

---

### Task 3: DOM rect → normalized against a reference width

The live app is measured at a reference width that may differ from the target image's pixel width. A DOM rect (px at reference width) normalizes against that reference width/height, landing in the SAME 0..1 space as the target.

**Files:**
- Modify: `$ROOT/src/picode/coords.py`
- Test: `$ROOT/tests/test_coords.py`

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.coords import dom_rect_to_norm


def test_dom_rect_normalizes_against_reference_viewport():
    # app measured at 1440x900; rect at x=720,y=450,w=288,h=180
    norm = dom_rect_to_norm(
        rect=Box(x=720, y=450, w=288, h=180), ref_w=1440, ref_h=900
    )
    assert norm == Box(x=0.5, y=0.5, w=0.2, h=0.2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_coords.py::test_dom_rect_normalizes_against_reference_viewport -q`
Expected: FAIL — `ImportError: cannot import name 'dom_rect_to_norm'`.

- [ ] **Step 3: Write minimal implementation (append)**

```python
def dom_rect_to_norm(rect: Box, ref_w: int, ref_h: int, precision: int = 6) -> Box:
    return CoordinateSpace(image_w=ref_w, image_h=ref_h, precision=precision).to_norm(rect)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_coords.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(coords): dom_rect_to_norm against reference viewport"
```

---

### Task 4: round-trip property test (the skew guard)

Codex flagged producer/consumer coordinate skew. Lock it with a round-trip: mask → bbox → norm → px → norm stays within one rounding step. This is the regression guard for issue 6.

**Files:**
- Test: `$ROOT/tests/test_coords.py`

- [ ] **Step 1: Write the failing test (append)**

```python
def test_mask_to_norm_roundtrip_stable():
    space = CoordinateSpace(image_w=200, image_h=100, precision=6)
    mask = [[False] * 200 for _ in range(100)]
    for r in range(30, 71):       # rows 30..70
        for c in range(40, 121):  # cols 40..120
            mask[r][c] = True
    bbox = mask_to_bbox(mask)
    norm1 = space.to_norm(bbox)
    norm2 = space.to_norm(space.to_px(norm1))
    for a, b in zip(
        (norm1.x, norm1.y, norm1.w, norm1.h), (norm2.x, norm2.y, norm2.w, norm2.h)
    ):
        assert abs(a - b) <= 1 / 200  # within one px of the larger axis
```

- [ ] **Step 2: Run test to verify it passes (functions already exist)**

Run: `cd $ROOT && uv run pytest tests/test_coords.py::test_mask_to_norm_roundtrip_stable -q`
Expected: PASS. (If it FAILS, the rounding rule is wrong — fix `_round`/`to_px` before continuing; do not loosen the tolerance.)

- [ ] **Step 3: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "test(coords): mask->norm->px round-trip stability guard"
```

---

### Task 5: Region + Segmentation schema, versioned, fail-closed

`segmentation.json` is a versioned document of regions in normalized space. Loading rejects a mismatched `manifestVersion` (fail closed).

**Files:**
- Create: `$ROOT/src/picode/manifest.py`
- Test: `$ROOT/tests/test_manifest.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_manifest.py
import pytest
from picode.coords import Box
from picode.manifest import Region, Segmentation, load_segmentation
from picode import MANIFEST_VERSION


def _region(**kw):
    base = dict(
        component_id="hero.sceneCard",
        kind="layout-component",
        bbox=Box(0.5, 0.3, 0.4, 0.3),
        centroid=(0.7, 0.45),
        confidence=0.91,
    )
    base.update(kw)
    return Region(**base)


def test_segmentation_roundtrips_json():
    seg = Segmentation(manifest_version=MANIFEST_VERSION, regions=[_region()])
    loaded = load_segmentation(seg.model_dump_json())
    assert loaded.regions[0].component_id == "hero.sceneCard"
    assert loaded.regions[0].bbox.w == 0.4


def test_load_rejects_wrong_version():
    bad = '{"manifest_version": 999, "regions": []}'
    with pytest.raises(ValueError, match="manifest_version"):
        load_segmentation(bad)


def test_region_rejects_unknown_kind():
    with pytest.raises(ValueError):
        _region(kind="not-a-kind")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_manifest.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.manifest'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/manifest.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator

from picode import MANIFEST_VERSION
from picode.coords import Box

Kind = Literal["layout-component", "graphic-asset", "uncertain"]


class Region(BaseModel):
    component_id: str
    kind: Kind
    bbox: Box
    centroid: tuple[float, float]
    confidence: float
    instance_id: str | None = None

    model_config = {"arbitrary_types_allowed": True}

    @field_validator("bbox", mode="before")
    @classmethod
    def _coerce_box(cls, v: object) -> Box:
        if isinstance(v, Box):
            return v
        if isinstance(v, dict):
            return Box(**v)
        raise TypeError("bbox must be a Box or mapping")


class Segmentation(BaseModel):
    manifest_version: int
    regions: list[Region]


def load_segmentation(data: str) -> Segmentation:
    seg = Segmentation.model_validate_json(data)
    if seg.manifest_version != MANIFEST_VERSION:
        raise ValueError(
            f"manifest_version {seg.manifest_version} != expected {MANIFEST_VERSION}"
        )
    return seg
```

Note: `Box` is a frozen dataclass, so `Region` uses `arbitrary_types_allowed` and a validator to coerce dict→Box on JSON load; `model_dump_json` serializes the dataclass via pydantic's encoder.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_manifest.py -q`
Expected: PASS (3 passed). If `model_dump_json` cannot serialize `Box`, add to `Segmentation.model_config` a `json_encoders` mapping `{Box: lambda b: b.__dict__}` and re-run.

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(manifest): versioned Segmentation schema, fail-closed load"
```

---

### Task 6: MappingManifest + cardinality validator

The mapping manifest is the identity source: `component_id` is the join key; cardinality bounds how many regions may claim it. The validator hard-fails on violations (ambiguous/missing), which is what makes matching deterministic without name equality.

**Files:**
- Modify: `$ROOT/src/picode/manifest.py`
- Test: `$ROOT/tests/test_manifest.py`

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.manifest import ComponentMapping, MappingManifest, validate_mapping


def _mapping(**kw):
    base = dict(
        component_id="hero.fox",
        data_measure="fox",
        detector_prompts=["a small fox", "guide fox"],
        kind="graphic-asset",
        cardinality="1",
    )
    base.update(kw)
    return ComponentMapping(**base)


def test_validate_mapping_ok_for_single():
    mm = MappingManifest(components=[_mapping()])
    # one region claims hero.fox; cardinality "1" allows exactly one
    validate_mapping(mm, region_ids=["hero.fox"])


def test_validate_mapping_rejects_over_cardinality():
    mm = MappingManifest(components=[_mapping(cardinality="1")])
    with pytest.raises(ValueError, match="cardinality"):
        validate_mapping(mm, region_ids=["hero.fox", "hero.fox"])


def test_validate_mapping_rejects_missing_required():
    mm = MappingManifest(components=[_mapping(cardinality="1")])
    with pytest.raises(ValueError, match="missing"):
        validate_mapping(mm, region_ids=[])


def test_validate_mapping_allows_optional_absent():
    mm = MappingManifest(components=[_mapping(cardinality="0..1")])
    validate_mapping(mm, region_ids=[])  # optional, absence is fine
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_manifest.py -k mapping -q`
Expected: FAIL — `ImportError: cannot import name 'ComponentMapping'`.

- [ ] **Step 3: Write minimal implementation (append to manifest.py)**

```python
Cardinality = Literal["1", "0..1", "n"]


class ComponentMapping(BaseModel):
    component_id: str
    data_measure: str
    detector_prompts: list[str]
    kind: Kind
    cardinality: Cardinality


class MappingManifest(BaseModel):
    components: list[ComponentMapping]


def validate_mapping(manifest: MappingManifest, region_ids: list[str]) -> None:
    counts: dict[str, int] = {}
    for rid in region_ids:
        counts[rid] = counts.get(rid, 0) + 1
    for comp in manifest.components:
        n = counts.get(comp.component_id, 0)
        if comp.cardinality == "1" and n != 1:
            verb = "missing" if n == 0 else "cardinality"
            raise ValueError(
                f"{verb}: {comp.component_id} has {n} regions, expected exactly 1"
            )
        if comp.cardinality == "0..1" and n > 1:
            raise ValueError(
                f"cardinality: {comp.component_id} has {n} regions, expected 0..1"
            )
    known = {c.component_id for c in manifest.components}
    for rid in counts:
        if rid not in known:
            raise ValueError(f"unknown region component_id: {rid}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_manifest.py -q`
Expected: PASS (7 passed total in the file).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(manifest): MappingManifest + fail-closed cardinality validator"
```

---

## Done criteria

Run `cd ~/.claude/skills/pic-to-code && uv run pytest -q` — all tests pass. The
foundation now guarantees: one normalized coordinate space, deterministic
mask→bbox and DOM-rect→norm conversions, a round-trip stability guard, a
version-fail-closed `segmentation.json`, and a fail-closed mapping/cardinality
validator. Subsequent plans (segmenter, resolver, score-gate, align driver)
import `picode.coords` and `picode.manifest` and never invent their own coords or
identity rules.
