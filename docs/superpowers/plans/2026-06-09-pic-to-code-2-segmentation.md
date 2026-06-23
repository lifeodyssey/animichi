# Pic-to-Code Plan 2: Segmentation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Convert raw detector output (boxes + masks + scores, already resolved to a `component_id`) into a thick, canonical `Segmentation` (regions in normalized space + pairwise overlap/containment/centroid relations) and write per-region crops. The heavy Grounded-SAM run is a thin documented adapter, kept out of the unit-test loop.

**Architecture:** New module `picode/segment.py`. Pure functions over the plan-1 `picode.coords` and `picode.manifest` types convert `Detection` → `Region` and compute relations; a `write_crops` helper uses Pillow on an in-memory image (no models). `run_grounded_sam` shells out to `~/.claude/skills/pixel-match/scripts/target_extract.py` and is integration-only.

**Tech Stack:** Python 3.12, pydantic v2, Pillow, pytest. Composes pixel-match by path.

---

## File Structure

- `~/.claude/skills/pic-to-code/src/picode/segment.py` — `Detection`, `to_regions`, `iou`, `containment`, `relations`, `write_crops`, `run_grounded_sam`.
- `~/.claude/skills/pic-to-code/src/picode/manifest.py` — extend `Region` with `area`/`ratio` properties and a `Relation` model + `relations` field on `Segmentation` (modify).
- `~/.claude/skills/pic-to-code/tests/test_segment.py` — unit tests.
- `~/.claude/skills/pic-to-code/pyproject.toml` — add `pillow` (modify).

`$ROOT = ~/.claude/skills/pic-to-code`.

---

### Task 1: Region.area / Region.ratio + Relation model

**Files:** Modify `$ROOT/src/picode/manifest.py`; Test `$ROOT/tests/test_manifest.py`.

- [ ] **Step 1: Write the failing test (append to tests/test_manifest.py)**

```python
def test_region_area_and_ratio_derived_from_bbox():
    r = _region(bbox=Box(0.1, 0.2, 0.4, 0.2))
    assert r.area == pytest.approx(0.08)        # 0.4 * 0.2
    assert r.ratio == pytest.approx(2.0)        # w / h
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_manifest.py::test_region_area_and_ratio_derived_from_bbox -q`
Expected: FAIL — `AttributeError: 'Region' object has no attribute 'area'`.

- [ ] **Step 3: Add properties + Relation model to manifest.py**

Add inside `class Region(...)` (after the validator):

```python
    @property
    def area(self) -> float:
        return self.bbox.w * self.bbox.h

    @property
    def ratio(self) -> float:
        return self.bbox.w / self.bbox.h if self.bbox.h else 0.0
```

Add after `class Region`, before `class Segmentation`:

```python
RelationKind = Literal["overlap", "contains", "contained_by", "centroid_above_top"]


class Relation(BaseModel):
    a: str            # component_id (or instance) of the first region
    b: str            # the second region
    kind: RelationKind
    value: float = 0.0  # IoU for overlap; 0 for boolean relations
```

Change `class Segmentation` to carry relations:

```python
class Segmentation(BaseModel):
    manifest_version: int
    regions: list[Region]
    relations: list[Relation] = []
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_manifest.py -q`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(manifest): Region area/ratio + Relation model + Segmentation.relations"
```

---

### Task 2: Detection → Region conversion (`to_regions`)

A `Detection` is the detector's raw output for one region, already carrying its resolved `component_id` and `kind` (resolution is plan 3's job). `to_regions` converts px geometry to canonical normalized `Region`s.

**Files:** Create `$ROOT/src/picode/segment.py`; Test `$ROOT/tests/test_segment.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_segment.py
import pytest
from picode.coords import Box, CoordinateSpace
from picode.segment import Detection, to_regions


def test_to_regions_normalizes_and_sets_centroid():
    space = CoordinateSpace(image_w=2000, image_h=1000)
    det = Detection(
        component_id="hero.card", kind="layout-component",
        box=Box(500, 250, 400, 200), score=0.9,
    )
    [r] = to_regions([det], space)
    assert r.component_id == "hero.card"
    assert r.bbox == Box(0.25, 0.25, 0.2, 0.2)
    assert r.centroid == pytest.approx((0.35, 0.35))  # center: (500+200)/2000, (250+100)/1000
    assert r.confidence == 0.9
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.segment'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/segment.py
from __future__ import annotations

from dataclasses import dataclass, field

from picode.coords import Box, CoordinateSpace
from picode.manifest import Kind, Region


@dataclass
class Detection:
    component_id: str
    kind: Kind
    box: Box  # pixel coordinates against the target image natural size
    score: float
    mask: list[list[bool]] | None = None
    instance_id: str | None = None


def to_regions(detections: list[Detection], space: CoordinateSpace) -> list[Region]:
    regions: list[Region] = []
    for d in detections:
        nb = space.to_norm(d.box)
        cx = round((nb.x + nb.w / 2), space.precision)
        cy = round((nb.y + nb.h / 2), space.precision)
        regions.append(
            Region(
                component_id=d.component_id,
                kind=d.kind,
                bbox=nb,
                centroid=(cx, cy),
                confidence=d.score,
                instance_id=d.instance_id,
            )
        )
    return regions
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(segment): Detection + to_regions canonical conversion"
```

---

### Task 3: IoU + containment over pixel boxes

**Files:** Modify `$ROOT/src/picode/segment.py`; Test `$ROOT/tests/test_segment.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.segment import iou, contains


def test_iou_half_overlap():
    a = Box(0, 0, 10, 10)
    b = Box(5, 0, 10, 10)  # overlap 5x10=50; union = 100+100-50=150
    assert iou(a, b) == pytest.approx(50 / 150)


def test_iou_disjoint_is_zero():
    assert iou(Box(0, 0, 10, 10), Box(100, 100, 10, 10)) == 0.0


def test_contains_true_when_b_inside_a():
    assert contains(Box(0, 0, 100, 100), Box(10, 10, 20, 20)) is True
    assert contains(Box(10, 10, 20, 20), Box(0, 0, 100, 100)) is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -k "iou or contains" -q`
Expected: FAIL — `ImportError: cannot import name 'iou'`.

- [ ] **Step 3: Write minimal implementation (append to segment.py)**

```python
def _inter(a: Box, b: Box) -> float:
    x0, y0 = max(a.x, b.x), max(a.y, b.y)
    x1, y1 = min(a.x + a.w, b.x + b.w), min(a.y + a.h, b.y + b.h)
    return max(0.0, x1 - x0) * max(0.0, y1 - y0)


def iou(a: Box, b: Box) -> float:
    inter = _inter(a, b)
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union else 0.0


def contains(a: Box, b: Box) -> bool:
    return (
        b.x >= a.x
        and b.y >= a.y
        and b.x + b.w <= a.x + a.w
        and b.y + b.h <= a.y + a.h
        and (b.w * b.h) < (a.w * a.h)
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(segment): iou + containment over boxes"
```

---

### Task 4: `relations()` — the fox-on-card case as a first-class relation

Builds the relation list between regions: overlap (IoU above a threshold), containment, and `centroid_above_top` (a region whose centroid sits above another region's top edge while their boxes overlap horizontally — "draped on," not "sunk in"). This is the relation that distinguishes the fox lounging on the card from the fox inside the photo.

**Files:** Modify `$ROOT/src/picode/segment.py`; Test `$ROOT/tests/test_segment.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.coords import CoordinateSpace
from picode.segment import Detection, to_regions, relations


def _norm_region(cid, kind, box_px):
    space = CoordinateSpace(image_w=1000, image_h=1000)
    return to_regions([Detection(component_id=cid, kind=kind, box=box_px, score=1.0)], space)[0]


def test_relations_detect_fox_draped_on_card_not_inside():
    # card occupies the lower-middle; fox centroid is ABOVE the card top, boxes overlap in x
    card = _norm_region("hero.card", "layout-component", Box(400, 400, 400, 300))
    fox = _norm_region("hero.fox", "graphic-asset", Box(650, 250, 200, 200))
    rels = relations([card, fox], iou_threshold=0.01)
    kinds = {(r.a, r.b, r.kind) for r in rels}
    assert ("hero.fox", "hero.card", "centroid_above_top") in kinds


def test_relations_emit_overlap_when_iou_exceeds_threshold():
    a = _norm_region("a", "layout-component", Box(0, 0, 100, 100))
    b = _norm_region("b", "layout-component", Box(50, 0, 100, 100))
    rels = relations([a, b], iou_threshold=0.1)
    assert any(r.kind == "overlap" and r.value > 0.1 for r in rels)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -k relations -q`
Expected: FAIL — `ImportError: cannot import name 'relations'`.

- [ ] **Step 3: Write minimal implementation (append to segment.py)**

```python
from itertools import combinations

from picode.manifest import Region, Relation


def _key(r: Region) -> str:
    return r.instance_id or r.component_id


def relations(regions: list[Region], iou_threshold: float = 0.05) -> list[Relation]:
    out: list[Relation] = []
    for a, b in combinations(regions, 2):
        ka, kb = _key(a), _key(b)
        ov = iou(a.bbox, b.bbox)
        if ov >= iou_threshold:
            out.append(Relation(a=ka, b=kb, kind="overlap", value=round(ov, 6)))
        if contains(a.bbox, b.bbox):
            out.append(Relation(a=kb, b=ka, kind="contained_by"))
            out.append(Relation(a=ka, b=kb, kind="contains"))
        elif contains(b.bbox, a.bbox):
            out.append(Relation(a=ka, b=kb, kind="contained_by"))
            out.append(Relation(a=kb, b=ka, kind="contains"))
        # centroid_above_top: a's centroid above b's top, with horizontal overlap
        for hi, lo in ((a, b), (b, a)):
            x_overlap = min(hi.bbox.x + hi.bbox.w, lo.bbox.x + lo.bbox.w) - max(
                hi.bbox.x, lo.bbox.x
            )
            if hi.centroid[1] < lo.bbox.y and x_overlap > 0:
                out.append(Relation(a=_key(hi), b=_key(lo), kind="centroid_above_top"))
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(segment): relations incl centroid_above_top (fox-on-card)"
```

---

### Task 5: `build_segmentation` — assemble the thick manifest

Ties it together: detections + space → a `Segmentation` with regions and relations, ready to serialize.

**Files:** Modify `$ROOT/src/picode/segment.py`; Test `$ROOT/tests/test_segment.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode import MANIFEST_VERSION
from picode.segment import build_segmentation
from picode.manifest import load_segmentation


def test_build_segmentation_roundtrips_with_relations():
    space = CoordinateSpace(image_w=1000, image_h=1000)
    dets = [
        Detection("hero.card", "layout-component", Box(400, 400, 400, 300), 0.9),
        Detection("hero.fox", "graphic-asset", Box(650, 250, 200, 200), 0.8),
    ]
    seg = build_segmentation(dets, space, iou_threshold=0.01)
    assert seg.manifest_version == MANIFEST_VERSION
    assert len(seg.regions) == 2
    reloaded = load_segmentation(seg.model_dump_json())
    assert any(r.kind == "centroid_above_top" for r in reloaded.relations)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -k build -q`
Expected: FAIL — `ImportError: cannot import name 'build_segmentation'`.

- [ ] **Step 3: Write minimal implementation (append to segment.py)**

```python
from picode import MANIFEST_VERSION
from picode.manifest import Segmentation


def build_segmentation(
    detections: list[Detection],
    space: CoordinateSpace,
    iou_threshold: float = 0.05,
) -> Segmentation:
    regions = to_regions(detections, space)
    return Segmentation(
        manifest_version=MANIFEST_VERSION,
        regions=regions,
        relations=relations(regions, iou_threshold=iou_threshold),
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(segment): build_segmentation assembles thick manifest"
```

---

### Task 6: `write_crops` — per-region PNG crops (Pillow, no models)

**Files:** Modify `$ROOT/pyproject.toml` (add pillow); Modify `$ROOT/src/picode/segment.py`; Test `$ROOT/tests/test_segment.py`.

- [ ] **Step 1: Add pillow to pyproject dependencies and sync**

In `$ROOT/pyproject.toml`, change `dependencies = ["pydantic>=2.7"]` to:

```toml
dependencies = ["pydantic>=2.7", "pillow>=10.0"]
```

Run: `cd $ROOT && uv sync`

- [ ] **Step 2: Write the failing test (append)**

```python
from pathlib import Path
from PIL import Image
from picode.segment import write_crops


def test_write_crops_saves_one_png_per_detection(tmp_path: Path):
    img = Image.new("RGB", (1000, 500), (250, 248, 243))
    dets = [
        Detection("hero.card", "layout-component", Box(100, 50, 300, 200), 0.9),
        Detection("hero.fox", "graphic-asset", Box(700, 20, 120, 120), 0.8),
    ]
    paths = write_crops(dets, img, tmp_path)
    assert set(paths.keys()) == {"hero.card", "hero.fox"}
    for cid, p in paths.items():
        assert p.exists() and p.suffix == ".png"
    assert Image.open(paths["hero.card"]).size == (300, 200)
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -k write_crops -q`
Expected: FAIL — `ImportError: cannot import name 'write_crops'`.

- [ ] **Step 4: Write minimal implementation (append to segment.py)**

```python
from pathlib import Path

from PIL import Image


def write_crops(
    detections: list[Detection], image: "Image.Image", out_dir: Path
) -> dict[str, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for d in detections:
        b = d.box
        crop = image.crop((b.x, b.y, b.x + b.w, b.y + b.h))
        key = d.instance_id or d.component_id
        p = out_dir / f"{key}.png"
        crop.save(p)
        paths[key] = p
    return paths
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -q`
Expected: PASS (8 passed).

- [ ] **Step 6: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(segment): write_crops per-region PNGs"
```

---

### Task 7: `run_grounded_sam` adapter (integration seam, skipped without models)

Shells to pixel-match's `target_extract.py`. Not run in the unit loop. The test asserts the adapter raises a clear error when the model env is absent, so the seam is documented and fail-closed.

**Files:** Modify `$ROOT/src/picode/segment.py`; Test `$ROOT/tests/test_segment.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.segment import run_grounded_sam


def test_run_grounded_sam_raises_clear_error_when_extractor_missing(tmp_path):
    fake = tmp_path / "nope.py"  # extractor path that does not exist
    with pytest.raises(FileNotFoundError, match="target_extract"):
        run_grounded_sam(
            image_path=tmp_path / "img.png",
            prompts=["fox"],
            extractor=fake,
        )
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -k grounded_sam -q`
Expected: FAIL — `ImportError: cannot import name 'run_grounded_sam'`.

- [ ] **Step 3: Write minimal implementation (append to segment.py)**

```python
import json
import subprocess

PIXEL_MATCH = Path.home() / ".claude" / "skills" / "pixel-match"
DEFAULT_EXTRACTOR = PIXEL_MATCH / "scripts" / "target_extract.py"
DEFAULT_VENV_PY = PIXEL_MATCH / ".venv" / "bin" / "python"


def run_grounded_sam(
    image_path: Path,
    prompts: list[str],
    extractor: Path = DEFAULT_EXTRACTOR,
    python_bin: Path = DEFAULT_VENV_PY,
) -> list[dict]:
    """Integration seam: invoke pixel-match's Grounded-SAM extractor.

    Returns the extractor's raw JSON (list of detections). Not unit-tested with
    real models; callers convert the result with `to_regions`/`build_segmentation`.
    """
    extractor = Path(extractor)
    if not extractor.exists():
        raise FileNotFoundError(f"target_extract not found at {extractor}")
    proc = subprocess.run(
        [str(python_bin), str(extractor), "--image", str(image_path),
         "--prompts", ",".join(prompts), "--json"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(proc.stdout)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_segment.py -q`
Expected: PASS (9 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(segment): run_grounded_sam adapter (integration seam, fail-closed)"
```

---

## Done criteria

`cd ~/.claude/skills/pic-to-code && uv run pytest -q` — all pass (16 from plan 1 + 9 new = 25). The segmentation core now converts detector output into a thick canonical `Segmentation` with relations (including the fox-on-card `centroid_above_top`), writes per-region crops, and exposes a fail-closed Grounded-SAM adapter. Real-model behaviour of `run_grounded_sam` is verified manually/integration, not in the unit loop.
