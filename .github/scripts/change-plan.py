#!/usr/bin/env python3
"""Build an affected-component plan from an explicit Git range."""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
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


def routed_paths(component: dict[str, object], purpose: str) -> list[str]:
    paths = list(component["paths"])
    if purpose == "ci":
        return paths
    test_triggers = set(component.get("test_triggers", []))
    return [path for path in paths if path not in test_triggers]


def owners_for_path(components: list[dict[str, object]], path: str, purpose: str) -> set[str]:
    return {
        str(item["name"])
        for item in components
        if any(owns(pattern, path) for pattern in routed_paths(item, purpose))
    }


def direct_components(
    components: list[dict[str, object]], repository_paths: list[str], paths: list[str], purpose: str
) -> tuple[set[str], bool]:
    selected: set[str] = set()
    fallback = not paths
    for path in paths:
        owners = owners_for_path(components, path, purpose)
        repository_owned = any(owns(pattern, path) for pattern in repository_paths)
        if not owners and not repository_owned:
            fallback = True
        selected.update(owners)
    return selected, fallback


def reverse_closure(components: list[dict[str, object]], selected: set[str]) -> set[str]:
    consumers: dict[str, set[str]] = {str(item["name"]): set() for item in components}
    for component in components:
        for dependency in component["depends_on"]:
            consumers[str(dependency)].add(str(component["name"]))
    pending = list(selected)
    while pending:
        for consumer in consumers[pending.pop()]:
            if consumer not in selected:
                selected.add(consumer)
                pending.append(consumer)
    return selected


def selected_lanes(lanes: list[dict[str, object]], paths: list[str], selected: set[str], fallback: bool) -> list[str]:
    result = []
    for lane in lanes:
        path_match = any(owns(pattern, path) for pattern in lane.get("paths", []) for path in paths)
        component_match = bool(selected.intersection(lane.get("components", [])))
        fallback_match = fallback and not lane.get("paths")
        if fallback_match or lane.get("always") or path_match or component_match:
            result.append(str(lane["name"]))
    return sorted(result)


def build_plan(root: Path, manifest: Path, base: str, head: str, mode: str, purpose: str) -> dict[str, object]:
    require_commit(root, base)
    require_commit(root, head)
    document = json.loads(manifest.read_text())
    components = document["components"]
    repository_paths = document["repository_paths"]
    effective_base = diff_base(root, base, head, mode)
    paths = changed_paths(root, effective_base, head)
    source_direct, fallback = direct_components(components, repository_paths, paths, "deploy")
    direct = direct_components(components, repository_paths, paths, purpose)[0]
    selected = {str(item["name"]) for item in components} if fallback else reverse_closure(components, direct.copy())
    source_selected = selected if fallback else reverse_closure(components, source_direct.copy())
    lanes = selected_lanes(document["global_lanes"], paths, source_selected, fallback)
    return {"range_mode": mode, "purpose": purpose, "base": base, "diff_base": effective_base, "head": head,
            "changed_paths": paths, "direct_components": sorted(direct),
            "source_components": sorted(source_direct),
            "test_trigger_components": sorted(direct - source_direct),
            "components": sorted(selected), "lanes": lanes, "fallback_all": fallback}


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
        plan = build_plan(args.root, manifest, args.base, args.head, args.range, args.purpose)
    except (OSError, KeyError, json.JSONDecodeError, ValueError) as error:
        print(f"change-plan: {error}", file=sys.stderr)
        return 1
    output = json.dumps(plan, separators=(",", ":")) if args.format == "json" else "\n".join(plan["components"])
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
