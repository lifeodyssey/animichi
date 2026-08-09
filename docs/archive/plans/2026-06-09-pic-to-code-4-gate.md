# Pic-to-Code Plan 4: Geometry + Style Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** The algorithmic convergence judges. A geometry gate scores a current region against its target region (IoU + centroid distance + size ratio). A style gate derives a target colour from the target crop pixels (the oracle Codex demanded), snaps it to the nearest design token by CIE76 ΔE, and compares it to the rendered colour; plus a token-lint that the rendered value is a CSS variable, not a raw literal. Nothing here uses an LLM.

**Architecture:** New module `picode/gate.py`. Pure functions over plan-1 `picode.coords`/`picode.manifest` and Pillow. `delta_e` is a self-contained sRGB→Lab→CIE76 implementation (no deps). `geometry_score`/`geometry_pass` consume `Region` pairs; `sample_region_color`/`nearest_token`/`style_pass`/`token_lint` form the style gate.

**Tech Stack:** Python 3.12, Pillow, pytest.

---

## File Structure

- `~/.claude/skills/pic-to-code/src/picode/gate.py`
- `~/.claude/skills/pic-to-code/tests/test_gate.py`

`$ROOT = ~/.claude/skills/pic-to-code`.

---

### Task 1: geometry_score + geometry_pass

**Files:** Create `$ROOT/src/picode/gate.py`; Test `$ROOT/tests/test_gate.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_gate.py
import pytest
from picode.coords import Box
from picode.manifest import Region
from picode.gate import geometry_score, geometry_pass, GeometryScore


def _region(box, cid="c", kind="layout-component"):
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    return Region(component_id=cid, kind=kind, bbox=box, centroid=(cx, cy), confidence=1.0)


def test_geometry_score_perfect_match():
    r = _region(Box(0.2, 0.2, 0.4, 0.3))
    s = geometry_score(target=r, current=r)
    assert s.iou == pytest.approx(1.0)
    assert s.centroid_dist == pytest.approx(0.0)
    assert s.size_ratio == pytest.approx(1.0)


def test_geometry_score_shifted_and_resized():
    target = _region(Box(0.2, 0.2, 0.4, 0.2))
    current = _region(Box(0.25, 0.2, 0.4, 0.2))  # shifted right by 0.05
    s = geometry_score(target=target, current=current)
    assert 0.0 < s.iou < 1.0
    assert s.centroid_dist == pytest.approx(0.05, abs=1e-9)
    assert s.size_ratio == pytest.approx(1.0)  # same size


def test_geometry_pass_within_thresholds():
    target = _region(Box(0.2, 0.2, 0.4, 0.2))
    near = _region(Box(0.205, 0.2, 0.4, 0.2))
    assert geometry_pass(geometry_score(target, near),
                         min_iou=0.9, max_centroid_dist=0.02, ratio_tol=0.05) is True
    far = _region(Box(0.5, 0.5, 0.4, 0.2))
    assert geometry_pass(geometry_score(target, far),
                         min_iou=0.9, max_centroid_dist=0.02, ratio_tol=0.05) is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_gate.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.gate'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/gate.py
from __future__ import annotations

import math
from dataclasses import dataclass

from picode.coords import Box
from picode.manifest import Region


def _iou(a: Box, b: Box) -> float:
    x0, y0 = max(a.x, b.x), max(a.y, b.y)
    x1, y1 = min(a.x + a.w, b.x + b.w), min(a.y + a.h, b.y + b.h)
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union else 0.0


@dataclass(frozen=True)
class GeometryScore:
    iou: float
    centroid_dist: float
    size_ratio: float  # current area / target area


def geometry_score(target: Region, current: Region) -> GeometryScore:
    iou = _iou(target.bbox, current.bbox)
    dist = math.dist(target.centroid, current.centroid)
    t_area = target.bbox.w * target.bbox.h
    c_area = current.bbox.w * current.bbox.h
    ratio = c_area / t_area if t_area else 0.0
    return GeometryScore(iou=iou, centroid_dist=dist, size_ratio=ratio)


def geometry_pass(
    s: GeometryScore, min_iou: float, max_centroid_dist: float, ratio_tol: float
) -> bool:
    return (
        s.iou >= min_iou
        and s.centroid_dist <= max_centroid_dist
        and abs(s.size_ratio - 1.0) <= ratio_tol
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_gate.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(gate): geometry_score + geometry_pass over region pairs"
```

---

### Task 2: CIE76 ΔE + nearest_token (the colour matcher)

**Files:** Modify `$ROOT/src/picode/gate.py`; Test `$ROOT/tests/test_gate.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.gate import delta_e, nearest_token


def test_delta_e_identity_is_zero_and_black_white_is_large():
    assert delta_e((128, 64, 200), (128, 64, 200)) == pytest.approx(0.0, abs=1e-6)
    assert delta_e((0, 0, 0), (255, 255, 255)) == pytest.approx(100.0, abs=0.5)


def test_nearest_token_picks_closest_palette_entry():
    palette = {
        "--color-card": (250, 248, 243),   # cream
        "--color-primary": (25, 200, 185),  # teal
        "--color-cta": (240, 180, 41),      # gold
    }
    name, de = nearest_token((248, 246, 240), palette)  # near cream
    assert name == "--color-card"
    assert de < 5.0
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_gate.py -k "delta_e or nearest_token" -q`
Expected: FAIL — `ImportError: cannot import name 'delta_e'`.

- [ ] **Step 3: Write minimal implementation (append to gate.py)**

```python
def _srgb_to_lin(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    r, g, b = (_srgb_to_lin(v) for v in rgb)
    # linear sRGB -> XYZ (D65)
    x = r * 0.4124 + g * 0.3576 + b * 0.1805
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = r * 0.0193 + g * 0.1192 + b * 0.9505
    # normalize by D65 white
    x, y, z = x / 0.95047, y / 1.0, z / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(rgb1: tuple[int, int, int], rgb2: tuple[int, int, int]) -> float:
    l1, a1, b1 = _rgb_to_lab(rgb1)
    l2, a2, b2 = _rgb_to_lab(rgb2)
    return math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)


def nearest_token(
    rgb: tuple[int, int, int], palette: dict[str, tuple[int, int, int]]
) -> tuple[str, float]:
    best_name, best_de = "", float("inf")
    for name, prgb in palette.items():
        de = delta_e(rgb, prgb)
        if de < best_de:
            best_name, best_de = name, de
    return best_name, best_de
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_gate.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(gate): CIE76 delta_e + nearest_token colour matcher"
```

---

### Task 3: sample_region_color (the target oracle)

Samples a robust colour from a target region: the per-channel median over the crop, optionally ignoring pixels inside exclusion boxes (text/photo sub-regions) so the gate measures the surface colour, not the content.

**Files:** Modify `$ROOT/src/picode/gate.py`; Test `$ROOT/tests/test_gate.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from PIL import Image
from picode.gate import sample_region_color


def test_sample_region_color_median_ignores_excluded_box():
    img = Image.new("RGB", (100, 100), (250, 248, 243))  # cream surface
    # paint a black photo block inside, which we exclude
    for x in range(40, 60):
        for y in range(40, 60):
            img.putpixel((x, y), (0, 0, 0))
    box = Box(0, 0, 100, 100)
    rgb = sample_region_color(img, box, exclude=[Box(40, 40, 20, 20)])
    assert rgb == (250, 248, 243)  # median is the cream, black excluded
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_gate.py -k sample_region_color -q`
Expected: FAIL — `ImportError: cannot import name 'sample_region_color'`.

- [ ] **Step 3: Write minimal implementation (append to gate.py)**

```python
import statistics


def _in_any(x: int, y: int, boxes: list[Box]) -> bool:
    for e in boxes:
        if e.x <= x < e.x + e.w and e.y <= y < e.y + e.h:
            return True
    return False


def sample_region_color(
    image, box: Box, exclude: list[Box] | None = None
) -> tuple[int, int, int]:
    exclude = exclude or []
    px = image.load()
    rs, gs, bs = [], [], []
    x0, y0 = int(box.x), int(box.y)
    x1, y1 = int(box.x + box.w), int(box.y + box.h)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if _in_any(x, y, exclude):
                continue
            r, g, b = px[x, y][:3]
            rs.append(r); gs.append(g); bs.append(b)
    if not rs:
        raise ValueError("region has no sampleable pixels")
    return (
        int(statistics.median(rs)),
        int(statistics.median(gs)),
        int(statistics.median(bs)),
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_gate.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(gate): sample_region_color median oracle with exclusions"
```

---

### Task 4: style_pass + token_lint

`style_pass` ties the oracle together: the target colour (sampled, snapped to a token) must match the rendered colour within ΔE. `token_lint` is the code-side check that a rendered value is a CSS variable, not a raw literal.

**Files:** Modify `$ROOT/src/picode/gate.py`; Test `$ROOT/tests/test_gate.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.gate import style_pass, token_lint


def test_style_pass_true_when_rendered_matches_target_within_tol():
    palette = {"--color-card": (250, 248, 243), "--color-cta": (240, 180, 41)}
    assert style_pass(target_rgb=(248, 246, 240), rendered_rgb=(250, 248, 243),
                      palette=palette, tol=5.0) is True
    assert style_pass(target_rgb=(248, 246, 240), rendered_rgb=(240, 180, 41),
                      palette=palette, tol=5.0) is False


def test_token_lint_accepts_var_rejects_literal():
    assert token_lint("var(--color-card)") is True
    assert token_lint("#faf8f3") is False
    assert token_lint("rgb(250, 248, 243)") is False
    assert token_lint("var(--color-cta, #f0b429)") is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_gate.py -k "style_pass or token_lint" -q`
Expected: FAIL — `ImportError: cannot import name 'style_pass'`.

- [ ] **Step 3: Write minimal implementation (append to gate.py)**

```python
def style_pass(
    target_rgb: tuple[int, int, int],
    rendered_rgb: tuple[int, int, int],
    palette: dict[str, tuple[int, int, int]],
    tol: float,
) -> bool:
    target_token, _ = nearest_token(target_rgb, palette)
    target_canonical = palette[target_token]
    return delta_e(target_canonical, rendered_rgb) <= tol


def token_lint(css_value: str) -> bool:
    return css_value.strip().startswith("var(--")
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_gate.py -q`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(gate): style_pass (oracle->token->deltaE) + token_lint"
```

---

## Done criteria

`cd ~/.claude/skills/pic-to-code && uv run pytest -q` — all pass (31 from plans 1-3 + 8 new = 39). The gate module is the algorithmic judge: geometry (IoU + centroid + size ratio) and style (pixel-derived target oracle → nearest token by CIE76 ΔE → compare to rendered, plus token-lint). No LLM. Font/shadow/z-order remain out of scope by design (human-review gate, per the spec).
