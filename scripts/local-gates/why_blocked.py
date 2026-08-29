"""Render a fail-closed pull-request blocking diagnosis from GitHub snapshots."""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import cast
from urllib.parse import quote

from why_blocked_models import Diagnosis, Observation, PullRequest, RequiredCheck


def _decode(text: str, label: str) -> object:
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} is not valid JSON: {error.msg}") from error


def _load(path: Path) -> object:
    return _decode(path.read_text(encoding="utf-8"), path.name)


def _mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise TypeError(f"{label} must be an object with string keys")
    return cast(Mapping[str, object], value)


def _sequence(value: object, label: str) -> Sequence[object]:
    if not isinstance(value, list):
        raise TypeError(f"{label} must be an array")
    return cast(Sequence[object], value)


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise TypeError(f"{label} must be a non-empty string")
    return value


def _integer(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise TypeError(f"{label} must be a non-negative integer")
    return value


def _boolean(value: object, label: str) -> bool:
    if not isinstance(value, bool):
        raise TypeError(f"{label} must be a boolean")
    return value


def _sha(value: object, label: str) -> str:
    sha = _text(value, label)
    if len(sha) != 40 or any(char not in "0123456789abcdef" for char in sha):
        raise ValueError(f"{label} must be a lowercase 40-character SHA")
    return sha


def _pull_request(path: Path) -> PullRequest:
    raw = _mapping(_load(path), "pull request")
    return PullRequest(
        _integer(raw.get("number"), "pull request number"),
        _text(raw.get("baseRefName"), "base ref"),
        _sha(raw.get("baseRefOid"), "base SHA"),
        _sha(raw.get("headRefOid"), "head SHA"),
        _text(raw.get("mergeStateStatus"), "merge state"),
    )


def _rule_names(rule: Mapping[str, object], key: str, field: str) -> tuple[str, ...]:
    parameters = _mapping(rule.get("parameters"), f"{rule.get('type')} parameters")
    entries = _sequence(parameters.get(key), key)
    return tuple(
        _text(_mapping(entry, key).get(field), f"{key}.{field}") for entry in entries
    )


def _required_status_checks(rule: Mapping[str, object]) -> tuple[RequiredCheck, ...]:
    parameters = _mapping(rule.get("parameters"), "required status parameters")
    entries = _sequence(
        parameters.get("required_status_checks"), "required status checks"
    )
    return tuple(_required_status_check(entry) for entry in entries)


def _required_status_check(value: object) -> RequiredCheck:
    raw = _mapping(value, "required status check")
    integration_id = _optional_integer(raw.get("integration_id"), "integration id")
    return RequiredCheck(_text(raw.get("context"), "required context"), integration_id)


def _sorted_required(required: list[RequiredCheck]) -> tuple[RequiredCheck, ...]:
    return tuple(
        sorted(set(required), key=lambda item: (item.name, item.integration_id or -1))
    )


def _extend_required(required: list[RequiredCheck], rule: Mapping[str, object]) -> None:
    if rule.get("type") == "required_status_checks":
        required.extend(_required_status_checks(rule))
        return
    if rule.get("type") != "code_scanning":
        return
    names = _rule_names(rule, "code_scanning_tools", "tool")
    required.extend(RequiredCheck(name, None) for name in names)


def _required_checks(path: Path) -> tuple[RequiredCheck, ...]:
    required: list[RequiredCheck] = []
    for raw_rule in _sequence(_load(path), "branch rules"):
        _extend_required(required, _mapping(raw_rule, "branch rule"))
    return _sorted_required(required)


def _optional_integer(value: object, label: str) -> int | None:
    return None if value is None else _integer(value, label)


def _optional_text(value: object, label: str) -> str:
    if value is None:
        return "null"
    return _text(value, label)


def _observed_at(raw: Mapping[str, object]) -> str:
    for key in ("completed_at", "started_at", "created_at", "updated_at"):
        if raw.get(key) is not None:
            return _text(raw.get(key), key)
    return ""


def _check_observation(value: object) -> Observation:
    raw = _mapping(value, "check run")
    name = _text(raw.get("name"), "check run name")
    status = _text(raw.get("status"), "check run status")
    result = _optional_text(raw.get("conclusion"), "check run conclusion")
    order = _integer(raw.get("id"), "check run id")
    at = _observed_at(raw)
    app_id = _check_app_id(raw)
    return Observation(name, status, result, "check-run", at, order, app_id)


def _check_app_id(raw: Mapping[str, object]) -> int | None:
    app = raw.get("app")
    if app is None:
        return None
    return _integer(_mapping(app, "check run app").get("id"), "check run app id")


def _json_lines(path: Path) -> tuple[object, ...]:
    lines = tuple(
        line for line in path.read_text(encoding="utf-8").splitlines() if line
    )
    if not lines:
        raise ValueError(f"{path.name} is empty")
    return tuple(_decode(line, path.name) for line in lines)


def _check_observations(path: Path) -> tuple[Observation, ...]:
    checks: list[Observation] = []
    for page in _json_lines(path):
        checks.extend(
            _check_observation(item) for item in _sequence(page, "check page")
        )
    return tuple(checks)


def _status_observation(value: object) -> Observation:
    raw = _mapping(value, "status context")
    name = _text(raw.get("context"), "status context")
    result = _text(raw.get("state"), "status state").lower()
    required = _boolean(raw.get("isRequired"), "status required flag")
    at = _text(raw.get("updatedAt"), "status updatedAt")
    _text(raw.get("id"), "status id")
    return Observation(name, "completed", result, "status", at, 0, None, required)


def _status_observations(path: Path) -> tuple[Observation, ...]:
    statuses = _sequence(_load(path), "status contexts")
    return tuple(_status_observation(status) for status in statuses)


def _latest(
    required: RequiredCheck, observations: tuple[Observation, ...]
) -> Observation:
    matches = tuple(item for item in observations if required.matches(item))
    if not matches:
        return Observation.missing(required)
    return max(matches, key=lambda item: (item.observed_at, item.identifier))


def _behind_by(path: Path) -> int:
    raw = _mapping(_load(path), "compare response")
    return _integer(raw.get("behind_by"), "compare behind_by")


def _threads(path: Path) -> int:
    text = path.read_text(encoding="utf-8").strip()
    if not text.isdigit():
        raise ValueError("thread tally must be a non-negative integer")
    return int(text)


def _blocking_observations(
    required: tuple[RequiredCheck, ...], observations: tuple[Observation, ...]
) -> tuple[Observation, ...]:
    latest = tuple(_latest(check, observations) for check in required)
    return tuple(
        item
        for item in latest
        if item.status != "completed" or item.conclusion != "success"
    )


def _diagnose(directory: Path) -> Diagnosis:
    pull_request = _pull_request(directory / "pr.json")
    required = _required_checks(directory / "rules.json")
    observations = _check_observations(directory / "checks.jsonl")
    observations += _status_observations(directory / "statuses.json")
    blockers = _blocking_observations(required, observations)
    behind_by = _behind_by(directory / "compare.json")
    unresolved_threads = _threads(directory / "threads.txt")
    return Diagnosis(pull_request, blockers, behind_by, unresolved_threads)


def _label(value: int | bool | None) -> str:
    return "unknown" if value is None else str(value).lower()


def _blocker_line(item: Observation) -> str:
    app_id = "none" if item.integration_id is None else str(item.integration_id)
    required = _label(item.required_by_pr)
    return (
        f"- {item.name}: raw_conclusion={item.conclusion} status={item.status} "
        f"source={item.source} app_id={app_id} required_by_pr={required}"
    )


def _render_blockers(blockers: tuple[Observation, ...]) -> None:
    print(f"required checks without success ({len(blockers)}):")
    if not blockers:
        print("- none")
    for item in blockers:
        print(_blocker_line(item))


def _render(diagnosis: Diagnosis) -> None:
    pull_request = diagnosis.pull_request
    print(f"PR #{pull_request.number}: merge_state={pull_request.merge_state}")
    _render_blockers(diagnosis.blockers)
    state = "behind" if diagnosis.behind_by else "current"
    print(f"branch staleness: {state} (behind_by={diagnosis.behind_by})")
    print(f"unresolved threads: {diagnosis.unresolved_threads}")


def _target(path: Path) -> int:
    pull_request = _pull_request(path)
    encoded_base = quote(pull_request.base_ref, safe="")
    print(f"{encoded_base}\t{pull_request.base_sha}\t{pull_request.head_sha}")
    return 0


def _report(path: Path) -> int:
    diagnosis = _diagnose(path)
    _render(diagnosis)
    return 1 if diagnosis.blocked else 0


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 2 and argv[0] == "target":
            return _target(Path(argv[1]))
        if len(argv) == 2 and argv[0] == "report":
            return _report(Path(argv[1]))
        raise ValueError("usage: why_blocked.py <target|report> <path>")
    except (OSError, TypeError, ValueError) as error:
        print(f"BLOCKED: unreadable why-blocked input: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
