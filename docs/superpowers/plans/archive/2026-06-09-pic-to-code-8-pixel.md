# Pic-to-Code Plan 8: L1 Pixel Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add the L1 pixel signal the geometry gate can't see: a whole-image pixel-diff score, a per-region colour ΔE check (against the target image, not just tokens), and a coarse route/path-shape difference. This is what detects "colour is off", "proportions are off", "the route shape differs".

**Architecture:** New module `picode/pixel.py`, Pillow + a tiny numpy-free pure-Python core (median/abs over pixel lists) so it needs no new heavy deps. Functions: `pixel_diff` (resize current to target, mean abs + %-over-threshold), `region_color_delta` (sample both images in a normalized region, CIE76 ΔE via `picode.gate.delta_e`), `path_shape_diff` (compare two polylines by mean nearest-point distance, normalized). Composes plan-1 `coords` and plan-4 `gate`.

**Tech Stack:** Python 3.12, Pillow, pytest. Reuses `picode.gate.delta_e` and `picode.gate.sample_region_color`.

---

## File Structure

- `~/.claude/skills/pic-to-code/src/picode/pixel.py`
- `~/.claude/skills/pic-to-code/tests/test_pixel.py`

`$ROOT = ~/.claude/skills/pic-to-code`.

---

### Task 1: pixel_diff (whole-image)

**Files:** Create `$ROOT/src/picode/pixel.py`; Test `$ROOT/tests/test_pixel.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pixel.py
import pytest
from PIL import Image
from picode.pixel import pixel_diff, PixelDiff


def test_pixel_diff_identical_is_zero():
    img = Image.new("RGB", (40, 30), (250, 248, 243))
    d = pixel_diff(img, img)
    assert isinstance(d, PixelDiff)
    assert d.mean_abs == pytest.approx(0.0)
    assert d.pct_over == pytest.approx(0.0)


def test_pixel_diff_resizes_current_to_target_and_scores():
    target = Image.new("RGB", (40, 30), (0, 0, 0))
    current = Image.new("RGB", (80, 60), (255, 255, 255))  # different size + colour
    d = pixel_diff(current, target, threshold=40)
    assert d.mean_abs == pytest.approx(255.0)
    assert d.pct_over == pytest.approx(100.0)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_pixel.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.pixel'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/pixel.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PixelDiff:
    mean_abs: float   # mean per-channel absolute difference, 0..255
    pct_over: float   # percent of pixels whose per-channel mean diff exceeds threshold


def pixel_diff(current, target, threshold: int = 40) -> PixelDiff:
    cur = current.convert("RGB").resize(target.size)
    tgt = target.convert("RGB")
    cp, tp = cur.load(), tgt.load()
    w, h = tgt.size
    total_abs = 0
    over = 0
    n = w * h
    for y in range(h):
        for x in range(w):
            cr, cg, cb = cp[x, y][:3]
            tr, tg, tb = tp[x, y][:3]
            d = abs(cr - tr) + abs(cg - tg) + abs(cb - tb)
            total_abs += d
            if d / 3 > threshold:
                over += 1
    return PixelDiff(mean_abs=total_abs / (n * 3), pct_over=100.0 * over / n)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_pixel.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(pixel): pixel_diff whole-image mean-abs + pct-over"
```

---

### Task 2: region_color_delta (per-component colour ΔE vs target image)

**Files:** Modify `$ROOT/src/picode/pixel.py`; Test `$ROOT/tests/test_pixel.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.coords import Box
from picode.pixel import region_color_delta


def test_region_color_delta_zero_for_same_colour_region():
    cream = (250, 248, 243)
    cur = Image.new("RGB", (100, 100), cream)
    tgt = Image.new("RGB", (200, 200), cream)  # different size, same colour
    # region covers the whole image (normalized)
    de = region_color_delta(cur, tgt, Box(0.0, 0.0, 1.0, 1.0))
    assert de == pytest.approx(0.0, abs=1.0)


def test_region_color_delta_flags_warm_vs_light_cream():
    cur = Image.new("RGB", (100, 100), (241, 233, 221))  # current (lighter)
    tgt = Image.new("RGB", (100, 100), (232, 219, 204))  # target (warmer)
    de = region_color_delta(cur, tgt, Box(0.0, 0.0, 1.0, 1.0))
    assert de > 4.0  # a real, visible difference
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_pixel.py -k region_color_delta -q`
Expected: FAIL — `ImportError: cannot import name 'region_color_delta'`.

- [ ] **Step 3: Write minimal implementation (append to pixel.py)**

```python
from picode.coords import Box
from picode.gate import delta_e, sample_region_color


def region_color_delta(current, target, region: Box) -> float:
    """CIE76 ΔE between the median colour of `region` in current vs target.

    `region` is normalized (0..1); it is scaled to each image's own pixel size so
    images of different resolution compare the same area.
    """
    def px_box(img) -> Box:
        w, h = img.size
        return Box(region.x * w, region.y * h, region.w * w, region.h * h)

    cur_rgb = sample_region_color(current.convert("RGB"), px_box(current))
    tgt_rgb = sample_region_color(target.convert("RGB"), px_box(target))
    return delta_e(cur_rgb, tgt_rgb)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_pixel.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(pixel): region_color_delta vs target image (CIE76)"
```

---

### Task 3: path_shape_diff (route/trajectory shape)

Compares two polylines (e.g. the route's sampled points, normalized) by the mean nearest-point distance in each direction. Catches "the route shape is different" that neither bbox nor a single colour can.

**Files:** Modify `$ROOT/src/picode/pixel.py`; Test `$ROOT/tests/test_pixel.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.pixel import path_shape_diff


def test_path_shape_diff_zero_for_same_polyline():
    p = [(0.0, 0.0), (0.5, 0.2), (1.0, 0.1)]
    assert path_shape_diff(p, p) == pytest.approx(0.0)


def test_path_shape_diff_grows_with_divergence():
    a = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)]   # flat line
    b = [(0.0, 0.0), (0.5, 0.4), (1.0, 0.0)]   # arched line
    assert path_shape_diff(a, b) > 0.1
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_pixel.py -k path_shape_diff -q`
Expected: FAIL — `ImportError: cannot import name 'path_shape_diff'`.

- [ ] **Step 3: Write minimal implementation (append to pixel.py)**

```python
import math


def _mean_nearest(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> float:
    return sum(min(math.dist(pa, pb) for pb in b) for pa in a) / len(a)


def path_shape_diff(
    a: list[tuple[float, float]], b: list[tuple[float, float]]
) -> float:
    """Symmetric mean nearest-point distance between two normalized polylines."""
    if not a or not b:
        raise ValueError("both polylines must be non-empty")
    return (_mean_nearest(a, b) + _mean_nearest(b, a)) / 2
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_pixel.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(pixel): path_shape_diff symmetric mean nearest-point"
```

---

## Done criteria

`cd ~/.claude/skills/pic-to-code && uv run pytest -q` — all pass (63 from plans 1-7 + 6 new = 69). The L1 layer now scores whole-image pixel difference, per-region colour ΔE against the actual target image, and route/path shape divergence — the colour/shape signals the geometry gate is blind to.
