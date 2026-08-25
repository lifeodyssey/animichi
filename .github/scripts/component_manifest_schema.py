"""Typed schema boundary for the CI component manifest."""

from collections.abc import Mapping
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


def validate_manifest_header(document: Mapping[str, object]) -> None:
    if document.get("unknown_changes") != "all":
        raise ValueError("unknown changes must fail closed to all components")
    paths = document.get("repository_paths")
    if not isinstance(paths, list) or not paths:
        raise ValueError("manifest needs repository-owned paths")
    if not all(isinstance(path, str) for path in paths):
        raise ValueError("repository-owned paths must be strings")


def validated_lanes(value: object) -> list[GlobalLane]:
    if not isinstance(value, list) or not value:
        raise ValueError("manifest needs at least one global lane")
    for lane in value:
        validate_lane(lane)
    return cast(list[GlobalLane], value)


def validate_lane(lane: object) -> None:
    if not isinstance(lane, dict):
        raise TypeError("global lane metadata is invalid")
    selectors = (lane.get("always"), lane.get("paths"), lane.get("components"))
    if not lane.get("name") or not any(selectors):
        raise ValueError("global lane metadata is invalid")


def validated_components(value: object) -> list[Component]:
    if not isinstance(value, list) or not value:
        raise ValueError("manifest components must be a non-empty array")
    if not all(isinstance(component, dict) for component in value):
        raise ValueError("component metadata must be an object")
    return cast(list[Component], value)


def validate_shape(document: object) -> Manifest:
    mapped = manifest_mapping(document)
    validate_manifest_header(mapped)
    validated_lanes(mapped.get("global_lanes"))
    validated_components(mapped.get("components"))
    return cast(Manifest, mapped)
