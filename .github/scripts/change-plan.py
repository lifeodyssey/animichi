#!/usr/bin/env python3
"""Build an affected-component plan from an explicit Git range."""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import TypedDict

from component_manifest_schema import (
    Component,
    DeployTrigger,
    GlobalLane,
    Manifest,
    load_manifest,
)


class ComponentSelection(TypedDict):
    direct: set[str]
    source_direct: set[str]
    selected: set[str]
    source_selected: set[str]
    fallback: bool


class ChangePlan(TypedDict):
    range_mode: str
    purpose: str
    base: str
    diff_base: str
    head: str
    changed_paths: list[str]
    direct_components: list[str]
    source_components: list[str]
    test_trigger_components: list[str]
    components: list[str]
    lanes: list[str]
    fallback_all: bool


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, check=False, capture_output=True, text=True
    )
    if result.returncode != 0:
        raise ValueError(result.stderr.strip() or "git command failed")
    return result.stdout.strip()


def require_commit(root: Path, revision: str) -> None:
    git(root, "rev-parse", "--verify", f"{revision}^{{commit}}")


def diff_base(root: Path, base: str, head: str, mode: str) -> str:
    if mode == "main":
        return base
    return git(root, "merge-base", base, head)


def changed_paths(root: Path, base: str, head: str) -> list[str]:
    output = git(root, "diff", "--name-only", "--no-renames", f"{base}..{head}")
    return sorted(filter(None, output.splitlines()))


def owns(pattern: str, path: str) -> bool:
    if not pattern.endswith("/**"):
        return path == pattern
    root = pattern.removesuffix("/**").rstrip("/")
    return path == root or path.startswith(f"{root}/")


def component_owns(component: Component, path: str, purpose: str) -> bool:
    if not any(owns(pattern, path) for pattern in component["paths"]):
        return False
    if purpose == "ci":
        return True
    excluded = list(component["deploy_excludes"])
    if purpose == "deploy":
        excluded += list(component.get("test_triggers", []))
    return not any(owns(pattern, path) for pattern in excluded)


def owners_for_path(components: list[Component], path: str, purpose: str) -> set[str]:
    return {
        str(item["name"]) for item in components if component_owns(item, path, purpose)
    }


def known_component_path(components: list[Component], path: str) -> bool:
    return any(component_owns(item, path, "ci") for item in components)


def direct_components(
    components: list[Component],
    repository_paths: list[str],
    paths: list[str],
    purpose: str,
) -> tuple[set[str], bool]:
    selected: set[str] = set()
    fallback = not paths
    for path in paths:
        owners = owners_for_path(components, path, purpose)
        repository_owned = any(owns(pattern, path) for pattern in repository_paths)
        if (
            not owners
            and not repository_owned
            and not known_component_path(components, path)
        ):
            fallback = True
        selected.update(owners)
    return selected, fallback


def triggered_deployments(triggers: list[DeployTrigger], paths: list[str]) -> set[str]:
    selected: set[str] = set()
    for trigger in triggers:
        if any(owns(pattern, path) for pattern in trigger["paths"] for path in paths):
            selected.update(trigger["components"])
    return selected


def deployment_inputs(
    components: list[Component],
    repository_paths: list[str],
    triggers: list[DeployTrigger],
    paths: list[str],
) -> tuple[set[str], set[str], bool]:
    direct, fallback = direct_components(components, repository_paths, paths, "deploy")
    triggered = triggered_deployments(triggers, paths)
    names = {item["name"] for item in components}
    return direct, triggered & names, fallback or bool(triggered - names)


def reverse_consumers(components: list[Component]) -> dict[str, set[str]]:
    consumers: dict[str, set[str]] = {str(item["name"]): set() for item in components}
    for component in components:
        for dependency in component["depends_on"]:
            consumers[str(dependency)].add(str(component["name"]))
    return consumers


def reverse_closure(components: list[Component], selected: set[str]) -> set[str]:
    consumers = reverse_consumers(components)
    pending = list(selected)
    while pending:
        for consumer in consumers[pending.pop()]:
            if consumer not in selected:
                selected.add(consumer)
                pending.append(consumer)
    return selected


def selected_lanes(
    lanes: list[GlobalLane], paths: list[str], selected: set[str], fallback: bool
) -> list[str]:
    result = []
    for lane in lanes:
        path_match = any(
            owns(pattern, path) for pattern in lane.get("paths", []) for path in paths
        )
        component_match = bool(selected.intersection(lane.get("components", [])))
        fallback_match = fallback and not lane.get("paths")
        if fallback_match or lane.get("always") or path_match or component_match:
            result.append(str(lane["name"]))
    return sorted(result)


def purpose_direct(
    components: list[Component],
    repository_paths: list[str],
    paths: list[str],
    purpose: str,
    triggered: set[str],
) -> tuple[set[str], set[str]]:
    source = direct_components(components, repository_paths, paths, "propagation")[0]
    direct = direct_components(components, repository_paths, paths, purpose)[0]
    if purpose == "deploy":
        direct.update(triggered)
    return direct, source


def resolved_components(
    components: list[Component],
    direct: set[str],
    seed: set[str],
    triggered: set[str],
    fallback: bool,
) -> set[str]:
    if fallback:
        return {item["name"] for item in components}
    return direct | reverse_closure(components, seed.copy()) | triggered


def select_components(
    document: Manifest, paths: list[str], purpose: str
) -> ComponentSelection:
    components = document["components"]
    deploy_direct, triggered, fallback = deployment_inputs(
        components, document["repository_paths"], document["deploy_triggers"], paths
    )
    direct, source_direct = purpose_direct(
        components, document["repository_paths"], paths, purpose, triggered
    )
    active_triggers = triggered if purpose == "deploy" else set()
    closure_seed = deploy_direct if purpose == "deploy" else source_direct
    selected = resolved_components(
        components, direct, closure_seed, active_triggers, fallback
    )
    source_selected = (
        selected if fallback else reverse_closure(components, source_direct.copy())
    )
    return {
        "direct": direct,
        "source_direct": source_direct,
        "selected": selected,
        "source_selected": source_selected,
        "fallback": fallback,
    }


def plan_output(
    mode: str,
    purpose: str,
    base: str,
    effective_base: str,
    head: str,
    paths: list[str],
    selection: ComponentSelection,
    lanes: list[str],
) -> ChangePlan:
    return {
        "range_mode": mode,
        "purpose": purpose,
        "base": base,
        "diff_base": effective_base,
        "head": head,
        "changed_paths": paths,
        "direct_components": sorted(selection["direct"]),
        "source_components": sorted(selection["source_direct"]),
        "test_trigger_components": sorted(
            selection["direct"] - selection["source_direct"]
        ),
        "components": sorted(selection["selected"]),
        "lanes": lanes,
        "fallback_all": selection["fallback"],
    }


def build_plan(
    root: Path, manifest: Path, base: str, head: str, mode: str, purpose: str
) -> ChangePlan:
    require_commit(root, base)
    require_commit(root, head)
    document = load_manifest(manifest)
    effective_base = diff_base(root, base, head, mode)
    paths = changed_paths(root, effective_base, head)
    selection = select_components(document, paths, purpose)
    lanes = selected_lanes(
        document["global_lanes"],
        paths,
        selection["source_selected"],
        selection["fallback"],
    )
    return plan_output(
        mode, purpose, base, effective_base, head, paths, selection, lanes
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--range", choices=("pr", "main"), required=True)
    parser.add_argument("--purpose", choices=("ci", "deploy"), default="ci")
    parser.add_argument("--format", choices=("json", "names"), default="json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = args.manifest or args.root / ".github/ci/components.json"
    try:
        plan = build_plan(
            args.root, manifest, args.base, args.head, args.range, args.purpose
        )
    except (OSError, KeyError, json.JSONDecodeError, ValueError) as error:
        print(f"change-plan: {error}", file=sys.stderr)
        return 1
    print(
        json.dumps(plan, separators=(",", ":"))
        if args.format == "json"
        else "\n".join(plan["components"])
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
