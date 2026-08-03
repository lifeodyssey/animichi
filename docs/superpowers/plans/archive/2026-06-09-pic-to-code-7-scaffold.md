# Pic-to-Code Plan 7: Scaffold Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Greenfield generation. From classified layout-component regions plus their containment relations, build a component tree (nested per containment), derive PascalCase names from `component_id`, emit a deterministic TSX scaffold per component (carrying its design-target reference), and produce idempotent registry entries.

**Architecture:** New module `picode/scaffold.py`. Pure functions over plan-1 `picode.manifest` and plan-2 `picode.segment` relations. The TSX is template-based and deterministic (the LLM-written richer body is a later enhancement; the scaffold MVP is a correct, registered stub). No LLM, no browser.

**Tech Stack:** Python 3.12, pytest.

---

## File Structure

- `~/.claude/skills/pic-to-code/src/picode/scaffold.py`
- `~/.claude/skills/pic-to-code/tests/test_scaffold.py`

`$ROOT = ~/.claude/skills/pic-to-code`.

---

### Task 1: component_name (id → PascalCase)

**Files:** Create `$ROOT/src/picode/scaffold.py`; Test `$ROOT/tests/test_scaffold.py`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_scaffold.py
import pytest
from picode.scaffold import component_name


def test_component_name_pascalcases_dotted_id():
    assert component_name("hero.sceneCard") == "HeroSceneCard"
    assert component_name("route.spot") == "RouteSpot"
    assert component_name("footer") == "Footer"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_scaffold.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'picode.scaffold'`.

- [ ] **Step 3: Write minimal implementation**

```python
# src/picode/scaffold.py
from __future__ import annotations


def component_name(component_id: str) -> str:
    parts = component_id.replace(".", " ").replace("-", " ").replace("_", " ").split()
    return "".join(p[:1].upper() + p[1:] for p in parts)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_scaffold.py -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(scaffold): component_name id->PascalCase"
```

---

### Task 2: build_component_tree (containment → nesting)

Turns a flat region list + relations into a parent/child tree. A `contains` relation makes the contained region a child; regions contained by none are roots. Children sort by their order of appearance.

**Files:** Modify `$ROOT/src/picode/scaffold.py`; Test `$ROOT/tests/test_scaffold.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.manifest import Relation
from picode.scaffold import build_component_tree, Node


def test_build_component_tree_nests_contained_children():
    ids = ["hero.search", "hero.chip", "footer"]
    rels = [Relation(a="hero.search", b="hero.chip", kind="contains")]
    roots = build_component_tree(ids, rels)
    # roots: hero.search (with child hero.chip) and footer
    by_id = {n.component_id: n for n in roots}
    assert set(by_id) == {"hero.search", "footer"}
    assert [c.component_id for c in by_id["hero.search"].children] == ["hero.chip"]
    assert by_id["footer"].children == []


def test_build_component_tree_all_roots_when_no_containment():
    roots = build_component_tree(["a", "b"], [])
    assert {n.component_id for n in roots} == {"a", "b"}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_scaffold.py -k build_component_tree -q`
Expected: FAIL — `ImportError: cannot import name 'build_component_tree'`.

- [ ] **Step 3: Write minimal implementation (append to scaffold.py)**

```python
from dataclasses import dataclass, field

from picode.manifest import Relation


@dataclass
class Node:
    component_id: str
    children: list["Node"] = field(default_factory=list)


def build_component_tree(
    component_ids: list[str], relations: list[Relation]
) -> list[Node]:
    nodes = {cid: Node(component_id=cid) for cid in component_ids}
    child_ids: set[str] = set()
    for rel in relations:
        if rel.kind == "contains" and rel.a in nodes and rel.b in nodes:
            nodes[rel.a].children.append(nodes[rel.b])
            child_ids.add(rel.b)
    return [nodes[cid] for cid in component_ids if cid not in child_ids]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_scaffold.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(scaffold): build_component_tree from containment relations"
```

---

### Task 3: scaffold_tsx (template, carries design-target ref)

**Files:** Modify `$ROOT/src/picode/scaffold.py`; Test `$ROOT/tests/test_scaffold.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from picode.scaffold import scaffold_tsx


def test_scaffold_tsx_has_name_and_design_target():
    tsx = scaffold_tsx("hero.sceneCard", design_target="/design-targets/hero.sceneCard.png")
    assert "export default function HeroSceneCard()" in tsx
    assert "/design-targets/hero.sceneCard.png" in tsx
    assert 'data-measure="hero.sceneCard"' in tsx
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_scaffold.py -k scaffold_tsx -q`
Expected: FAIL — `ImportError: cannot import name 'scaffold_tsx'`.

- [ ] **Step 3: Write minimal implementation (append to scaffold.py)**

```python
def scaffold_tsx(component_id: str, design_target: str) -> str:
    name = component_name(component_id)
    return (
        f"// design target: {design_target}\n"
        f"export default function {name}() {{\n"
        f'  return (\n'
        f'    <div data-measure="{component_id}">\n'
        f"      {{/* scaffolded from {design_target}; fill in real content */}}\n"
        f"    </div>\n"
        f"  );\n"
        f"}}\n"
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_scaffold.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(scaffold): scaffold_tsx template with data-measure + design target"
```

---

### Task 4: registry_entry + write_scaffolds (idempotent by id)

**Files:** Modify `$ROOT/src/picode/scaffold.py`; Test `$ROOT/tests/test_scaffold.py`.

- [ ] **Step 1: Write the failing test (append)**

```python
from pathlib import Path
from picode.scaffold import registry_entry, write_scaffolds


def test_registry_entry_maps_id_to_component():
    assert registry_entry("hero.fox") == '  "hero.fox": HeroFox,'


def test_write_scaffolds_idempotent_by_id(tmp_path: Path):
    paths1 = write_scaffolds(["hero.card"], out_dir=tmp_path)
    paths2 = write_scaffolds(["hero.card"], out_dir=tmp_path)  # rerun
    assert paths1 == paths2  # same key/path, overwrite not append
    assert (tmp_path / "HeroCard.tsx").exists()
    assert list(tmp_path.glob("*.tsx")) == [tmp_path / "HeroCard.tsx"]  # no dupes
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd $ROOT && uv run pytest tests/test_scaffold.py -k "registry_entry or write_scaffolds" -q`
Expected: FAIL — `ImportError: cannot import name 'registry_entry'`.

- [ ] **Step 3: Write minimal implementation (append to scaffold.py)**

```python
from pathlib import Path


def registry_entry(component_id: str) -> str:
    return f'  "{component_id}": {component_name(component_id)},'


def write_scaffolds(component_ids: list[str], out_dir: Path) -> dict[str, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for cid in component_ids:
        p = out_dir / f"{component_name(cid)}.tsx"
        p.write_text(scaffold_tsx(cid, f"/design-targets/{cid}.png"))
        paths[cid] = p  # keyed by id -> overwrite on rerun, never duplicate
    return paths
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd $ROOT && uv run pytest tests/test_scaffold.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
cd "$ROOT" && git add -A && git commit -q -m "feat(scaffold): registry_entry + idempotent write_scaffolds"
```

---

## Done criteria

`cd ~/.claude/skills/pic-to-code && uv run pytest -q` — all pass (57 from plans 1-6 + 6 new = 63). The scaffold driver builds a containment-nested component tree, derives PascalCase names, emits deterministic TSX stubs carrying `data-measure` + the design-target reference, and writes them idempotently by `component_id` with registry entries. This completes the pic-to-code core: segmentation → resolution → classification → (align | scaffold | vectorize) → algorithmic gates.
