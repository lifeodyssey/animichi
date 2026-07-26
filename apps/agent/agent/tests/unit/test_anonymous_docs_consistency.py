"""ARCHITECTURE.md must describe the implemented anonymous state (issue #274 AC6).

X5's forward-looking wording is backfilled once S1.8 lands, so this guards the
documented contract against drifting from the code that now implements it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agent.interfaces.usage_metering import (
    ANON_BUDGET_EXHAUSTED_CODE,
    ANON_USER_ID_PREFIX,
    ANONYMOUS_USER_TYPE,
)

ARCHITECTURE = Path(__file__).resolve().parents[5] / "docs" / "ARCHITECTURE.md"
WORKER = Path(__file__).resolve().parents[5] / "worker"


@pytest.fixture(scope="module")
def architecture() -> str:
    return ARCHITECTURE.read_text(encoding="utf-8")


def test_the_auth_section_names_the_real_worker_modules(architecture: str) -> None:
    assert "`worker/app.ts` + `worker/auth.ts`" in architecture


def test_x5_is_documented_as_implemented_rather_than_forward_looking(
    architecture: str,
) -> None:
    assert "X5, implemented in S1.8" in architecture
    assert "it is now the implemented state" in architecture


def test_the_documented_identity_shape_matches_the_code(architecture: str) -> None:
    assert f"X-User-Type: {ANONYMOUS_USER_TYPE}" in architecture
    assert f"X-User-Id: {ANON_USER_ID_PREFIX}<hex>" in architecture


def test_the_documented_opt_in_switches_match_the_worker(architecture: str) -> None:
    auth_source = (WORKER / "auth.ts").read_text(encoding="utf-8")
    for name in ("ANON_ACCESS_ENABLED", "ANON_ID_SECRET"):
        assert name in architecture
        assert name in auth_source


def test_the_documented_breaker_names_its_code_and_data_source(
    architecture: str,
) -> None:
    assert ANON_BUDGET_EXHAUSTED_CODE in architecture
    assert "ANON_DAILY_COST_BUDGET_USD" in architecture
    assert "daily_usage" in architecture


def test_the_breaker_is_documented_as_container_authoritative(
    architecture: str,
) -> None:
    assert "container ingress" in architecture
    assert "The edge never reads `daily_usage` itself." in architecture


def test_zero_history_anonymous_visitors_are_documented_as_allowed(
    architecture: str,
) -> None:
    unwrapped = " ".join(architecture.split())
    assert "there is no minimum-history threshold" in unwrapped
