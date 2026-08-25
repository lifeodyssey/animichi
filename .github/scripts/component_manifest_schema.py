"""Typed schema boundary for the CI component manifest."""

import json
from collections.abc import Mapping
from pathlib import Path
from typing import NotRequired, TypedDict, cast


class Component(TypedDict):
    name: str
    paths: list[str]
    test_triggers: NotRequired[list[str]]
    deploy_excludes: list[str]
    depends_on: list[str]
    ci_lanes: list[str]
    deploy_unit: str | None


class GlobalLane(TypedDict):
    name: str
    paths: NotRequired[list[str]]
    components: NotRequired[list[str]]
    always: NotRequired[bool]


class DeployTrigger(TypedDict):
    paths: list[str]
    components: list[str]


class Manifest(TypedDict):
    schema_version: int
    unknown_changes: str
    repository_paths: list[str]
    global_lanes: list[GlobalLane]
    components: list[Component]
    deploy_triggers: list[DeployTrigger]


def manifest_mapping(document: object) -> Mapping[str, object]:
    if not isinstance(document, dict) or document.get("schema_version") != 2:
        raise ValueError("manifest schema_version must be 2")
    return cast(Mapping[str, object], document)


def string_list(value: object, label: str, nonempty: bool = False) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{label} must be a string array")
    if nonempty and not value:
        raise ValueError(f"{label} must be a non-empty string array")
    return list(value)


def validate_manifest_header(document: Mapping[str, object]) -> None:
    if document.get("unknown_changes") != "all":
        raise ValueError("unknown changes must fail closed to all components")
    string_list(document.get("repository_paths"), "repository-owned paths", True)


def validate_lane_selectors(lane: Mapping[str, object]) -> None:
    paths = string_list(lane.get("paths", []), "global lane paths")
    components = string_list(lane.get("components", []), "global lane components")
    always = lane.get("always", False)
    if not isinstance(always, bool):
        raise ValueError("global lane always must be boolean")
    if not always and not paths and not components:
        raise ValueError("global lane metadata is invalid")


def validated_lanes(value: object) -> list[GlobalLane]:
    if not isinstance(value, list) or not value:
        raise ValueError("manifest needs at least one global lane")
    for lane in value:
        validate_lane(lane)
    return cast(list[GlobalLane], value)


def validate_lane(lane: object) -> None:
    if not isinstance(lane, dict):
        raise ValueError("global lane metadata is invalid")
    if not isinstance(lane.get("name"), str) or not lane["name"]:
        raise ValueError("global lane metadata is invalid")
    validate_lane_selectors(cast(Mapping[str, object], lane))


def validate_component(component: object) -> None:
    if not isinstance(component, dict):
        raise ValueError("component metadata must be an object")
    name = component.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("every component needs a non-empty name")
    validate_component_lists(cast(Mapping[str, object], component), name)
    unit = component.get("deploy_unit")
    if unit is not None and not isinstance(unit, str):
        raise ValueError(f"component {name} has invalid deploy_unit")


def validate_component_lists(component: Mapping[str, object], name: str) -> None:
    string_list(component.get("paths"), f"component {name} has no paths", True)
    string_list(component.get("test_triggers", []), f"component {name} has invalid test triggers")
    string_list(component.get("deploy_excludes"), f"component {name} has invalid deploy excludes")
    string_list(component.get("depends_on"), f"component {name} has invalid depends_on")
    string_list(component.get("ci_lanes"), f"component {name} has invalid ci_lanes", True)


def validated_components(value: object) -> list[Component]:
    if not isinstance(value, list) or not value:
        raise ValueError("manifest components must be a non-empty array")
    for component in value:
        validate_component(component)
    return cast(list[Component], value)


def deployable_names(components: list[Component]) -> set[str]:
    names = [component["name"] for component in components]
    if len(names) != len(set(names)):
        raise ValueError("component names must be unique")
    return {component["name"] for component in components if component["deploy_unit"] is not None}


def validate_deploy_trigger(trigger: object, deployable: set[str]) -> None:
    if not isinstance(trigger, dict):
        raise ValueError("deploy trigger must be an object")
    paths = string_list(trigger.get("paths"), "deploy trigger paths", True)
    components = string_list(trigger.get("components"), "deploy trigger components", True)
    if unknown := set(components) - deployable:
        names = ", ".join(sorted(unknown))
        raise ValueError(f"deploy trigger references unknown or non-deployable components: {names}")


def validated_deploy_triggers(value: object, deployable: set[str]) -> list[DeployTrigger]:
    if not isinstance(value, list) or not value:
        raise ValueError("manifest needs deploy triggers")
    for trigger in value:
        validate_deploy_trigger(trigger, deployable)
    return cast(list[DeployTrigger], value)


def validate_shape(document: object) -> Manifest:
    mapped = manifest_mapping(document)
    validate_manifest_header(mapped)
    validated_lanes(mapped.get("global_lanes"))
    components = validated_components(mapped.get("components"))
    validated_deploy_triggers(mapped.get("deploy_triggers"), deployable_names(components))
    return cast(Manifest, mapped)


def load_manifest(path: Path) -> Manifest:
    return validate_shape(json.loads(path.read_text()))
