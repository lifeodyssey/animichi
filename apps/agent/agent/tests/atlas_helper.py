"""Pinned Atlas operations shared by pytest and the test-base provisioner."""

from __future__ import annotations

import contextlib
import hashlib
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import time
from collections.abc import Sequence
from pathlib import Path
from urllib.parse import urlparse

import httpx

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

# Self-check + self-heal (#730): a homebrew-global Atlas that doesn't match
# PINNED_ATLAS_VERSION must never silently weaken this test arm. The cache
# lives outside .venv/site-packages so a `uv sync` cannot prune it, and it is
# never written to a location that shadows or replaces the user's global
# `atlas` install.
ATLAS_CACHE_DIR = ROOT / ".cache" / "atlas"
ATLAS_RELEASE_BASE_URL = "https://release.ariga.io/atlas"
ATLAS_DOWNLOAD_TIMEOUT_SECONDS = 60


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


def _cached_atlas_dir(system: str, machine: str) -> Path:
    return ATLAS_CACHE_DIR / f"{PINNED_ATLAS_VERSION}-{system}-{machine}"


def _cached_atlas_binary(system: str, machine: str) -> Path:
    # Always named literally "atlas": callers prepend this file's directory to
    # PATH and invoke the literal command name, so subprocess argv never
    # carries a computed executable path (keeps ruff S603 happy for real,
    # not via suppression — see apply_migrations).
    return _cached_atlas_dir(system, machine) / "atlas"


def _global_atlas_matching_pin() -> Path | None:
    """The global `atlas` on PATH, if it already satisfies the pin, else None."""
    executable = shutil.which("atlas")
    if executable is None:
        return None
    try:
        result = subprocess.run(
            ["atlas", "version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    try:
        installed = parse_atlas_version(result.stdout + result.stderr)
    except RuntimeError:
        return None
    return Path(executable) if installed == PINNED_ATLAS_VERSION else None


def _fetch_atlas_artifact(url: str) -> bytes:
    response = httpx.get(
        url, timeout=ATLAS_DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=True
    )
    response.raise_for_status()
    return response.content


def _write_verified_binary(
    temp_destination: Path, destination: Path, payload: bytes, system: str, machine: str
) -> None:
    temp_destination.write_bytes(payload)
    verify_atlas_checksum(temp_destination, system, machine)
    executable_bits = stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
    temp_destination.chmod(temp_destination.stat().st_mode | executable_bits)
    temp_destination.replace(destination)


def _download_pinned_atlas(system: str, machine: str) -> Path:
    """Fetch, checksum-verify, and cache the pinned Atlas binary.

    The sha256 compared here is the digest already committed in this file
    (recorded once from the official release and human-reviewed) — never a
    checksums file fetched over the same channel as the binary, which would
    only prove transport integrity, not artifact identity (#723). Every step
    from "decided to download" to "binary is executable" — the HTTP fetch,
    `mkdir`, the write, the checksum, `chmod`, and the atomic `replace` — is
    inside one failure boundary: any of them raising must read as "the
    integration arm did NOT run", never as an unrelated filesystem error.
    """
    artifact = ATLAS_ARTIFACTS.get((system, machine))
    if artifact is None:
        raise RuntimeError(
            "integration test arm did NOT run: no pinned Atlas artifact is "
            f"recorded for {system}/{machine}; install Atlas {PINNED_ATLAS_VERSION} "
            "yourself and put it on PATH, or extend ATLAS_ARTIFACTS"
        )
    artifact_name, _ = artifact
    destination = _cached_atlas_binary(system, machine)
    temp_destination = destination.with_suffix(".download")
    url = f"{ATLAS_RELEASE_BASE_URL}/{artifact_name}"
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        payload = _fetch_atlas_artifact(url)
        _write_verified_binary(temp_destination, destination, payload, system, machine)
    except (httpx.HTTPError, OSError, RuntimeError) as error:
        with contextlib.suppress(OSError):
            temp_destination.unlink(missing_ok=True)
        raise RuntimeError(
            "integration test arm did NOT run: could not prepare the pinned "
            f"Atlas {PINNED_ATLAS_VERSION} binary ({error}); check network access, "
            f"disk space, and write permissions under {ATLAS_CACHE_DIR}, or install "
            f"Atlas {PINNED_ATLAS_VERSION} manually and put it on PATH"
        ) from error
    return destination


def ensure_pinned_atlas() -> Path | None:
    """Resolve the pinned Atlas 0.30.0 and report a PATH prefix, if any.

    This never touches the user's global Atlas install. Resolution order:
    (1) a global `atlas` on PATH that already matches the pin is used as-is —
    returns None, no PATH change needed; (2) otherwise a cached,
    sha256-verified binary under ATLAS_CACHE_DIR is reused or freshly
    downloaded, keyed by (system, machine) so darwin-arm64 and linux-amd64
    caches never collide, and its directory is returned for the caller to
    prepend to PATH for the test command only. Any failure path raises with
    "integration test arm did NOT run" so a mismatch never reads as an
    unrelated environment blip.
    """
    configured = os.environ.get("ATLAS_VERSION", PINNED_ATLAS_VERSION)
    if configured != PINNED_ATLAS_VERSION:
        raise RuntimeError(
            "integration test arm did NOT run: ATLAS_VERSION must equal "
            f"{PINNED_ATLAS_VERSION}"
        )
    if _global_atlas_matching_pin() is not None:
        return None
    system, machine = platform.system(), platform.machine()
    cached = _cached_atlas_binary(system, machine)
    if cached.exists():
        try:
            verify_atlas_checksum(cached, system, machine)
        except RuntimeError:
            with contextlib.suppress(OSError):
                cached.unlink(missing_ok=True)
        except OSError as error:
            raise RuntimeError(
                "integration test arm did NOT run: could not read the cached "
                f"Atlas binary at {cached} to verify it ({error})"
            ) from error
        else:
            return cached.parent
    return _download_pinned_atlas(system, machine).parent


def atlas_apply_command(dsn: str) -> tuple[str, ...]:
    return (
        "atlas",
        "migrate",
        "apply",
        "--dir",
        "file://db/migrations",
        "--url",
        dsn,
        "--revisions-schema",
        "public",
    )


def _sanitize_atlas_output(text: str) -> str:
    """Last lines of atlas output with any credential-bearing URL redacted."""
    redacted = re.sub(r"postgres(?:ql)?://\S+", "<DSN>", text or "")
    return " | ".join(redacted.strip().splitlines()[-3:])[:400]


def apply_migrations(dsn: str) -> float:
    atlas_path_prefix = ensure_pinned_atlas()
    environment = {**os.environ, "DATABASE_URL": dsn}
    if atlas_path_prefix is not None:
        # Prepend only for this subprocess call — never mutate the caller's
        # own PATH or the global `atlas` install (#730).
        existing_path = environment.get("PATH", "")
        environment["PATH"] = f"{atlas_path_prefix}{os.pathsep}{existing_path}"
    started = time.monotonic()
    try:
        result = subprocess.run(
            list(atlas_apply_command(dsn)),
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
