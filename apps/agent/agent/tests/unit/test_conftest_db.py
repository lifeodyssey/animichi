"""Unit contract for the v4.2 three-arm database fixture."""

from __future__ import annotations

import pytest

from agent.tests.db_config import (
    DatabaseArm,
    DatabaseConfig,
    PreflightPlan,
    preflight_plan,
    select_database_arm,
)


@pytest.mark.parametrize(
    ("environment", "arm"),
    [
        ({}, DatabaseArm.DOCKER),
        ({"TEST_DB": "docker"}, DatabaseArm.DOCKER),
        (
            {
                "TEST_DB": "neon",
                "NEON_API_KEY": "secret",
                "NEON_PROJECT_ID": "project-test",
            },
            DatabaseArm.NEON,
        ),
        ({"TEST_DATABASE_URL": "postgresql://u:p@ep-safe/db"}, DatabaseArm.BYO),
    ],
)
def test_selector_happy_rows(environment: dict[str, str], arm: DatabaseArm) -> None:
    assert select_database_arm(environment).arm is arm


@pytest.mark.parametrize(
    ("environment", "message"),
    [
        (
            {"TEST_DATABASE_URL": "postgresql://u:p@ep-safe/db", "TEST_DB": "docker"},
            "conflicts",
        ),
        (
            {"TEST_DATABASE_URL": "postgresql://u:p@ep-safe/db", "TEST_DB": "neon"},
            "conflicts",
        ),
        (
            {"TEST_DATABASE_URL": "postgresql://u:p@ep-safe/db", "TEST_DB": "unknown"},
            "conflicts",
        ),
        ({"TEST_DB": "supabase"}, "unknown TEST_DB"),
        ({"TEST_DB": "neon"}, "requires NEON_API_KEY"),
        ({"TEST_DB_ALLOW_MUTATION": "1"}, "valid only"),
        (
            {
                "TEST_DATABASE_URL": "postgresql://u:p@ep-safe.neon.tech/db",
                "TEST_DB_ALLOW_MUTATION": "1",
            },
            "requires NEON_API_KEY",
        ),
        ({"TEST_DB_ALLOW_MUTATION": "yes"}, "must be 0, 1, or unset"),
    ],
)
def test_selector_error_rows(environment: dict[str, str], message: str) -> None:
    with pytest.raises(RuntimeError, match=message):
        select_database_arm(environment)


@pytest.mark.parametrize(
    ("config", "expected"),
    [
        (DatabaseConfig(DatabaseArm.DOCKER), PreflightPlan(True, False, True, False)),
        (DatabaseConfig(DatabaseArm.NEON), PreflightPlan(True, False, True, False)),
        (
            DatabaseConfig(DatabaseArm.BYO, "postgresql://u:p@ep-safe/db"),
            PreflightPlan(False, True, False, False),
        ),
        (
            DatabaseConfig(
                DatabaseArm.BYO,
                "postgresql://u:p@ep-safe/db",
                "secret",
                "project-test",
                True,
                True,
            ),
            PreflightPlan(False, True, True, True),
        ),
    ],
)
def test_preflight_decision_matrix(
    config: DatabaseConfig, expected: PreflightPlan
) -> None:
    assert preflight_plan(config) == expected


def test_non_neon_byo_mutation_needs_only_explicit_opt_in() -> None:
    config = select_database_arm(
        {
            "TEST_DATABASE_URL": "postgresql://u:p@localhost:5432/test",
            "TEST_DB_ALLOW_MUTATION": "1",
        }
    )
    assert config.allow_mutation is True
    assert config.neon_endpoint is False
    assert preflight_plan(config).verify_identity is False


def test_read_only_byo_ignores_irrelevant_partial_neon_credentials() -> None:
    config = select_database_arm(
        {
            "TEST_DATABASE_URL": "postgresql://u:p@ep-safe.neon.tech/test",
            "NEON_API_KEY": "ambient-secret",
        }
    )
    assert config.arm is DatabaseArm.BYO
    assert config.allow_mutation is False


def test_selected_neon_arm_still_rejects_partial_credentials() -> None:
    with pytest.raises(RuntimeError, match="must be set together"):
        select_database_arm({"TEST_DB": "neon", "NEON_API_KEY": "secret"})
