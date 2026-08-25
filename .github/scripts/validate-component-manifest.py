#!/usr/bin/env python3
"""Validate the repository's explicit CI component graph."""

import argparse
import json
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import cast

from component_manifest_schema import Component, GlobalLane, Manifest, validate_shape


def fail(message: str) -> None:
    raise ValueError(message)


def workspace_names(root: Path) -> set[str]:
    library = root / "scripts/local-gates/workspace-packages.sh"
    command = f'source "{library}"; load_workspace_packages; printf \'%s\\n\' "$WORKSPACE_NAMES"'
    result = subprocess.run(["bash", "-c", command], cwd=root, check=False, capture_output=True, text=True)
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


def component_names(components: list[Component]) -> set[str]:
    names = [component.get("name") for component in components]
    if any(not isinstance(name, str) or not name for name in names):
        fail("every component needs a non-empty name")
    if len(names) != len(set(names)):
        fail("component names must be unique")
    return set(names)


def string_list(value: object, message: str, nonempty: bool = False) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        fail(message)
    if nonempty and not value:
        fail(message)
    return list(value)


def validate_trigger_membership(name: str, paths: list[str], test_triggers: list[str]) -> None:
    if not set(test_triggers).issubset(paths):
        fail(f"component {name} test trigger is missing from paths")
    unmarked = [path for path in paths if not path.endswith("/**") and path not in test_triggers]
    if unmarked:
        fail(f"component {name} exact path must be declared as a test trigger")


def validate_metadata(component: Component) -> None:
    name = component["name"]
    paths = string_list(component.get("paths"), f"component {name} has no paths", True)
    triggers = string_list(component.get("test_triggers", []), f"component {name} has invalid test triggers")
    string_list(component.get("deploy_excludes"), f"component {name} has invalid deploy excludes")
    string_list(component.get("ci_lanes"), f"component {name} has invalid ci_lanes", True)
    validate_trigger_membership(name, paths, triggers)
    unit = component.get("deploy_unit")
    if unit is not None and not isinstance(unit, str):
        fail(f"component {name} has invalid deploy_unit")


def validate_trigger_owners(triggers: list[tuple[str, str]], owners: list[tuple[str, str]]) -> None:
    for trigger, component in triggers:
        owned = any(owner != component and (trigger == root or trigger.startswith(f"{root}/")) for root, owner in owners)
        if not owned:
            fail(f"component {component} test trigger is not owned by another component")


def selector_root(pattern: str) -> str:
    return pattern.removesuffix("/**").rstrip("/")


def validate_deploy_excludes(root: Path, component: Component, owner_patterns: set[str]) -> None:
    for exclusion in component["deploy_excludes"]:
        validate_selector(root, exclusion)
        excluded_root = selector_root(exclusion)
        if not any(excluded_root == selector_root(owner) or excluded_root.startswith(f"{selector_root(owner)}/") for owner in owner_patterns):
            fail(f"component {component['name']} deploy exclude escapes its owned paths")


def validate_test_triggers(root: Path, component: Component, triggers: set[str]) -> list[tuple[str, str]]:
    records: list[tuple[str, str]] = []
    for trigger in triggers:
        if trigger.endswith("/**"):
            fail(f"component {component['name']} test trigger must be an exact tracked file")
        validate_selector(root, trigger)
        records.append((trigger, component["name"]))
    return records


def component_paths(root: Path, component: Component) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    validate_metadata(component)
    triggers = set(component.get("test_triggers", []))
    owner_patterns = set(component["paths"]) - triggers
    validate_deploy_excludes(root, component, owner_patterns)
    owners = [(path_root(pattern), component["name"]) for pattern in owner_patterns]
    return owners, validate_test_triggers(root, component, triggers)


def roots_overlap(left: str, right: str) -> bool:
    return left == right or left.startswith(f"{right}/") or right.startswith(f"{left}/")


def validate_unique_owners(owners: list[tuple[str, str]]) -> None:
    for index, (root, component) in enumerate(owners):
        for other_root, owner in owners[:index]:
            if roots_overlap(root, other_root):
                fail(f"component path overlap: {component} and {owner}")


def validate_paths(root: Path, components: list[Component]) -> None:
    owners: list[tuple[str, str]] = []
    triggers: list[tuple[str, str]] = []
    for component in components:
        component_owners, component_triggers = component_paths(root, component)
        owners.extend(component_owners)
        triggers.extend(component_triggers)
    validate_unique_owners(owners)
    validate_trigger_owners(triggers, owners)


def validate_dependencies(components: list[Component], names: set[str]) -> None:
    for component in components:
        dependencies = component.get("depends_on")
        if not isinstance(dependencies, list):
            fail(f"component {component['name']} has invalid depends_on")
        for dependency in dependencies:
            if dependency not in names:
                fail(f"unknown dependency {dependency} in {component['name']}")


def validate_global_lane(root: Path, lane: GlobalLane, names: set[str]) -> None:
    for pattern in lane.get("paths", []):
        validate_selector(root, pattern)
    unknown = set(lane.get("components", [])) - names
    if unknown:
        fail(f"global lane {lane['name']} references unknown components")


def validate_global_lanes(root: Path, document: Manifest, names: set[str]) -> None:
    lanes = document["global_lanes"]
    lane_names = [lane["name"] for lane in lanes]
    if len(lane_names) != len(set(lane_names)):
        fail("global lane names must be unique")
    for lane in lanes:
        validate_global_lane(root, lane, names)


def validate_repository_paths(root: Path, document: Manifest) -> None:
    for pattern in document["repository_paths"]:
        validate_selector(root, pattern)


def nonempty_strings(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
        fail(f"{label} must be a non-empty string array")
    return list(value)


def validate_deploy_trigger(root: Path, trigger: object, deployable: set[str]) -> None:
    if not isinstance(trigger, dict):
        fail("deploy trigger must be an object")
    mapped = cast(Mapping[str, object], trigger)
    paths = nonempty_strings(mapped.get("paths"), "deploy trigger paths")
    components = nonempty_strings(mapped.get("components"), "deploy trigger components")
    for pattern in paths:
        validate_selector(root, pattern)
    if unknown := set(components) - deployable:
        fail(f"deploy trigger references unknown or non-deployable components: {', '.join(sorted(unknown))}")


def validate_deploy_triggers(root: Path, document: Manifest, deployable: set[str]) -> None:
    triggers = document.get("deploy_triggers")
    if not isinstance(triggers, list) or not triggers:
        fail("manifest needs deploy triggers")
    for trigger in triggers:
        validate_deploy_trigger(root, trigger, deployable)


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


def validate_dag(components: list[Component]) -> None:
    graph = {str(item["name"]): list(item["depends_on"]) for item in components}
    visited: set[str] = set()
    for name in graph:
        visit(name, graph, set(), visited)


def validate_workspaces(root: Path, components: list[Component]) -> None:
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


def validate_manifest_relations(root: Path, document: Manifest) -> None:
    components = document["components"]
    names = component_names(components)
    validate_repository_paths(root, document)
    validate_dependencies(components, names)
    validate_global_lanes(root, document, names)
    validate_dag(components)
    validate_workspaces(root, components)


def validate_manifest(root: Path, manifest: Path) -> int:
    document = validate_shape(json.loads(manifest.read_text()))
    components = document["components"]
    validate_paths(root, components)
    validate_manifest_relations(root, document)
    deployable = {str(item["name"]) for item in components if item["deploy_unit"] is not None}
    validate_deploy_triggers(root, document, deployable)
    return len(components)


def main() -> int:
    args = parse_args()
    try:
        count = validate_manifest(args.root, args.manifest)
    except (OSError, TypeError, json.JSONDecodeError, ValueError) as error:
        print(f"component-manifest: {error}", file=sys.stderr)
        return 1
    print(f"component-manifest: {count} components valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
