"""Self-heal contract tests for the pinned Atlas cache (#730, #737 review).

Split out to keep every file under the repo's 200-line test-file ceiling:
- apply_migrations()'s PATH contract → test_atlas_apply_migrations_path.py
- download-step edge cases (redirects, mkdir failure) → test_atlas_download_hardening.py
"""

from __future__ import annotations

import hashlib
import platform
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest

from animichi.tests import atlas_helper
from animichi.tests.atlas_helper import ensure_pinned_atlas


@dataclass
class _FakeHttpResponse:
    content: bytes

    def raise_for_status(self) -> None:
        return None


def _fixture_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(atlas_helper, "ATLAS_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(atlas_helper, "_global_atlas_matching_pin", lambda: None)


def _pin_current_platform(
    monkeypatch: pytest.MonkeyPatch, digest: str
) -> tuple[str, str]:
    system, machine = platform.system(), platform.machine()
    monkeypatch.setitem(
        atlas_helper.ATLAS_ARTIFACTS, (system, machine), ("atlas-test-artifact", digest)
    )
    return system, machine


def _stub_get(payload: bytes) -> Callable[..., _FakeHttpResponse]:
    def _get(url: str, **kwargs: object) -> _FakeHttpResponse:
        return _FakeHttpResponse(payload)

    return _get


def _forbidden_get(url: str, **kwargs: object) -> httpx.Response:
    raise AssertionError("must not attempt a network call")


def _forbidden_download(system: str, machine: str) -> Path:
    raise AssertionError("must not download here")


def test_ensure_pinned_atlas_reuses_matching_global_without_downloading(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        atlas_helper, "_global_atlas_matching_pin", lambda: Path("/usr/local/bin/atlas")
    )
    monkeypatch.setattr(atlas_helper, "_download_pinned_atlas", _forbidden_download)
    assert ensure_pinned_atlas() is None


def test_ensure_pinned_atlas_rejects_atlas_version_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ATLAS_VERSION", "1.2.4")
    with pytest.raises(RuntimeError, match="did NOT run.*ATLAS_VERSION"):
        ensure_pinned_atlas()


def test_ensure_pinned_atlas_downloads_and_verifies_into_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"pretend Atlas binary"
    digest = hashlib.sha256(payload).hexdigest()
    _fixture_cache(monkeypatch, tmp_path)
    system, machine = _pin_current_platform(monkeypatch, digest)
    monkeypatch.setattr(httpx, "get", _stub_get(payload))

    bin_dir = ensure_pinned_atlas()

    assert bin_dir == atlas_helper._cached_atlas_binary(system, machine).parent
    cached_binary = bin_dir / "atlas" if bin_dir else None
    assert cached_binary is not None and cached_binary.read_bytes() == payload
    assert cached_binary.stat().st_mode & 0o111  # executable bits set


def test_ensure_pinned_atlas_reuses_valid_cache_without_redownloading(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"already cached binary"
    digest = hashlib.sha256(payload).hexdigest()
    _fixture_cache(monkeypatch, tmp_path)
    system, machine = _pin_current_platform(monkeypatch, digest)
    cached_binary = atlas_helper._cached_atlas_binary(system, machine)
    cached_binary.parent.mkdir(parents=True)
    cached_binary.write_bytes(payload)
    monkeypatch.setattr(atlas_helper, "_download_pinned_atlas", _forbidden_download)

    assert ensure_pinned_atlas() == cached_binary.parent


def test_ensure_pinned_atlas_redownloads_a_corrupted_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    good_payload = b"fresh good binary"
    digest = hashlib.sha256(good_payload).hexdigest()
    _fixture_cache(monkeypatch, tmp_path)
    system, machine = _pin_current_platform(monkeypatch, digest)
    cached_binary = atlas_helper._cached_atlas_binary(system, machine)
    cached_binary.parent.mkdir(parents=True)
    cached_binary.write_bytes(b"corrupted stale bytes")
    monkeypatch.setattr(httpx, "get", _stub_get(good_payload))

    bin_dir = ensure_pinned_atlas()

    assert bin_dir is not None
    assert (bin_dir / "atlas").read_bytes() == good_payload


def test_ensure_pinned_atlas_rejects_a_tampered_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mutation guard: a byte-flipped download must fail closed, not run migrations."""
    real_payload = b"trustworthy Atlas binary"
    digest = hashlib.sha256(real_payload).hexdigest()
    _fixture_cache(monkeypatch, tmp_path)
    system, machine = _pin_current_platform(monkeypatch, digest)
    monkeypatch.setattr(httpx, "get", _stub_get(real_payload + b"X"))

    with pytest.raises(RuntimeError, match="did NOT run.*checksum mismatch"):
        ensure_pinned_atlas()
    assert not atlas_helper._cached_atlas_binary(system, machine).exists()


def test_ensure_pinned_atlas_network_failure_says_arm_did_not_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fixture_cache(monkeypatch, tmp_path)
    _pin_current_platform(monkeypatch, "0" * 64)

    def _raise_network_error(url: str, **kwargs: object) -> httpx.Response:
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(httpx, "get", _raise_network_error)
    with pytest.raises(RuntimeError, match="did NOT run.*could not prepare"):
        ensure_pinned_atlas()


def test_ensure_pinned_atlas_unmapped_platform_fails_before_any_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fixture_cache(monkeypatch, tmp_path)
    monkeypatch.setattr(atlas_helper, "ATLAS_ARTIFACTS", {})
    monkeypatch.setattr(httpx, "get", _forbidden_get)

    with pytest.raises(RuntimeError, match="did NOT run.*no pinned Atlas artifact"):
        ensure_pinned_atlas()
