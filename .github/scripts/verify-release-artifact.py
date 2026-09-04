#!/usr/bin/env python3
"""Fail-closed verifier for a main-SHA release artifact envelope."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import TypedDict, cast


class ArtifactManifest(TypedDict):
    schema_version: int
    unit: str
    source_sha: str
    artifact_sha256: str


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def read_manifest(path: Path) -> ArtifactManifest:
    with path.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise TypeError("manifest must be an object")
    return cast(ArtifactManifest, raw)


def verify(root: Path, unit: str, source_sha: str) -> None:
    manifest = read_manifest(root / "artifact-manifest.json")
    if (
        set(manifest) != {"schema_version", "unit", "source_sha", "artifact_sha256"}
        or manifest.get("schema_version") != 1
    ):
        raise ValueError("manifest schema mismatch")
    if manifest.get("unit") != unit:
        raise ValueError(f"unit mismatch: {manifest.get('unit')!r} != {unit!r}")
    if manifest.get("source_sha") != source_sha:
        raise ValueError("source SHA mismatch")
    if manifest.get("artifact_sha256") != digest(root / "artifact.tar.gz"):
        raise ValueError("artifact digest mismatch")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: verify-release-artifact.py DIR UNIT SOURCE_SHA", file=sys.stderr)
        return 2
    try:
        verify(Path(argv[0]), argv[1], argv[2])
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"verify-release-artifact: {exc}", file=sys.stderr)
        return 1
    print(f"verified immutable artifact {argv[1]}@{argv[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
