"""Static contract tests for the shared Atlas invocation."""

import hashlib
from pathlib import Path

import pytest

from agent.tests import atlas_helper
from agent.tests.atlas_helper import (
    ATLAS_MACOS_ARM64_SHA256,
    ATLAS_TIMEOUT_SECONDS,
    atlas_apply_command,
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


def test_atlas_binary_without_recorded_digest_fails_closed(tmp_path: Path) -> None:
    binary = tmp_path / "atlas"
    binary.write_bytes(b"linux fixture")
    with pytest.raises(RuntimeError, match="unverified.*official sha256"):
        verify_atlas_checksum(binary, "Linux", "x86_64")


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
