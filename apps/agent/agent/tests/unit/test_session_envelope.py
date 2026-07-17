"""Envelope-level SessionState persistence and legacy-read contracts."""

from agent.agents.session_state import (
    CurrentAnime,
    PointState,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from agent.interfaces.schemas import PublicAPIRequest
from agent.interfaces.session_facade import (
    SessionUpdate,
    build_context_block,
    build_updated_session_state,
    normalize_session_state,
)


def _old_interaction(state: SessionState) -> object:
    return {"context_delta": {"session_state_v2": state.model_dump(mode="json")}}


def test_updated_session_hoists_complete_typed_state_to_envelope() -> None:
    runtime = SessionState(current_anime=CurrentAnime(bangumi_id="485", title="Haruhi"))
    updated = build_updated_session_state(
        normalize_session_state(None),
        SessionUpdate(
            request=PublicAPIRequest(text="Haruhi"),
            response_intent="clarify",
            response_status="needs_clarification",
            response_success=True,
            context_delta={
                "session_state_v2": runtime.model_dump(mode="json"),
                "trace": "kept",
            },
        ),
    )
    interaction = updated["interactions"][0]
    assert interaction["context_delta"] == {"trace": "kept"}
    assert SessionState.model_validate(updated["session_state_v2"]) == runtime


def test_many_turns_store_one_envelope_snapshot_and_none_in_history() -> None:
    updated = normalize_session_state(None)
    for index in range(5):
        runtime = SessionState(
            current_anime=CurrentAnime(bangumi_id=str(index), title=str(index))
        )
        updated = build_updated_session_state(
            updated,
            SessionUpdate(
                request=PublicAPIRequest(text=str(index)),
                response_intent="general_qa",
                response_status="ok",
                response_success=True,
                context_delta={"session_state_v2": runtime.model_dump(mode="json")},
            ),
        )
    interactions = updated["interactions"]
    assert "session_state_v2" in updated
    assert all(
        "session_state_v2" not in interaction["context_delta"]
        for interaction in interactions
    )


def test_old_interaction_snapshot_still_restores_its_registry() -> None:
    runtime = SessionState()
    runtime.store_search_result(
        ResultRef("search:legacy"),
        SearchPayloadState(
            kind="bangumi",
            rows=[PointState(id="p1", bangumi_id="115908")],
            row_count=1,
            anime_id="115908",
        ),
    )
    block = build_context_block({"interactions": [_old_interaction(runtime)]})
    assert block is not None
    restored = SessionState.model_validate(block["session_state_v2"])
    assert restored.search_results[ResultRef("search:legacy")].rows[0].id == "p1"


def test_malformed_envelope_does_not_resurrect_an_old_snapshot() -> None:
    previous = SessionState(
        current_anime=CurrentAnime(bangumi_id="485", title="Haruhi")
    )
    block = build_context_block(
        {
            "session_state_v2": {"unknown": True},
            "interactions": [_old_interaction(previous)],
        }
    )
    assert block is None


def test_stateless_turn_preserves_the_previous_envelope_snapshot() -> None:
    runtime = SessionState(current_anime=CurrentAnime(bangumi_id="485", title="Haruhi"))
    previous = normalize_session_state(
        {"session_state_v2": runtime.model_dump(mode="json")}
    )

    updated = build_updated_session_state(
        previous,
        SessionUpdate(
            request=PublicAPIRequest(text="thanks"),
            response_intent="general_qa",
            response_status="info",
            response_success=True,
            context_delta={},
        ),
    )

    assert updated["session_state_v2"] == previous["session_state_v2"]
