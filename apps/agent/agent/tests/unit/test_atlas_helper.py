"""Static contract tests for the shared Atlas invocation."""

from pathlib import Path

import pytest

from agent.tests.atlas_helper import (
    ATLAS_TIMEOUT_SECONDS,
    atlas_apply_command,
    parse_atlas_version,
)


def test_atlas_command_pins_public_revisions_and_ten_minute_budget() -> None:
    command = atlas_apply_command()
    assert command[-2:] == ("--revisions-schema", "public")
    assert command[3:5] == ("--env", "neon")
    assert ATLAS_TIMEOUT_SECONDS >= 600
    assert parse_atlas_version("atlas version v0.30.0") == "0.30.0"


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
