"""Pinned Atlas operations shared by pytest and the test-base provisioner."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from urllib.parse import urlparse

PINNED_ATLAS_VERSION = "0.30.0"
ATLAS_TIMEOUT_SECONDS = 600
ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS_DIR = ROOT / "db" / "migrations"


def parse_atlas_version(output: str) -> str:
    match = re.search(r"\bv?(\d+\.\d+\.\d+)\b", output)
    if match is None:
        raise RuntimeError("unable to parse the installed Atlas version")
    return match.group(1)


def verify_atlas_pin(environment: Mapping[str, str] = os.environ) -> None:
    configured = environment.get("ATLAS_VERSION", PINNED_ATLAS_VERSION)
    if configured != PINNED_ATLAS_VERSION:
        raise RuntimeError(f"ATLAS_VERSION must equal {PINNED_ATLAS_VERSION}")
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
