"""Pinned Atlas operations shared by pytest and the test-base provisioner."""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from urllib.parse import urlparse

PINNED_ATLAS_VERSION = "0.30.0"
# Upgrade policy (review by 2027-01): Atlas supports only the newest two minors,
# and release binaries may disappear after roughly six months. Keep the pin,
# artifact URLs, and both checksums in one atomic upgrade.
ATLAS_MACOS_ARM64_SHA256 = (
    "79a19d8ad284054fe3e2b64aff300f794a9f8a1b8a90d60b296bdb754746f984"
)
# Both digests were computed from the official release.ariga.io artifacts
# (lead-verified 2026-07-18; darwin digest independently matched the official
# download, not just the local binary).
ATLAS_LINUX_AMD64_SHA256: str | None = (
    "dbaaf350634304d4bf92753559261a67afb399fe4ff0ea6ae5bb5d1ce6e0011a"
)
ATLAS_ARTIFACTS: dict[tuple[str, str], tuple[str, str | None]] = {
    ("Darwin", "arm64"): (
        "atlas-community-darwin-arm64-v0.30.0",
        ATLAS_MACOS_ARM64_SHA256,
    ),
    ("Linux", "x86_64"): (
        "atlas-community-linux-amd64-v0.30.0",
        ATLAS_LINUX_AMD64_SHA256,
    ),
}
ATLAS_TIMEOUT_SECONDS = 600
ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS_DIR = ROOT / "db" / "migrations"


def parse_atlas_version(output: str) -> str:
    match = re.search(r"\bv?(\d+\.\d+\.\d+)\b", output)
    if match is None:
        raise RuntimeError("unable to parse the installed Atlas version")
    return match.group(1)


def verify_atlas_checksum(
    binary: Path, system: str = platform.system(), machine: str = platform.machine()
) -> None:
    artifact = ATLAS_ARTIFACTS.get((system, machine))
    if artifact is None:
        raise RuntimeError(
            f"Atlas {PINNED_ATLAS_VERSION} has no checksum for {system}/{machine}"
        )
    artifact_name, expected = artifact
    if expected is None:
        raise RuntimeError(
            f"Atlas checksum for {artifact_name} is unverified; record the official "
            "sha256 before running migrations"
        )
    with binary.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise RuntimeError(
            f"Atlas checksum mismatch for {artifact_name}; the pin may be stale, "
            "the release may have been removed (404), or the download is corrupt"
        )


def verify_atlas_pin(environment: Mapping[str, str] = os.environ) -> None:
    configured = environment.get("ATLAS_VERSION", PINNED_ATLAS_VERSION)
    if configured != PINNED_ATLAS_VERSION:
        raise RuntimeError(f"ATLAS_VERSION must equal {PINNED_ATLAS_VERSION}")
    executable = shutil.which("atlas")
    if executable is None:
        raise RuntimeError(
            "Atlas 0.30.0 was not found; its pinned release may have been removed "
            "(404), so review the pin and checksums"
        )
    try:
        result = subprocess.run(
            ["atlas", "version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("unable to execute atlas version") from error
    if result.returncode != 0:
        raise RuntimeError("unable to execute atlas version")
    installed = parse_atlas_version(result.stdout + result.stderr)
    if installed != PINNED_ATLAS_VERSION:
        raise RuntimeError(
            f"installed Atlas is {installed}; expected {PINNED_ATLAS_VERSION}"
        )
    verify_atlas_checksum(Path(executable))


def atlas_apply_command() -> tuple[str, ...]:
    return (
        "atlas",
        "migrate",
        "apply",
        "--env",
        "neon",
        "--revisions-schema",
        "public",
    )


def _sanitize_atlas_output(text: str) -> str:
    """Last lines of atlas output with any credential-bearing URL redacted."""
    redacted = re.sub(r"postgres(?:ql)?://\S+", "<DSN>", text or "")
    return " | ".join(redacted.strip().splitlines()[-3:])[:400]


def apply_migrations(dsn: str) -> float:
    verify_atlas_pin()
    environment = {**os.environ, "DATABASE_URL": dsn}
    started = time.monotonic()
    try:
        result = subprocess.run(
            [
                "atlas",
                "migrate",
                "apply",
                "--env",
                "neon",
                "--revisions-schema",
                "public",
            ],
            capture_output=True,
            text=True,
            timeout=ATLAS_TIMEOUT_SECONDS,
            check=False,
            cwd=ROOT,
            env=environment,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            "Atlas migration apply exceeded the 10 minute timeout"
        ) from error
    except OSError as error:
        raise RuntimeError("unable to execute Atlas migration apply") from error
    host = urlparse(dsn).hostname or "unknown"
    if result.returncode != 0:
        detail = _sanitize_atlas_output(result.stderr or result.stdout)
        raise RuntimeError(
            f"Atlas migration apply failed for database host {host}: {detail}"
        )
    return time.monotonic() - started


def expected_revisions(files: Sequence[Path] | None = None) -> tuple[str, ...]:
    migrations = files if files is not None else sorted(MIGRATIONS_DIR.glob("*.sql"))
    return tuple(path.stem.split("_", maxsplit=1)[0] for path in migrations)


def main() -> int:
    if sys.argv[1:] != ["apply"]:
        raise RuntimeError("usage: python -m agent.tests.atlas_helper apply")
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is required")
    apply_migrations(dsn)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
