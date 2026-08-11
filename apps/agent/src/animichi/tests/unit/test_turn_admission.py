"""TurnAdmission seam tests (TURN-2 #949) through the sanctioned fake store.

Covers the acceptance matrix: initial/continued admission, one durable winner
under concurrency, completed/in-flight replay, digest mismatch, stale
revision, quota, ownership collapse, and BYOK pass. Removing the durable
uniqueness (the fake's single-winner gate) or hardcoding a policy value turns
these red — proven by the mutation tests at the bottom.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from animichi.application.errors import InvalidInputError
from animichi.application.turn_admission import (
    AdmissionIdentity,
    AdmissionPolicy,
    AdmissionRequest,
    TurnAdmission,
)
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore

ANON_ID = "anon_0123456789abcdef0123456789abcdef"
ANON = AdmissionIdentity(user_id=ANON_ID, user_type="anonymous")
HUMAN = AdmissionIdentity(user_id="user-1", user_type="human")
MISMATCH_DIGEST = "0" * 64


def _request(
    *,
    identity: AdmissionIdentity = ANON,
    session_id: str | None = None,
    turn_key: str = "turn-1",
    expected_revision: int | None = None,
    session_digest: str | None = None,
    is_byok: bool = False,
) -> AdmissionRequest:
    return AdmissionRequest(
        identity=identity,
        session_id=session_id,
        turn_key=turn_key,
        expected_revision=expected_revision,
        session_digest=session_digest,
        is_byok=is_byok,
    )


def _admission(
    store: FakeTurnReservationStore,
    *,
    policy: AdmissionPolicy | None = None,
    quota_count: int | None = None,
    spent: float = 0.0,
) -> TurnAdmission:
    quota_repo = None
    if quota_count is not None:
        repo = AsyncMock()
        repo.increment_and_count = AsyncMock(return_value=quota_count)
        quota_repo = repo
    usage_repo = None
    if spent > 0 or policy is None or policy.budget_usd > 0:
        usage = AsyncMock()
        usage.total_cost_usd = AsyncMock(return_value=spent)
        usage.accumulate_usage = AsyncMock(return_value=None)
        usage_repo = usage
    return TurnAdmission(
        store=store,
        policy=policy or AdmissionPolicy(),
        usage_repo=usage_repo,
        anon_quota_repo=quota_repo,
    )


async def test_initial_anonymous_admission_reserves_one_turn() -> None:
    store = FakeTurnReservationStore()
    verdict = await _admission(store)(_request())
    assert verdict.admitted is True
    assert verdict.payer == "anon"
    assert verdict.revision == 1
    assert verdict.replayed is False
    assert len(store.reservations) == 1


async def test_continued_admission_bumps_the_revision() -> None:
    store = FakeTurnReservationStore()
    admission = _admission(store)
    first = await admission(
        _request(session_id="s-1", turn_key="turn-1", expected_revision=0)
    )
    assert first.revision == 1
    second = await admission(
        _request(session_id="s-1", turn_key="turn-2", expected_revision=1)
    )
    assert second.admitted is True
    assert second.revision == 2


async def test_one_durable_winner_under_concurrency() -> None:
    store = FakeTurnReservationStore()
    admission = _admission(store)

    async def race() -> list[bool]:
        results = await asyncio.gather(
            admission(_request(session_id="s-1", turn_key="same")),
            admission(_request(session_id="s-1", turn_key="same")),
        )
        return [result.admitted for result in results]

    admitted = await race()
    print("RACE_DEBUG admitted=", admitted, "reservations=", len(store.reservations))
    assert admitted.count(True) == 1
    assert len(store.reservations) == 1


async def test_completed_turn_replays_without_a_new_reservation() -> None:
    store = FakeTurnReservationStore()
    admission = _admission(store)
    await admission(_request(session_id="s-1", turn_key="turn-1"))
    await store.complete(session_id="s-1", turn_key="turn-1")

    replay = await admission(
        _request(session_id="s-1", turn_key="turn-1", expected_revision=1)
    )
    assert replay.admitted is True
    assert replay.replayed is True
    assert len(store.reservations) == 1


async def test_in_flight_turn_is_rejected_not_double_run() -> None:
    store = FakeTurnReservationStore()
    admission = _admission(store)
    await admission(_request(session_id="s-1", turn_key="turn-1"))
    second = await admission(
        _request(session_id="s-1", turn_key="turn-1", expected_revision=1)
    )
    assert second.admitted is False
    assert second.rejection is not None
    assert second.rejection.reason == "in_flight"


async def test_digest_mismatch_rejects() -> None:
    store = FakeTurnReservationStore()
    store.seed_session("s-1", owner=None)
    verdict = await _admission(store)(
        _request(
            session_id="s-1",
            turn_key="turn-1",
            session_digest=MISMATCH_DIGEST,
        )
    )
    assert verdict.admitted is False
    assert verdict.rejection is not None
    assert verdict.rejection.reason == "digest_mismatch"


async def test_stale_revision_rejects() -> None:
    store = FakeTurnReservationStore()
    await _admission(store)(_request(session_id="s-1", turn_key="turn-1"))
    verdict = await _admission(store)(
        _request(session_id="s-1", turn_key="turn-2", expected_revision=1)
    )
    assert verdict.admitted is True
    stale = await _admission(store)(
        _request(session_id="s-1", turn_key="turn-3", expected_revision=1)
    )
    assert stale.admitted is False
    assert stale.rejection is not None
    assert stale.rejection.reason == "stale_revision"


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


async def test_ownership_collapse_rejects() -> None:
    store = FakeTurnReservationStore()
    store.seed_session("s-1", owner="user-a")
    verdict = await _admission(store)(
        _request(identity=HUMAN, session_id="s-1", turn_key="turn-1")
    )
    assert verdict.admitted is False
    assert verdict.rejection is not None
    assert verdict.rejection.reason == "ownership"


async def test_byok_pass_skips_budget_and_quota() -> None:
    store = FakeTurnReservationStore()
    verdict = await _admission(
        store,
        spent=99.0,
        quota_count=99,
        policy=AdmissionPolicy(quota=1, budget_usd=1.0),
    )(_request(identity=HUMAN, is_byok=True))
    assert verdict.admitted is True
    assert verdict.payer == "byok"


async def test_anonymous_byok_presence_is_rejected() -> None:
    store = FakeTurnReservationStore()
    verdict = await _admission(store)(_request(is_byok=True))
    assert verdict.admitted is False
    assert verdict.rejection is not None
    assert verdict.rejection.reason == "byok_requires_login"


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


async def test_blank_turn_key_is_rejected_before_any_store_call() -> None:
    store = FakeTurnReservationStore()
    with pytest.raises(InvalidInputError):
        await _admission(store)(_request(turn_key="   "))
    assert len(store.reservations) == 0


async def test_admission_without_a_store_still_gates_quota() -> None:
    quota = AsyncMock()
    quota.increment_and_count = AsyncMock(return_value=4)
    admission = TurnAdmission(
        store=None, policy=AdmissionPolicy(quota=3), anon_quota_repo=quota
    )
    verdict = await admission(_request())
    assert verdict.admitted is False
    assert verdict.rejection is not None
    assert verdict.rejection.reason == "quota_exhausted"


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
