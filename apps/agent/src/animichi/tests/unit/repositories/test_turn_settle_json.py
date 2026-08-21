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


class _Unknown:
    def __str__(self) -> str:
        return "opaque-outcome"


def _recording_store() -> tuple[SQLModelTurnReservationStore, RecordingSessionFactory]:
    factory = RecordingSessionFactory()
    factory.session.result_for("row-id")
    return SQLModelTurnReservationStore(factory), factory


async def _settle_completed(
    store: SQLModelTurnReservationStore, payload: object | None = None
) -> bool:
    return await store.settle(
        TurnRef(session_id="sess-1", turn_key="turn-1"),
        owner="owner-a",
        outcome="completed",
        outcome_payload=payload,
    )


def _bound_outcome_payload(factory: RecordingSessionFactory) -> object:
    return factory.session.executed[0].compile().params["outcome_payload"]


async def test_settle_binds_json_serializable_dataclass_payload() -> None:
    store, factory = _recording_store()
    won = await _settle_completed(store, _Opaque(intent="clarify"))
    assert won is True
    assert json.loads(json.dumps(_bound_outcome_payload(factory))) == {
        "intent": "clarify"
    }


async def test_settle_passes_mapping_payload_through() -> None:
    store, factory = _recording_store()
    raw = {"out": 1}
    await _settle_completed(store, raw)
    assert _bound_outcome_payload(factory) == raw


async def test_settle_stringifies_unknown_payload_via_fallback() -> None:
    store, factory = _recording_store()
    await _settle_completed(store, _Unknown())
    assert json.loads(json.dumps(_bound_outcome_payload(factory))) == "opaque-outcome"


async def test_settle_omits_none_payload() -> None:
    store, factory = _recording_store()
    await _settle_completed(store)
    assert "outcome_payload" not in factory.session.executed[0].compile().params
