"""Pin the agent admission mirror to AUTH-1's identity policy (TURN-2 #949).

``interfaces/admission_policy`` mirrors the anonymous cells of
``DEFAULT_IDENTITY_POLICY`` from ``packages/contract/src/identity-contract.ts``
so admission always consumes ONE source of numeric policy and fails on
divergence. Python cannot import the TypeScript module, so — like the
anonymous-limit code pin in ``test_anon_limits_contract_pin.py`` — this test
reads the contract source as text and asserts the mirror equals it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from animichi.interfaces.admission_policy import (
    AUTH1_ANONYMOUS_DAILY_COST_BUDGET_USD,
    AUTH1_ANONYMOUS_DAILY_MESSAGE_QUOTA,
)

CONTRACT = (
    Path(__file__).resolve().parents[6]
    / "packages"
    / "contract"
    / "src"
    / "identity-contract.ts"
)


@pytest.fixture(scope="module")
def contract_source() -> str:
    return CONTRACT.read_text(encoding="utf-8")


def test_anonymous_message_quota_matches_the_contract_default(
    contract_source: str,
) -> None:
    assert (
        f"dailyMessageQuota: {AUTH1_ANONYMOUS_DAILY_MESSAGE_QUOTA}" in contract_source
    )


def test_anonymous_cost_budget_matches_the_contract_default(
    contract_source: str,
) -> None:
    assert (
        f"dailyCostBudgetUsd: {AUTH1_ANONYMOUS_DAILY_COST_BUDGET_USD}"
        in contract_source
    )


def test_the_mirror_is_anchored_to_the_anonymous_class() -> None:
    """The anchor must be the anonymous class body, not a stray number."""
    source = CONTRACT.read_text(encoding="utf-8")
    anonymous_body = source.split("anonymous: {", 1)[1].split("authenticated: {", 1)[0]
    assert (
        f"dailyMessageQuota: {AUTH1_ANONYMOUS_DAILY_MESSAGE_QUOTA}," in anonymous_body
    )
    assert (
        f"dailyCostBudgetUsd: {AUTH1_ANONYMOUS_DAILY_COST_BUDGET_USD},"
        in anonymous_body
    )
