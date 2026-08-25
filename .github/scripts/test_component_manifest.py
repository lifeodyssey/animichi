#!/usr/bin/env python3
"""Behavioral tests for the component manifest validator."""

import json
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import cast

from component_manifest_schema import Component, Manifest

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


def mutated(change: Callable[[Manifest], None]) -> subprocess.CompletedProcess[str]:
    document = cast(Manifest, json.loads(MANIFEST.read_text()))
    change(document)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "components.json"
        path.write_text(json.dumps(document))
        return validate(path)


def add_test_trigger(document: Manifest, trigger: str) -> None:
    component = next(item for item in document["components"] if item["name"] == "docs")
    component["paths"].append(trigger)
    component["test_triggers"].append(trigger)


def docs_component(document: Manifest) -> Component:
    return next(item for item in document["components"] if item["name"] == "docs")


def assert_rejected(result: subprocess.CompletedProcess[str], message: str) -> None:
    assert result.returncode == 1
    assert message in result.stderr


def assert_manifest_shape() -> None:
    assert validate(MANIFEST).returncode == 0
    assert_rejected(mutated(lambda doc: doc.update(schema_version=1)), "schema_version must be 2")
    assert_rejected(mutated(lambda doc: doc.pop("repository_paths")), "repository-owned paths")
    assert_rejected(mutated(lambda doc: doc.pop("deploy_triggers")), "deploy triggers")


def assert_deploy_trigger_shape() -> None:
    assert_rejected(mutated(lambda doc: doc["deploy_triggers"].__setitem__(0, "invalid")), "must be an object")
    assert_rejected(mutated(lambda doc: doc["deploy_triggers"][0].__setitem__("paths", "invalid")), "paths must be")
    assert_rejected(mutated(lambda doc: doc["deploy_triggers"][0].__setitem__("paths", [])), "paths must be")
    assert_rejected(mutated(lambda doc: doc["deploy_triggers"][0].__setitem__("paths", ["missing.yml"])), "lane path")
    assert_rejected(mutated(lambda doc: doc["deploy_triggers"][0].__setitem__("components", [])), "components must be")
    assert_rejected(mutated(lambda doc: doc["deploy_triggers"][0]["components"].append("missing")), "unknown or non-deployable")
    assert_rejected(mutated(lambda doc: doc["deploy_triggers"][0]["components"].append("docs")), "unknown or non-deployable")


def assert_path_ownership() -> None:
    assert_rejected(mutated(lambda doc: doc["components"][1]["paths"].append("apps/agent/**")), "overlap")
    assert_rejected(mutated(lambda doc: docs_component(doc)["test_triggers"].append("docs/**")), "test trigger")
    assert_rejected(mutated(lambda doc: add_test_trigger(doc, "docs/**")), "exact tracked file")
    assert_rejected(mutated(lambda doc: add_test_trigger(doc, "README.md")), "not owned by another component")
    assert_rejected(mutated(lambda doc: docs_component(doc).pop("test_triggers")), "declared as a test trigger")
    assert_rejected(mutated(lambda doc: doc["components"][0].pop("deploy_excludes")), "invalid deploy excludes")
    assert_rejected(mutated(lambda doc: doc["components"][0]["deploy_excludes"].append("README.md")), "deploy exclude escapes")


def assert_component_graph() -> None:
    assert_rejected(mutated(lambda doc: doc["components"][0]["depends_on"].append("missing")), "unknown dependency")
    assert_rejected(mutated(lambda doc: doc["components"][2]["depends_on"].append("agent")), "cycle")
    assert_rejected(mutated(lambda doc: doc["components"].pop(8)), "unknown components")


def main() -> None:
    assert_manifest_shape()
    assert_deploy_trigger_shape()
    assert_path_ownership()
    assert_component_graph()
    print("component manifest: workspace coverage, ownership, references, and DAG validated")


if __name__ == "__main__":
    main()
