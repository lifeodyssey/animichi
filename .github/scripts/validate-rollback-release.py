"""Validate a caller-selected sealed artifact from a successful production CD run."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Mapping
from pathlib import Path

SHA = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
UNITS = frozenset(("edge", "web", "catalog", "users", "agent"))
CD_PATH = ".github/workflows/cd.yml"


def fail(message: str) -> None:
    raise ValueError(message)


def load_mapping(path: Path, label: str) -> Mapping[object, object]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def require_identity(args: argparse.Namespace) -> None:
    if not SHA.fullmatch(args.source_sha):
        fail("source SHA must be 40 lowercase hex characters")
    if not DIGEST.fullmatch(args.artifact_sha256):
        fail("artifact SHA-256 must be 64 lowercase hex characters")
    if args.unit not in UNITS or not args.run_id.isdecimal():
        fail("rollback release identity is malformed")


def repository_name(run: Mapping[object, object]) -> object:
    repository = run.get("repository")
    return repository.get("full_name") if isinstance(repository, dict) else None


def validate_run(run: Mapping[object, object], args: argparse.Namespace) -> None:
    expected = {
        "id": int(args.run_id),
        "event": "push",
        "status": "completed",
        "conclusion": "success",
        "head_branch": "main",
        "head_sha": args.source_sha,
    }
    if any(run.get(key) != value for key, value in expected.items()):
        fail(
            "release run is not a successful main-push CD run for the selected identity"
        )
    if str(run.get("path", "")).split("@", 1)[0] != CD_PATH:
        fail("release run was not produced by the trusted CD workflow")
    if repository_name(run) != args.repository:
        fail("release run belongs to a different repository")


def artifact_entries(raw: Mapping[object, object]) -> list[Mapping[object, object]]:
    values = raw.get("artifacts")
    if not isinstance(values, list) or not all(
        isinstance(item, dict) for item in values
    ):
        fail("artifact response must contain an artifacts array")
    return values


def validate_artifact(raw: Mapping[object, object], args: argparse.Namespace) -> None:
    name = f"release-{args.source_sha}-{args.unit}"
    matches = [item for item in artifact_entries(raw) if item.get("name") == name]
    if len(matches) != 1 or matches[0].get("expired") is not False:
        fail("selected sealed artifact is missing, ambiguous, or expired")
    size = matches[0].get("size_in_bytes")
    if not isinstance(size, int) or size <= 0:
        fail("selected sealed artifact is empty")


def validate_manifest(
    manifest: Mapping[object, object], args: argparse.Namespace
) -> None:
    expected = {
        "schema_version": 1,
        "unit": args.unit,
        "source_sha": args.source_sha,
        "artifact_sha256": args.artifact_sha256,
    }
    if set(manifest) != set(expected) or any(
        manifest.get(key) != value for key, value in expected.items()
    ):
        fail("artifact manifest does not match the selected rollback identity")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    for name in ("run", "artifacts", "manifest"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    for name in ("repository", "run-id", "unit", "source-sha", "artifact-sha256"):
        parser.add_argument(f"--{name}", required=True)
    return parser.parse_args()


def validate(args: argparse.Namespace) -> None:
    require_identity(args)
    validate_run(load_mapping(args.run, "run"), args)
    validate_artifact(load_mapping(args.artifacts, "artifacts"), args)
    validate_manifest(load_mapping(args.manifest, "manifest"), args)


def main() -> int:
    args = parse_args()
    try:
        validate(args)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"validate-rollback-release: {exc}", file=sys.stderr)
        return 1
    print(
        f"trusted rollback release {args.unit}@{args.source_sha} run={args.run_id} digest={args.artifact_sha256}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
