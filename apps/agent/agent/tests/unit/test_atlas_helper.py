"""Static contract tests for the shared Atlas invocation."""

import hashlib
from pathlib import Path

import httpx
import pytest

from agent.tests import atlas_helper
from agent.tests.atlas_helper import (
    ATLAS_MACOS_ARM64_SHA256,
    ATLAS_TIMEOUT_SECONDS,
    atlas_apply_command,
    ensure_pinned_atlas,
    parse_atlas_version,
    verify_atlas_checksum,
)


def test_atlas_command_pins_public_revisions_and_ten_minute_budget() -> None:
    command = atlas_apply_command()
    assert command[-2:] == ("--revisions-schema", "public")
    assert command[3:5] == ("--env", "neon")
    assert ATLAS_TIMEOUT_SECONDS >= 600
    assert parse_atlas_version("atlas version v0.30.0") == "0.30.0"
    assert len(ATLAS_MACOS_ARM64_SHA256) == 64


def test_atlas_binary_checksum_accepts_recorded_digest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    binary = tmp_path / "atlas"
    binary.write_bytes(b"recorded Atlas artifact")
    expected = hashlib.sha256(binary.read_bytes()).hexdigest()
    monkeypatch.setitem(
        atlas_helper.ATLAS_ARTIFACTS,
        ("FixtureOS", "fixture-cpu"),
        ("atlas-fixture", expected),
    )
    verify_atlas_checksum(binary, "FixtureOS", "fixture-cpu")


def test_atlas_binary_checksum_mismatch_is_actionable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    binary = tmp_path / "atlas"
    binary.write_bytes(b"tampered")
    monkeypatch.setitem(
        atlas_helper.ATLAS_ARTIFACTS,
        ("FixtureOS", "fixture-cpu"),
        ("atlas-fixture", "0" * 64),
    )
    with pytest.raises(RuntimeError, match="checksum mismatch.*404.*corrupt"):
        verify_atlas_checksum(binary, "FixtureOS", "fixture-cpu")


def test_atlas_binary_without_recorded_digest_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    binary = tmp_path / "atlas"
    binary.write_bytes(b"linux fixture")
    monkeypatch.setitem(
        atlas_helper.ATLAS_ARTIFACTS,
        ("FixtureOS", "fixture-cpu"),
        ("atlas-fixture", None),
    )
    with pytest.raises(RuntimeError, match="unverified.*official sha256"):
        verify_atlas_checksum(binary, "FixtureOS", "fixture-cpu")


def _use_fixture_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, expected_sha256: str | None
) -> None:
    monkeypatch.setattr(atlas_helper, "ATLAS_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(atlas_helper.platform, "system", lambda: "FixtureOS")
    monkeypatch.setattr(atlas_helper.platform, "machine", lambda: "fixture-cpu")
    monkeypatch.setitem(
        atlas_helper.ATLAS_ARTIFACTS,
        ("FixtureOS", "fixture-cpu"),
        ("atlas-fixture", expected_sha256),
    )
    monkeypatch.setattr(atlas_helper, "_global_atlas_matching_pin", lambda: None)


def test_ensure_pinned_atlas_reuses_matching_global_without_downloading(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        atlas_helper, "_global_atlas_matching_pin", lambda: Path("/usr/local/bin/atlas")
    )

    def _fail_download(system: str, machine: str) -> Path:
        raise AssertionError("must not download when the global Atlas already matches")

    monkeypatch.setattr(atlas_helper, "_download_pinned_atlas", _fail_download)
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
    _use_fixture_cache(monkeypatch, tmp_path, digest)

    class _FakeResponse:
        content = payload

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr(atlas_helper.httpx, "get", lambda url, timeout: _FakeResponse())

    bin_dir = ensure_pinned_atlas()
    assert bin_dir is not None
    cached_binary = bin_dir / "atlas"
    assert cached_binary.read_bytes() == payload
    assert cached_binary.stat().st_mode & 0o111  # executable bits set


def test_ensure_pinned_atlas_reuses_valid_cache_without_redownloading(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"already cached binary"
    digest = hashlib.sha256(payload).hexdigest()
    _use_fixture_cache(monkeypatch, tmp_path, digest)
    cached_binary = atlas_helper._cached_atlas_binary("FixtureOS", "fixture-cpu")
    cached_binary.parent.mkdir(parents=True)
    cached_binary.write_bytes(payload)

    def _fail_download(system: str, machine: str) -> Path:
        raise AssertionError(
            "must not re-download a cache that already matches the pin"
        )

    monkeypatch.setattr(atlas_helper, "_download_pinned_atlas", _fail_download)
    bin_dir = ensure_pinned_atlas()
    assert bin_dir == cached_binary.parent


def test_ensure_pinned_atlas_redownloads_a_corrupted_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    good_payload = b"fresh good binary"
    digest = hashlib.sha256(good_payload).hexdigest()
    _use_fixture_cache(monkeypatch, tmp_path, digest)
    cached_binary = atlas_helper._cached_atlas_binary("FixtureOS", "fixture-cpu")
    cached_binary.parent.mkdir(parents=True)
    cached_binary.write_bytes(b"corrupted stale bytes")

    class _FakeResponse:
        content = good_payload

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr(atlas_helper.httpx, "get", lambda url, timeout: _FakeResponse())
    bin_dir = ensure_pinned_atlas()
    assert bin_dir is not None
    assert (bin_dir / "atlas").read_bytes() == good_payload


def test_ensure_pinned_atlas_rejects_a_tampered_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mutation guard: a byte-flipped download must fail closed, not run migrations."""
    real_payload = b"trustworthy Atlas binary"
    digest = hashlib.sha256(real_payload).hexdigest()
    _use_fixture_cache(monkeypatch, tmp_path, digest)

    class _TamperedResponse:
        content = b"trustworthy Atlas binaryX"  # one byte appended

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr(
        atlas_helper.httpx, "get", lambda url, timeout: _TamperedResponse()
    )
    with pytest.raises(RuntimeError, match="did NOT run.*checksum mismatch"):
        ensure_pinned_atlas()
    assert not atlas_helper._cached_atlas_binary("FixtureOS", "fixture-cpu").exists()


def test_ensure_pinned_atlas_network_failure_says_arm_did_not_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_fixture_cache(monkeypatch, tmp_path, "0" * 64)

    def _raise_network_error(url: str, timeout: float) -> None:
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(atlas_helper.httpx, "get", _raise_network_error)
    with pytest.raises(RuntimeError, match="did NOT run.*could not download"):
        ensure_pinned_atlas()


def test_ensure_pinned_atlas_unmapped_platform_fails_before_any_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(atlas_helper, "ATLAS_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(atlas_helper.platform, "system", lambda: "PlanNine")
    monkeypatch.setattr(atlas_helper.platform, "machine", lambda: "exotic")
    monkeypatch.setattr(atlas_helper, "_global_atlas_matching_pin", lambda: None)

    def _fail_get(url: str, timeout: float) -> None:
        raise AssertionError("must not attempt a network call for an unmapped platform")

    monkeypatch.setattr(atlas_helper.httpx, "get", _fail_get)
    with pytest.raises(RuntimeError, match="did NOT run.*no pinned Atlas artifact"):
        ensure_pinned_atlas()


def _route_anime_sql() -> str:
    root = Path(__file__).resolve().parents[5]
    migration = root / "db" / "migrations" / "20260718000001_route_anime.sql"
    return migration.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "required",
    [
        "CREATE TABLE IF NOT EXISTS route_anime",
        "REFERENCES routes(id)",
        "REFERENCES bangumi(id)",
        "INSERT INTO route_anime",
        "GRANT SELECT, INSERT, UPDATE, DELETE ON route_anime TO agent_svc",
        "ALTER TABLE routes DROP COLUMN IF EXISTS bangumi_id",
    ],
)
def test_route_anime_atlas_twin_keeps_data_plane(required: str) -> None:
    assert required in _route_anime_sql()


@pytest.mark.parametrize(
    "auth_only", ["ROW LEVEL SECURITY", "REVOKE", "CREATE POLICY", "DROP POLICY"]
)
def test_route_anime_atlas_twin_strips_auth(auth_only: str) -> None:
    assert auth_only not in _route_anime_sql()
