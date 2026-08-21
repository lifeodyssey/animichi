"""JSONB settle payload must be json.dumps-able (#1112)."""

from __future__ import annotations

import json
from dataclasses import dataclass

from animichi.application.turn_outcome_port import TurnRef
from animichi.infrastructure.persistence.repositories.turn_reservation import (
    SQLModelTurnReservationStore,
)
from animichi.tests.unit.repositories._session_fake import RecordingSessionFactory


@dataclass
class _Opaque:
    intent: str


def _bound_outcome_payload(statement: object) -> object:
    params = statement.compile().params
    return params["outcome_payload"]


async def test_settle_binds_json_serializable_dataclass_payload() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for("row-id")
    store = SQLModelTurnReservationStore(factory)
    won = await store.settle(
        TurnRef(session_id="sess-1", turn_key="turn-1"),
        owner="owner-a",
        outcome="completed",
        outcome_payload=_Opaque(intent="clarify"),
    )
    assert won is True
    payload = _bound_outcome_payload(factory.session.executed[0])
    assert json.loads(json.dumps(payload)) == {"intent": "clarify"}


async def test_settle_passes_mapping_payload_through() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for("row-id")
    store = SQLModelTurnReservationStore(factory)
    raw = {"out": 1}
    await store.settle(
        TurnRef(session_id="sess-1", turn_key="turn-1"),
        owner="owner-a",
        outcome="completed",
        outcome_payload=raw,
    )
    assert _bound_outcome_payload(factory.session.executed[0]) == raw
