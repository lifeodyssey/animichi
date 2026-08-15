"""AgentTurn selection kinds and self-admission headers (TURN-4 #955).

Point and candidate selection turns skip the model port; a turn with no
pre-granted verdict admits itself from the request headers.
"""

from __future__ import annotations

from animichi.application.turn_types import (
    CandidateSelectionTurn,
    PointSelectionTurn,
    TextTurn,
    TurnInput,
)
from animichi.tests.unit.agent_turn_fakes import IDENTITY, Harness
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore


async def test_selection_kinds_skip_the_model_port() -> None:
    harness = Harness(FakeTurnReservationStore())

    await harness.agent(
        TurnInput(
            session_id=None,
            turn_key="turn-2",
            identity=IDENTITY,
            kind=PointSelectionTurn(point_ids=("p1",), locale="ja"),
        )
    )
    assert harness.execution.kinds == [
        PointSelectionTurn(point_ids=("p1",), locale="ja")
    ]
    assert harness.execution.contexts == [None]

    harness2 = Harness(FakeTurnReservationStore())
    await harness2.agent(
        TurnInput(
            session_id=None,
            turn_key="turn-3",
            identity=IDENTITY,
            kind=CandidateSelectionTurn(
                candidate_ids=("a1",), clarification_id=1, locale="ja"
            ),
        )
    )
    assert harness2.execution.kinds == [
        CandidateSelectionTurn(candidate_ids=("a1",), clarification_id=1, locale="ja")
    ]


async def test_admission_uses_the_turn_headers_when_no_verdict_is_given() -> None:
    store = FakeTurnReservationStore()
    store.session_state["s-1"] = {"state": "x"}
    harness = Harness(store)
    result = await harness.agent(
        TurnInput(
            session_id="s-1",
            turn_key="turn-9",
            identity=IDENTITY,
            kind=TextTurn(text="京吹", locale="ja"),
            session_digest="deadbeef",
        )
    )
    assert result.outcome == "rejected"
    assert result.rejection is not None
    assert result.rejection.reason == "digest_mismatch"
