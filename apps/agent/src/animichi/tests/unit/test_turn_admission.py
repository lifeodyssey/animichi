"""TurnAdmission seam tests (TURN-2 #949) via the fake store."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from animichi.application.errors import InvalidInputError
from animichi.application.turn_admission import (
    AdmissionPolicy,
    AdmissionRejection,
    AdmissionVerdict,
    TurnAdmission,
)
from animichi.application.turn_outcome_port import TurnRef
from animichi.interfaces.routes.admission import (
    DIGEST_MISMATCH_MESSAGE,
    admission_rejection_response,
)
from animichi.tests.unit.turn_admission_fakes import (
    HUMAN,
    MISMATCH_DIGEST,
    FakeTurnReservationStore,
    _admission,
    _request,
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
    assert admitted.count(True) == 1
    assert len(store.reservations) == 1


async def test_completed_turn_replays_without_a_new_reservation() -> None:
    store = FakeTurnReservationStore()
    admission = _admission(store)
    first = await admission(_request(session_id="s-1", turn_key="turn-1"))
    assert first.owner is not None
    ref = TurnRef(session_id="s-1", turn_key="turn-1")
    await store.dispatch(ref, owner=first.owner)
    await store.settle(ref, owner=first.owner, outcome="completed")

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


async def test_anonymous_byok_rejected() -> None:
    store = FakeTurnReservationStore()
    verdict = await _admission(store)(_request(is_byok=True))
    assert verdict.admitted is False
    assert verdict.rejection is not None
    assert verdict.rejection.reason == "byok_requires_login"


async def test_blank_turn_key_is_rejected_before_any_store_call() -> None:
    store = FakeTurnReservationStore()
    with pytest.raises(InvalidInputError):
        await _admission(store)(_request(turn_key="   "))
    assert len(store.reservations) == 0


async def test_adopt_namespaced_turn_key_is_rejected_before_any_store_call() -> None:
    """SESSION-2 #960: the `adopt:` turn_key namespace is reserved for the
    synthetic adoption marker rows; a client key in it must never replay a
    marker's completed status."""
    store = FakeTurnReservationStore()
    with pytest.raises(InvalidInputError):
        await _admission(store)(_request(turn_key="adopt:s-1"))
    assert len(store.reservations) == 0


async def test_admission_without_a_store_still_gates_quota() -> None:
    quota = AsyncMock()
    quota.count_for = AsyncMock(return_value=4)
    admission = TurnAdmission(
        store=None, policy=AdmissionPolicy(quota=3), anon_quota_repo=quota
    )
    verdict = await admission(_request())
    assert verdict.admitted is False
    assert verdict.rejection is not None
    assert verdict.rejection.reason == "quota_exhausted"


async def test_digest_mismatch_maps_to_conflict_envelope() -> None:
    verdict = AdmissionVerdict(
        admitted=False, payer="anon", rejection=AdmissionRejection("digest_mismatch")
    )
    response = admission_rejection_response(verdict)
    assert response is not None
    assert response.status_code == 409
    body = json.loads(response.body)
    assert body == {
        "error": {"code": "session_digest_mismatch", "message": DIGEST_MISMATCH_MESSAGE}
    }
