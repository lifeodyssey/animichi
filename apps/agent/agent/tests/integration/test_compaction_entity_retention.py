"""Task 5 (#273, OQ-8(c)): compaction-retained entities survive multiple
compaction rounds through a real `SessionStore` round-trip — the same
persistence path Task 4's fact ledger uses (`test_fact_ledger_persistence.py`),
proving this retention payload is not tied to that ledger (OQ-8 decoupling).
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


async def _run_compaction_turn(
    store: InMemorySessionStore,
    *,
    tool_name: str,
    args: dict[str, object],
    call_id: str,
    text: str,
) -> None:
    """Mirror `public_api.py`'s restore -> run -> persist sequence, with a
    compaction round standing in for "run"."""
    stored = await store.get(_SESSION_ID)
    session = _restore(stored)
    compact = CompactToolReturns[RuntimeDeps](_summarize_tool_content, keep_recent=0)

    await compact.compact(_call_pair(tool_name, args, call_id), _ctx(session))

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


async def test_entity_retained_in_round_one_survives_round_two() -> None:
    store = InMemorySessionStore()

    await _run_compaction_turn(
        store,
        tool_name="search_nearby",
        args={"location": "資生堂前"},
        call_id="call-1",
        text="資生堂前に行きたい",
    )
    stored = await store.get(_SESSION_ID)
    assert stored is not None
    first_round = _restore(stored).compaction_retained_entities.entities
    assert [e.value for e in first_round] == ["資生堂前"]

    await _run_compaction_turn(
        store,
        tool_name="resolve_anime",
        args={"title": "けいおん!"},
        call_id="call-2",
        text="けいおんが見たい",
    )

    stored = await store.get(_SESSION_ID)
    assert stored is not None
    entities = _restore(stored).compaction_retained_entities.entities
    assert [e.value for e in entities] == ["資生堂前", "けいおん!"]
    assert [e.tool_name for e in entities] == ["search_nearby", "resolve_anime"]
