#!/usr/bin/env python3
"""Turn the canonical changed-component plan into an ordered CD cohort."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from collections.abc import Mapping
from typing import TypedDict


PHASES = {
    "foundation": ("infra",),
    "migration": ("migrator", "db"),
    "services": ("agent", "catalog", "users"),
    "edge": ("edge",),
    "web": ("web",),
}
KNOWN_UNITS = frozenset(unit for units in PHASES.values() for unit in units)
STAGING_ONLY = frozenset(["migrator"])
IMMUTABLE_PAIRS = ({"agent", "edge"}, {"migrator", "db"})


class Component(TypedDict):
    name: str
    deploy_unit: str | None


class Manifest(TypedDict):
    components: list[Component]


class ChangePlan(TypedDict, total=False):
    components: list[str]
    fallback_all: bool


class CohortPlan(TypedDict):
    fallback_all: bool
    fallback_reasons: list[str]
    has_deployments: bool
    deploy_units: list[str]
    production_units: list[str]
    foundation: list[str]
    migration: list[str]
    services: list[str]
    edge: list[str]
    web: list[str]


def fail(message: str) -> None:
    raise ValueError(message)


def load_json(path: Path) -> object:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def read_change_plan() -> object:
    return json.load(sys.stdin)


def expect_mapping(value: object, label: str) -> Mapping[object, object]:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def expect_names(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        fail(f"{label} must be an array of strings")
    return list(value)


def read_components(raw: object) -> list[Component]:
    manifest = expect_mapping(raw, "manifest")
    values = manifest.get("components")
    if not isinstance(values, list):
        fail("manifest.components must be an array")
    return [read_component(value) for value in values]


def read_component(raw: object) -> Component:
    value = expect_mapping(raw, "component")
    name, unit = value.get("name"), value.get("deploy_unit")
    if not isinstance(name, str) or not name:
        fail("component.name must be a non-empty string")
    if unit is not None and not isinstance(unit, str):
        fail(f"component {name} deploy_unit must be string or null")
    return {"name": name, "deploy_unit": unit}


def validate_units(components: list[Component]) -> None:
    unknown = sorted({item["deploy_unit"] for item in components if item["deploy_unit"] not in KNOWN_UNITS | {None}})
    if unknown:
        fail(f"unknown deploy_unit(s): {', '.join(str(item) for item in unknown)}")


def component_map(components: list[Component]) -> dict[str, str | None]:
    names = [item["name"] for item in components]
    if len(names) != len(set(names)):
        fail("manifest component names must be unique")
    return {item["name"]: item["deploy_unit"] for item in components}


def selected_units(plan: Mapping[object, object], mapping: dict[str, str | None]) -> tuple[set[str], list[str]]:
    names = expect_names(plan.get("components"), "change plan components")
    unknown = sorted(set(names) - set(mapping))
    fallback = plan.get("fallback_all") is True or bool(unknown)
    units = {unit for unit in mapping.values() if unit is not None} if fallback else {mapping[name] for name in names if mapping[name] is not None}
    for pair in IMMUTABLE_PAIRS:
        if units.intersection(pair):
            units.update(pair)
    return set(units), unknown


def ordered(units: set[str], phase: str) -> list[str]:
    return [unit for unit in PHASES[phase] if unit in units]


def build_plan(change_raw: object, manifest_raw: object) -> CohortPlan:
    components = read_components(manifest_raw)
    validate_units(components)
    change = expect_mapping(change_raw, "change plan")
    units, unknown = selected_units(change, component_map(components))
    fallback = change.get("fallback_all") is True or bool(unknown)
    phases = {phase: ordered(units, phase) for phase in PHASES}
    deploy_units = [unit for phase in PHASES for unit in phases[phase]]
    production_units = [unit for unit in deploy_units if unit not in STAGING_ONLY]
    return {"fallback_all": fallback, "fallback_reasons": unknown, "has_deployments": bool(units), "deploy_units": deploy_units, "production_units": production_units, "foundation": phases["foundation"], "migration": phases["migration"], "services": phases["services"], "edge": phases["edge"], "web": phases["web"]}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = build_plan(read_change_plan(), load_json(args.manifest))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"cd-cohort-plan: {exc}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
