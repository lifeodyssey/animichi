#!/usr/bin/env python3
"""Validate the repository's explicit CI component graph."""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> None:
    raise ValueError(message)


def workspace_names(root: Path) -> set[str]:
    library = root / "scripts/local-gates/workspace-packages.sh"
    command = f'source "{library}"; load_workspace_packages; printf \'%s\\n\' "$WORKSPACE_NAMES"'
    result = subprocess.run(["bash", "-c", command], cwd=root, capture_output=True, text=True)
    if result.returncode != 0:
        fail("workspace discovery failed")
    return set(result.stdout.split())


def path_root(pattern: str) -> str:
    if not pattern.endswith("/**") or pattern.startswith("/"):
        fail(f"component path must be a repository prefix ending in /**: {pattern}")
    return pattern.removesuffix("/**").rstrip("/")


def validate_selector(root: Path, pattern: str) -> None:
    if pattern.endswith("/**"):
        path_root(pattern)
        return
    if pattern.startswith("/") or not (root / pattern).is_file():
        fail(f"lane path must be a repository prefix or tracked file: {pattern}")


def validate_shape(document: object) -> list[dict[str, object]]:
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        fail("manifest schema_version must be 1")
    if document.get("unknown_changes") != "all":
        fail("unknown changes must fail closed to all components")
    repository_paths = document.get("repository_paths")
    if not isinstance(repository_paths, list) or not repository_paths:
        fail("manifest needs repository-owned paths")
    if not all(isinstance(path, str) for path in repository_paths):
        fail("repository-owned paths must be strings")
    lanes = document.get("global_lanes")
    if not isinstance(lanes, list) or not lanes:
        fail("manifest needs at least one global lane")
    for lane in lanes:
        selectors = (lane.get("always"), lane.get("paths"), lane.get("components")) if isinstance(lane, dict) else ()
        if not isinstance(lane, dict) or not lane.get("name") or not any(selectors):
            fail("global lane metadata is invalid")
    components = document.get("components")
    if not isinstance(components, list) or not components:
        fail("manifest components must be a non-empty array")
    return components


def component_names(components: list[dict[str, object]]) -> set[str]:
    names = [component.get("name") for component in components]
    if any(not isinstance(name, str) or not name for name in names):
        fail("every component needs a non-empty name")
    if len(names) != len(set(names)):
        fail("component names must be unique")
    return set(names)


def validate_metadata(component: dict[str, object]) -> None:
    paths = component.get("paths")
    test_triggers = component.get("test_triggers", [])
    lanes = component.get("ci_lanes")
    unit = component.get("deploy_unit")
    if not isinstance(paths, list) or not paths or not all(isinstance(path, str) for path in paths):
        fail(f"component {component['name']} has no paths")
    if not isinstance(test_triggers, list) or not all(isinstance(path, str) for path in test_triggers):
        fail(f"component {component['name']} has invalid test triggers")
    if not set(test_triggers).issubset(paths):
        fail(f"component {component['name']} test trigger is missing from paths")
    unmarked = [path for path in paths if not path.endswith("/**") and path not in test_triggers]
    if unmarked:
        fail(f"component {component['name']} exact path must be declared as a test trigger")
    if not isinstance(lanes, list) or not lanes or not all(isinstance(lane, str) for lane in lanes):
        fail(f"component {component['name']} has invalid ci_lanes")
    if unit is not None and not isinstance(unit, str):
        fail(f"component {component['name']} has invalid deploy_unit")


def validate_trigger_owners(triggers: list[tuple[str, str]], owners: list[tuple[str, str]]) -> None:
    for trigger, component in triggers:
        owned = any(owner != component and (trigger == root or trigger.startswith(f"{root}/")) for root, owner in owners)
        if not owned:
            fail(f"component {component} test trigger is not owned by another component")


def validate_paths(root: Path, components: list[dict[str, object]]) -> None:
    owners: list[tuple[str, str]] = []
    triggers: list[tuple[str, str]] = []
    for component in components:
        validate_metadata(component)
        test_triggers = set(component.get("test_triggers", []))
        for trigger in test_triggers:
            if trigger.endswith("/**"):
                fail(f"component {component['name']} test trigger must be an exact tracked file")
            validate_selector(root, trigger)
            triggers.append((trigger, str(component["name"])))
        for pattern in set(component["paths"]) - test_triggers:
            component_root = path_root(pattern)
            for other_root, owner in owners:
                if component_root == other_root or component_root.startswith(f"{other_root}/") or other_root.startswith(f"{component_root}/"):
                    fail(f"component path overlap: {component['name']} and {owner}")
            owners.append((component_root, str(component["name"])))
    validate_trigger_owners(triggers, owners)


def validate_dependencies(components: list[dict[str, object]], names: set[str]) -> None:
    for component in components:
        dependencies = component.get("depends_on")
        if not isinstance(dependencies, list):
            fail(f"component {component['name']} has invalid depends_on")
        for dependency in dependencies:
            if dependency not in names:
                fail(f"unknown dependency {dependency} in {component['name']}")


def validate_global_lanes(root: Path, document: dict[str, object], names: set[str]) -> None:
    lanes = document["global_lanes"]
    lane_names = [lane["name"] for lane in lanes]
    if len(lane_names) != len(set(lane_names)):
        fail("global lane names must be unique")
    for lane in lanes:
        workflow = lane.get("workflow")
        if workflow and not (root / workflow).is_file():
            fail(f"global lane {lane['name']} workflow is missing")
        for pattern in lane.get("paths", []):
            validate_selector(root, pattern)
        unknown = set(lane.get("components", [])) - names
        if unknown:
            fail(f"global lane {lane['name']} references unknown components")


def validate_repository_paths(root: Path, document: dict[str, object]) -> None:
    for pattern in document["repository_paths"]:
        validate_selector(root, pattern)


def visit(name: str, graph: dict[str, list[str]], visiting: set[str], visited: set[str]) -> None:
    if name in visiting:
        fail(f"component dependency cycle includes {name}")
    if name in visited:
        return
    visiting.add(name)
    for dependency in graph[name]:
        visit(dependency, graph, visiting, visited)
    visiting.remove(name)
    visited.add(name)


def validate_dag(components: list[dict[str, object]]) -> None:
    graph = {str(item["name"]): list(item["depends_on"]) for item in components}
    visited: set[str] = set()
    for name in graph:
        visit(name, graph, set(), visited)


def validate_workspaces(root: Path, components: list[dict[str, object]]) -> None:
    expected = workspace_names(root)
    actual = {str(component["name"]) for component in components}
    missing = expected - actual
    if missing:
        fail(f"workspace components are missing: {', '.join(sorted(missing))}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        document = json.loads(args.manifest.read_text())
        components = validate_shape(document)
        names = component_names(components)
        validate_paths(args.root, components)
        validate_repository_paths(args.root, document)
        validate_dependencies(components, names)
        validate_global_lanes(args.root, document, names)
        validate_dag(components)
        validate_workspaces(args.root, components)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"component-manifest: {error}", file=sys.stderr)
        return 1
    print(f"component-manifest: {len(components)} components valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
