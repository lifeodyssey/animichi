"""Mutation proofs for TurnAdmission policy consumption (TURN-2 #949).

Deleting the single-winner gate or hardcoding a policy cell must turn the
admission seam red. Fakes live in turn_admission_fakes.py; helpers in
test_turn_admission.py.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from turn_admission_fakes import FakeTurnReservationStore, _admission, _request

from animichi.application.turn_admission import TurnAdmission
from animichi.interfaces.admission_policy import AdmissionPolicy


def test_consuming_a_hardcoded_quota_value_fails_the_seam() -> None:
    """Mutation proof: admission must consume the injected policy, not a
    hardcoded cell. A quota of 3 rejects count 4; hardcoding 20 would admit."""
    store = FakeTurnReservationStore()

    async def run() -> bool:
        admission = _admission(store, quota_count=4, policy=AdmissionPolicy(quota=3))
        verdict = await admission(_request())
        return verdict.admitted

    assert asyncio.run(run()) is False


def test_consuming_a_hardcoded_budget_value_fails_the_seam() -> None:
    """Mutation proof, budget side: a budget of 2 rejects spend 2; hardcoding
    the AUTH-1 default (5.0) would admit the same turn."""
    store = FakeTurnReservationStore()

    async def run() -> bool:
        admission = _admission(store, spent=2.0, policy=AdmissionPolicy(budget_usd=2.0))
        verdict = await admission(_request())
        return verdict.admitted

    assert asyncio.run(run()) is False


# Quota/budget policy tests (split here to keep both files <=200 lines).


async def test_quota_exhaustion_rejects_with_reset_instant() -> None:
    store = FakeTurnReservationStore()
    verdict = await _admission(store, quota_count=4, policy=AdmissionPolicy(quota=3))(
        _request()
    )
    assert verdict.admitted is False
    assert verdict.rejection is not None
    assert verdict.rejection.reason == "quota_exhausted"
    assert verdict.rejection.resets_at is not None
    assert store.fail_calls == [(None, "turn-1")]


async def test_quota_disabled_never_reads_the_counter() -> None:
    store = FakeTurnReservationStore()
    admission = _admission(store, quota_count=4, policy=AdmissionPolicy(quota=None))
    verdict = await admission(_request())
    assert verdict.admitted is True


async def test_budget_exhaustion_rejects_and_never_reaches_the_counter() -> None:
    store = FakeTurnReservationStore()
    quota = AsyncMock()
    quota.increment_and_count = AsyncMock(return_value=1)
    usage = AsyncMock()
    usage.total_cost_usd = AsyncMock(return_value=5.0)
    admission = TurnAdmission(
        store=store,
        policy=AdmissionPolicy(budget_usd=5.0),
        usage_repo=usage,
        anon_quota_repo=quota,
    )
    verdict = await admission(_request())
    assert verdict.admitted is False
    assert verdict.rejection is not None
    assert verdict.rejection.reason == "budget_exhausted"
    quota.increment_and_count.assert_not_awaited()
