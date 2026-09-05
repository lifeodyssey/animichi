"""ARCHITECTURE.md must describe the implemented anonymous state (issue #274 AC6).

X5's forward-looking wording is backfilled once S1.8 lands, so this guards the
documented contract against drifting from the code that now implements it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from animichi.interfaces.usage_metering import (
    ANON_BUDGET_EXHAUSTED_CODE,
    ANON_USER_ID_PREFIX,
    ANONYMOUS_USER_TYPE,
)

ARCHITECTURE = Path(__file__).resolve().parents[6] / "docs" / "ARCHITECTURE.md"
WORKER = Path(__file__).resolve().parents[6] / "workers" / "edge" / "src"


@pytest.fixture(scope="module")
def architecture() -> str:
    return ARCHITECTURE.read_text(encoding="utf-8")


def test_the_auth_section_names_the_real_worker_modules(architecture: str) -> None:
    assert (
        "`workers/edge/src/app.ts` + `workers/edge/src/identity/auth.ts`"
        in architecture
    )


def test_x5_is_documented_as_implemented_rather_than_forward_looking(
    architecture: str,
) -> None:
    assert "X5, implemented in S1.8" in architecture
    assert "it is now the implemented state" in architecture


def test_the_documented_identity_shape_matches_the_code(architecture: str) -> None:
    assert f"X-User-Type: {ANONYMOUS_USER_TYPE}" in architecture
    assert f"X-User-Id: {ANON_USER_ID_PREFIX}<hex>" in architecture


def test_the_documented_opt_in_switches_match_the_worker(architecture: str) -> None:
    # The anonymous gate moved out of auth.ts into identity/anonymous-id.ts
    # (1-10-50 split): the switches live where `anonymousEnabled` reads them.
    auth_source = (WORKER / "identity" / "anonymous-id.ts").read_text(encoding="utf-8")
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
    assert "container ingress is the authoritative decider" in architecture


def test_the_breaker_is_documented_as_unowned_on_the_edge_tier(
    architecture: str,
) -> None:
    """Under `AGENT_TURN_ROUTE = "edge"` the turn never reaches the container, so
    the 403 the edge latch waits for is never produced and nothing under
    `workers/edge/src/agent/` reads the budget variable (EG-01,
    `docs/specs/2026-09-05-repo-smell-audit.md` §1.2). The doc must say so for as
    long as that is true — this pin fails once someone fixes it, which is the
    point."""
    edge_agent = WORKER / "agent"
    sources = "".join(
        path.read_text(encoding="utf-8") for path in sorted(edge_agent.rglob("*.ts"))
    )
    assert "ANON_DAILY_COST_BUDGET_USD" not in sources
    assert "**On the edge tier this ceiling currently has no decider.**" in architecture


def test_zero_history_anonymous_visitors_are_documented_as_allowed(
    architecture: str,
) -> None:
    unwrapped = " ".join(architecture.split())
    assert "there is no minimum-history threshold" in unwrapped
