# Pic-to-Code Plan 6: Classifier + raster-to-svg Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Route each region to graphic-asset / layout-component / uncertain, fail-closed. In align mode the mapping manifest's `kind` is authoritative (no inference). In scaffold mode a deterministic classifier uses colour-histogram entropy + aspect, with an UNCERTAIN band that refuses to mutate. Graphic-asset regions route to a fail-closed `raster-to-svg` (vtracer) adapter.

**Architecture:** Two modules. `picode/classify.py`: `manifest_kind` (lookup), `color_entropy` (Shannon entropy of a coarse histogram, Pillow), `classify_region` (scaffold heuristic with UNCERTAIN). `picode/vectorize.py`: `vectorize` adapter that shells to `~/.claude/skills/raster-to-svg` (vtracer), fail-closed if the tool is missing. No LLM.

**Tech Stack:** Python 3.12, Pillow, pytest.

---

## File Structure

- `~/.claude/skills/pic-to-code/src/picode/classify.py`
- `~/.claude/skills/pic-to-code/src/picode/vectorize.py`
- `~/.claude/skills/pic-to-code/tests/test_classify.py`
- `~/.claude/skills/pic-to-code/tests/test_vectorize.py`

`$ROOT = ~/.claude/skills/pic-to-code`.

---

### Task 1: manifest_kind (align mode, authoritative)

**Files:** Create `$ROOT/src/picode/classify.py`; Test `$ROOT/tests/test_classify.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_classify.py
import pytest
from picode.manifest import ComponentMapping, MappingManifest
from picode.classify import manifest_kind


def _mm():
    return MappingManifest(components=[
        ComponentMapping(component_id="hero.card", data_measure="card",
                         detector_prompts=["card"], kind="layout-component", cardinality="1"),
        ComponentMapping(component_id="hero.fox", data_measure="fox",
                         detector_prompts=["fox"], kind="graphic-asset", cardinality="1"),
    ])


def test_manifest_kind_returns_declared_kind():
    assert manifest_kind("hero.fox", _mm()) == "graphic-asset"
    assert manifest_kind("hero.card", _mm()) == "layout-component"


def test_manifest_kind_unknown_is_uncertain():
    assert manifest_kind("hero.nope", _mm()) == "uncertain"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_classify.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.classify'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/classify.py
from __future__ import annotations

from picode.manifest import Kind, MappingManifest


def manifest_kind(component_id: str, manifest: MappingManifest) -> Kind:
    for comp in manifest.components:
        if comp.component_id == component_id:
            return comp.kind
    return "uncertain"
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_classify.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(classify): manifest_kind authoritative lookup (align mode)"
```

---

### Task 2: color_entropy

Shannon entropy over a coarse (per-channel 4-bit = 16-bin) colour histogram of a region. A flat UI surface scores near 0; a busy illustration scores high. The single feature that separates graphics from chrome.

**Files:** Modify `$ROOT/src/picode/classify.py`; Test `$ROOT/tests/test_classify.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from PIL import Image
from picode.classify import color_entropy


def test_color_entropy_flat_image_is_zero():
    img = Image.new("RGB", (40, 40), (250, 248, 243))
    assert color_entropy(img) == pytest.approx(0.0, abs=1e-9)


def test_color_entropy_noisy_image_is_high():
    img = Image.new("RGB", (40, 40))
    px = img.load()
    for y in range(40):
        for x in range(40):
            px[x, y] = ((x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256)
    assert color_entropy(img) > 3.0
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_classify.py -k color_entropy -q`
Expected: FAIL — `ImportError: cannot import name 'color_entropy'`.

- [ ] **Step 3: Write minimal implementation (append to classify.py)**

```python
import math
from collections import Counter


def color_entropy(image) -> float:
    rgb = image.convert("RGB")
    counts: Counter[tuple[int, int, int]] = Counter()
    for r, g, b in rgb.getdata():
        counts[(r >> 4, g >> 4, b >> 4)] += 1  # 4-bit per channel buckets
    total = sum(counts.values())
    if total == 0:
        return 0.0
    ent = 0.0
    for n in counts.values():
        p = n / total
        ent -= p * math.log2(p)
    return ent
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_classify.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(classify): color_entropy over 4-bit histogram"
```

---

### Task 3: classify_region (scaffold heuristic, UNCERTAIN band)

Maps entropy to a kind with a deadband: low entropy → layout-component, high → graphic-asset, in-between → uncertain (no mutation). Returns the score so decisions are auditable.

**Files:** Modify `$ROOT/src/picode/classify.py`; Test `$ROOT/tests/test_classify.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.classify import classify_region, ClassifyResult


def _flat():
    return Image.new("RGB", (40, 40), (250, 248, 243))


def _noisy():
    img = Image.new("RGB", (40, 40))
    px = img.load()
    for y in range(40):
        for x in range(40):
            px[x, y] = ((x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256)
    return img


def test_classify_region_flat_is_layout():
    res = classify_region(_flat(), low=1.0, high=3.0)
    assert isinstance(res, ClassifyResult)
    assert res.kind == "layout-component"


def test_classify_region_noisy_is_graphic():
    assert classify_region(_noisy(), low=1.0, high=3.0).kind == "graphic-asset"


def test_classify_region_midband_is_uncertain():
    # force the deadband by setting thresholds around the flat image's ~0 entropy
    res = classify_region(_flat(), low=-1.0, high=1.0)
    assert res.kind == "uncertain"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_classify.py -k classify_region -q`
Expected: FAIL — `ImportError: cannot import name 'classify_region'`.

- [ ] **Step 3: Write minimal implementation (append to classify.py)**

```python
from dataclasses import dataclass

from picode.manifest import Kind


@dataclass(frozen=True)
class ClassifyResult:
    kind: Kind
    entropy: float


def classify_region(image, low: float, high: float) -> ClassifyResult:
    e = color_entropy(image)
    if e <= low:
        kind: Kind = "layout-component"
    elif e >= high:
        kind = "graphic-asset"
    else:
        kind = "uncertain"
    return ClassifyResult(kind=kind, entropy=e)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_classify.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(classify): classify_region scaffold heuristic + UNCERTAIN deadband"
```

---

### Task 4: vectorize adapter (fail-closed)

Shells to the `raster-to-svg` skill's vtracer pipeline. Integration seam: not run with the real binary in the unit loop; the test asserts a clear error when the tool is absent.

**Files:** Create `$ROOT/src/picode/vectorize.py`; Test `$ROOT/tests/test_vectorize.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_vectorize.py
import pytest
from pathlib import Path
from picode.vectorize import vectorize


def test_vectorize_fail_closed_when_vtracer_missing(tmp_path):
    crop = tmp_path / "fox.png"
    crop.write_bytes(b"not really a png")
    with pytest.raises(FileNotFoundError, match="vtracer"):
        vectorize(crop, tmp_path / "fox.svg", vtracer_bin=tmp_path / "no-vtracer")


def test_vectorize_rejects_unknown_mode(tmp_path):
    crop = tmp_path / "fox.png"
    crop.write_bytes(b"x")
    with pytest.raises(ValueError, match="mode"):
        vectorize(crop, tmp_path / "fox.svg", mode="teleport")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_vectorize.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.vectorize'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/vectorize.py
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

VALID_MODES = ("reuse-existing", "vectorize-new")


def vectorize(
    crop: Path,
    out_svg: Path,
    mode: str = "vectorize-new",
    vtracer_bin: Path | None = None,
) -> Path:
    """Vectorize a graphic-asset crop to SVG via the raster-to-svg vtracer pipeline.

    `reuse-existing` is the default routing decision elsewhere (align an existing
    asset, do not redraw); this function performs the actual `vectorize-new` work.
    """
    if mode not in VALID_MODES:
        raise ValueError(f"unknown mode {mode!r}; expected one of {VALID_MODES}")
    binary = Path(vtracer_bin) if vtracer_bin else _find_vtracer()
    if binary is None or not Path(binary).exists():
        raise FileNotFoundError(f"vtracer not found at {binary}")
    out_svg = Path(out_svg)
    subprocess.run(
        [str(binary), "--input", str(crop), "--output", str(out_svg),
         "--colormode", "color", "--mode", "spline"],
        check=True, capture_output=True, text=True,
    )
    return out_svg


def _find_vtracer() -> Path | None:
    found = shutil.which("vtracer")
    if found:
        return Path(found)
    candidate = Path.home() / ".cargo" / "bin" / "vtracer"
    return candidate if candidate.exists() else None
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_vectorize.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(vectorize): vtracer adapter, fail-closed, reuse/new modes"
```

---

## Done criteria

`cd ~/.claude/skills/pic-to-code && uv run pytest -q` — all pass (48 from plans 1-5 + 9 new = 57). The classifier routes regions (manifest-authoritative in align mode; entropy heuristic with an UNCERTAIN deadband in scaffold mode, never mutating on uncertainty) and the vectorize adapter sends graphic-asset crops to vtracer fail-closed.
