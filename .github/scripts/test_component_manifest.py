#!/usr/bin/env python3
"""Behavioral tests for the component manifest validator."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / ".github/scripts/validate-component-manifest.py"
MANIFEST = ROOT / ".github/ci/components.json"


def validate(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(VALIDATOR), "--manifest", str(path), "--root", str(ROOT)],
        check=False,
        capture_output=True,
        text=True,
    )


def mutated(change: Callable[[dict[str, object]], None]) -> subprocess.CompletedProcess[str]:
    document = json.loads(MANIFEST.read_text())
    change(document)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "components.json"
        path.write_text(json.dumps(document))
        return validate(path)


def add_test_trigger(document: dict[str, object], trigger: str) -> None:
    component = document["components"][0]
    component["paths"].append(trigger)
    component["test_triggers"].append(trigger)


def main() -> None:
    assert validate(MANIFEST).returncode == 0
    overlap = mutated(lambda doc: doc["components"][1]["paths"].append("apps/agent/**"))
    assert overlap.returncode == 1 and "overlap" in overlap.stderr
    unknown = mutated(lambda doc: doc["components"][0]["depends_on"].append("missing"))
    assert unknown.returncode == 1 and "unknown dependency" in unknown.stderr
    cycle = mutated(lambda doc: doc["components"][2]["depends_on"].append("agent"))
    assert cycle.returncode == 1 and "cycle" in cycle.stderr
    trigger = mutated(lambda doc: doc["components"][0]["test_triggers"].append("docs/**"))
    assert trigger.returncode == 1 and "test trigger" in trigger.stderr
    broad = mutated(lambda doc: add_test_trigger(doc, "docs/**"))
    assert broad.returncode == 1 and "exact tracked file" in broad.stderr
    orphan = mutated(lambda doc: add_test_trigger(doc, "README.md"))
    assert orphan.returncode == 1 and "not owned by another component" in orphan.stderr
    unmarked = mutated(lambda doc: doc["components"][0].pop("test_triggers"))
    assert unmarked.returncode == 1 and "declared as a test trigger" in unmarked.stderr
    missing = mutated(lambda doc: doc["components"].pop(8))
    assert missing.returncode == 1 and "unknown components" in missing.stderr
    print("component manifest: workspace coverage, ownership, references, and DAG validated")


if __name__ == "__main__":
    main()
