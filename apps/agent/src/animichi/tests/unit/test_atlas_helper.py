"""Static contract tests for the shared Atlas invocation.

Self-heal / cache-provisioning behavior lives in test_atlas_self_heal.py — kept
separate so this file stays under the repo's 200-line test-file ceiling.
"""

import hashlib
from pathlib import Path

import pytest

from animichi.tests import atlas_helper
from animichi.tests.atlas_helper import (
    ATLAS_MACOS_ARM64_SHA256,
    ATLAS_TIMEOUT_SECONDS,
    atlas_apply_command,
    parse_atlas_version,
    verify_atlas_checksum,
)


def test_atlas_command_pins_public_revisions_and_ten_minute_budget() -> None:
    command = atlas_apply_command("postgresql://example/test")
    assert command[-2:] == ("--revisions-schema", "public")
    assert command[3:5] == ("--dir", "file://migrations/neon")
    assert command[5:7] == ("--url", "postgresql://example/test")
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


def _saved_route_anime_sql() -> str:
    root = Path(__file__).resolve().parents[6]
    migration = (
        root / "migrations" / "neon" / "20260809000027_table_saved_route_anime.sql"
    )
    return migration.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "required",
    [
        "CREATE TABLE public.saved_route_anime",
        "REFERENCES public.saved_routes(id) ON DELETE CASCADE",
        "REFERENCES public.bangumi(id)",
        'UNIQUE (saved_route_id, "position")',
        "idx_saved_route_anime_bangumi",
    ],
)
def test_route_anime_atlas_twin_keeps_data_plane(required: str) -> None:
    assert required in _saved_route_anime_sql()


@pytest.mark.parametrize(
    "forbidden",
    ["DROP COLUMN", "DROP TABLE", "INSERT INTO saved_route_anime"],
)
def test_route_anime_atlas_twin_has_no_alter_or_embedded_seed(forbidden: str) -> None:
    assert forbidden not in _saved_route_anime_sql()


@pytest.mark.parametrize(
    "auth_only", ["ROW LEVEL SECURITY", "REVOKE", "CREATE POLICY", "DROP POLICY"]
)
def test_route_anime_atlas_twin_strips_auth(auth_only: str) -> None:
    assert auth_only not in _saved_route_anime_sql()
