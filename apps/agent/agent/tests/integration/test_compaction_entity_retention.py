"""Task 5 (#273, OQ-8(c)): compaction-retained entities survive many
compaction rounds through a real `SessionStore` round-trip — the same
persistence path Task 4's fact ledger uses (`test_fact_ledger_persistence.py`),
proving this retention payload is not tied to that ledger (OQ-8 decoupling).

Each round replays the **full accumulated message history**, not just the
newest pair — mirroring `session_facade.build_message_history`, which
replays every past interaction's raw messages unchanged on every turn (old
interactions are never rewritten to a compacted form in storage). This is
what makes dedup load-bearing: a naive re-record on every replay of the
same old tool call would otherwise crowd out other distinct entities via
the count cap (#476 review).
"""

from __future__ import annotations

from unittest.mock import MagicMock

from pydantic_ai import RunContext
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from agent.agents.agent_result import AgentResult
from agent.agents.animichi_agent import _summarize_tool_content
from agent.agents.history_compaction import CompactToolReturns
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import QAResponseModel
from agent.agents.session_state import SessionState
from agent.agents.tool_state import ToolState
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.schemas import PublicAPIRequest
from agent.interfaces.session_facade import (
    SessionUpdate,
    build_context_block,
    build_updated_session_state,
    extract_context_delta,
    normalize_session_state,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_SESSION_ID = "session-compaction-1"
_LONG_CONTENT = "x" * 500


def _restore(stored: dict[str, object] | None) -> SessionState:
    context = build_context_block(normalize_session_state(stored))
    if context is None:
        return SessionState()
    return SessionState.model_validate(context["session_state_v2"])


def _ctx(session: SessionState) -> RunContext[RuntimeDeps]:
    deps = RuntimeDeps(
        db=MagicMock(),
        locale="ja",
        query="q",
        catalog=MockCatalogClient(),
        tool_state=ToolState(session=session),
    )
    return RunContext(deps=deps, model=TestModel(), usage=RunUsage())


def _call_pair(
    tool_name: str, args: dict[str, object], call_id: str
) -> list[ModelMessage]:
    return [
        ModelResponse(parts=[ToolCallPart(tool_name, args, call_id)]),
        ModelRequest(parts=[ToolReturnPart(tool_name, _LONG_CONTENT, call_id)]),
    ]


async def _persist_turn(
    store: InMemorySessionStore, session: SessionState, stored: object, text: str
) -> None:
    result = AgentResult(
        output=QAResponseModel(message="ok"),
        intent="qa_response",
        session_state=session,
        steps=[],
    )
    delta = extract_context_delta(result)
    updated = build_updated_session_state(
        normalize_session_state(stored),
        SessionUpdate(
            request=PublicAPIRequest(text=text),
            response_intent=result.intent,
            response_status="ok",
            response_success=result.success,
            context_delta=delta,
        ),
    )
    await store.set(_SESSION_ID, updated)


async def _run_full_history_turn(
    store: InMemorySessionStore,
    *,
    accumulated: list[ModelMessage],
    new_pair: list[ModelMessage],
    text: str,
) -> list[ModelMessage]:
    """One turn: reprocess the entire accumulated history (old + new pair)
    through the compaction tier, then persist — matching how
    `build_message_history` replays raw messages every turn in production."""
    stored = await store.get(_SESSION_ID)
    session = _restore(stored)
    accumulated = [*accumulated, *new_pair]
    compact = CompactToolReturns[RuntimeDeps](_summarize_tool_content, keep_recent=0)

    await compact.compact(accumulated, _ctx(session))
    await _persist_turn(store, session, stored, text)
    return accumulated


async def test_entity_survives_many_full_history_replays_and_a_second_round() -> None:
    store = InMemorySessionStore()
    accumulated: list[ModelMessage] = []
    round_one = _call_pair("search_nearby", {"location": "資生堂前"}, "call-1")

    accumulated = await _run_full_history_turn(
        store, accumulated=accumulated, new_pair=round_one, text="資生堂前に行きたい"
    )
    stored = await store.get(_SESSION_ID)
    assert stored is not None
    assert [
        e.value for e in _restore(stored).compaction_retained_entities.entities
    ] == ["資生堂前"]

    for i in range(7):
        accumulated = await _run_full_history_turn(
            store, accumulated=accumulated, new_pair=[], text=f"filler {i}"
        )

    stored = await store.get(_SESSION_ID)
    assert stored is not None
    entities = _restore(stored).compaction_retained_entities.entities
    assert [e.value for e in entities] == ["資生堂前"]  # not duplicated by 7 replays

    round_two = _call_pair("resolve_anime", {"title": "けいおん!"}, "call-2")
    await _run_full_history_turn(
        store, accumulated=accumulated, new_pair=round_two, text="けいおんが見たい"
    )

    stored = await store.get(_SESSION_ID)
    assert stored is not None
    entities = _restore(stored).compaction_retained_entities.entities
    assert [e.value for e in entities] == ["資生堂前", "けいおん!"]
    assert [e.tool_name for e in entities] == ["search_nearby", "resolve_anime"]
