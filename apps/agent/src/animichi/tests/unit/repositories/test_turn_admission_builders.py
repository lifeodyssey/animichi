"""Unit tests for the turn-admission statement builders and gates (#994).

Behavior-level assertions on the typed SQLAlchemy expressions the turn
admission helpers build — no SQL strings compared, nothing executed
(raw-SQL policy, #999). Async gates run against the recording session fake.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql.dml import Insert as PgInsert
from sqlalchemy.sql.dml import Delete, Update
from sqlalchemy.sql.selectable import Select

from animichi.application.turn_admission_port import ReserveRequest
from animichi.application.turn_outcome_port import TurnRef
from animichi.infrastructure.persistence.models import reservation_table
from animichi.infrastructure.persistence.repositories import _turn_admission as ta
from animichi.tests.unit.repositories._session_fake import RecordingSessionFactory

_LEASE = datetime(2026, 8, 1, tzinfo=UTC)


def _request(**overrides: object) -> ReserveRequest:
    base: dict[str, object] = {
        "session_id": "sess-1",
        "turn_key": "turn-1",
        "identity_id": "user-9",
        "payer": "user",
        "expected_revision": 3,
        "session_digest": "dig-1",
        "owner": "owner-a",
        "lease_expires_at": _LEASE,
    }
    base.update(overrides)
    return ReserveRequest(**base)  # type: ignore[arg-type]


def _ref() -> TurnRef:
    return TurnRef(session_id="sess-1", turn_key="turn-1")


async def test_reserve_statement_uses_values_and_conflict_nothing() -> None:
    stmt = ta._reserve_statement(_request(), revision=7, session_id="sess-1")
    assert isinstance(stmt, PgInsert)
    assert stmt.table is reservation_table


async def test_reserve_identity_maps_request_columns() -> None:
    values = ta._reserve_identity(_request())
    assert values["turn_key"] == "turn-1"
    assert values["payer"] == "user"
    assert values["identity_id"] == "user-9"
    assert values["digest"] == "dig-1"
    assert values["lease_owner"] == "owner-a"


async def test_reserve_values_adds_session_revision_status_lease() -> None:
    values = ta._reserve_values(_request(), revision=4, session_id="sess-1")
    assert values["session_id"] == "sess-1"
    assert values["revision"] == 4
    assert values["status"] == ta._RESERVED
    assert values["lease_expires_at"] == _LEASE


async def test_reserve_values_preserves_none_session() -> None:
    values = ta._reserve_values(_request(session_id=None), revision=1, session_id=None)
    assert values["session_id"] is None
    assert values["status"] == ta._RESERVED


async def test_prune_keep_and_prune_statement_shape() -> None:
    keep = ta._prune_keep("sess-1")
    assert isinstance(keep, Select)
    assert keep.get_final_froms()[0] is reservation_table
    stmt = ta._prune_statement("sess-1")
    assert isinstance(stmt, Delete)
    assert stmt._where_criteria


async def test_existing_select_returns_select() -> None:
    assert isinstance(ta._existing_select("sess-1", "turn-1", None), Select)
    assert isinstance(ta._existing_select(None, "turn-1", None), Select)


async def test_where_clauses_carry_lease_guards() -> None:
    r = _request()
    assert len(ta._dispatch_where(_ref(), r.owner)) == 5  # type: ignore[arg-type]
    assert len(ta._settle_where(_ref(), r.owner)) == 5  # type: ignore[arg-type]
    assert len(ta._release_where(_ref(), r.owner)) == 4  # type: ignore[arg-type]


async def test_dispatch_settle_release_statements_are_dml() -> None:
    assert isinstance(ta._dispatch_statement(_ref(), "owner-a"), Update)
    assert isinstance(ta._settle_statement(_ref(), "owner-a", "completed"), Update)
    assert isinstance(ta._release_statement(_ref(), "owner-a"), Delete)


async def test_ownership_ok_matches_identity_or_none() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(None)
    assert await ta._ownership_ok(factory.session, "sess-1", "user-9") is True
    factory.session.result_for("user-9")
    assert await ta._ownership_ok(factory.session, "sess-1", "user-9") is True
    factory.session.result_for("other")
    assert await ta._ownership_ok(factory.session, "sess-1", None) is False


async def test_existing_maps_or_returns_none() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for([("reserved", 2, None, None)])
    outcome = await ta._existing(factory.session, "sess-1", "turn-1", None)
    assert outcome is not None
    assert outcome.status == "in_flight"
    assert outcome.revision == 2
    assert outcome.session_id == "sess-1"
    factory2 = RecordingSessionFactory()
    assert await ta._existing(factory2.session, "sess-1", "turn-1", None) is None


async def test_current_and_next_revision() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(5)
    assert await ta._current_revision(factory.session, "sess-1") == 5
    factory.session.result_for(5)
    assert await ta._next_revision(factory.session, "sess-1") == 6


async def test_prune_executes_prune_statement() -> None:
    factory = RecordingSessionFactory()
    await ta._prune(factory.session, "sess-1")
    assert len(factory.session.executed) == 1
    assert isinstance(factory.session.executed[0], Delete)


async def test_ownership_gate_short_circuits_and_reports_otherwise() -> None:
    factory = RecordingSessionFactory()
    assert await ta._ownership_gate(factory.session, _request(session_id=None)) is None
    factory.session.result_for("someone-else")
    outcome = await ta._ownership_gate(factory.session, _request())
    assert outcome is not None and outcome.status == "ownership"


async def test_revision_gate_checks_expected_revision() -> None:
    factory = RecordingSessionFactory()
    none_req = _request(expected_revision=None)
    assert await ta._revision_gate(factory.session, none_req) is None
    factory.session.result_for(3)
    assert (
        await ta._revision_gate(factory.session, _request(expected_revision=3)) is None
    )
    factory.session.result_for(9)
    stale = await ta._revision_gate(factory.session, _request(expected_revision=3))
    assert stale is not None and stale.status == "stale_revision"


async def test_digest_gate_matches_stored_or_none() -> None:
    factory = RecordingSessionFactory()
    assert await ta._digest_gate(factory.session, _request(session_digest=None)) is None
    factory.session.result_for(None)
    assert await ta._digest_gate(factory.session, _request()) is None
    factory.session.result_for({"summary": "x"})
    outcome = await ta._digest_gate(factory.session, _request(session_digest="dig-1"))
    assert outcome is not None and outcome.status == "digest_mismatch"


async def test_admitted_outcome_carries_lease() -> None:
    outcome = ta._admitted_outcome(_request(), "sess-1", 3)
    assert outcome.status == "admitted"
    assert outcome.revision == 3
    assert outcome.owner == "owner-a"
    assert outcome.lease_expires_at == _LEASE


async def test_try_insert_success_and_conflict() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(7)
    outcome = await ta._try_insert(factory.session, _request(), 7)
    assert outcome is not None and outcome.status == "admitted"
    factory2 = RecordingSessionFactory()
    assert await ta._try_insert(factory2.session, _request(), 7) is None


async def test_replay_or_inflight_returns_existing_or_in_flight() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for([("completed", 2, None, None)])
    outcome = await ta._replay_or_inflight(factory.session, _request())
    assert outcome is not None and outcome.status == "replay_completed"
    factory2 = RecordingSessionFactory()
    assert (
        await ta._replay_or_inflight(factory2.session, _request())
    ).status == "in_flight"


async def test_guard_short_circuits_ownership() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for("other-owner")
    outcome = await ta._guard(factory.session, _request())
    assert outcome is not None and outcome.status == "ownership"
