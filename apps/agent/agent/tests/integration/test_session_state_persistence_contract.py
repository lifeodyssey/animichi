"""Persistence-to-runtime contract for versioned typed session state."""

from __future__ import annotations

from unittest.mock import MagicMock

from agent.agents.agent_result import AgentResult
from agent.agents.animichi_runner import _seed_tool_state
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import QADataModel, QAResponseModel
from agent.agents.session_state import CurrentAnime, SessionState
from agent.interfaces.schemas import PublicAPIRequest
from agent.interfaces.session_facade import (
    SessionUpdate,
    build_context_block,
    build_updated_session_state,
    extract_context_delta,
    normalize_session_state,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def test_session_state_survives_interaction_persistence_and_runtime_seed() -> None:
    session = SessionState(
        current_anime=CurrentAnime(bangumi_id="115908", title="Eupho")
    )
    output = QAResponseModel(
        intent="general_qa",
        message="Answer.",
        data=QADataModel(message="Answer."),
    )
    result = AgentResult(
        output=output,
        intent="general_qa",
        session_state=session,
    )
    delta = extract_context_delta(result)
    persisted = build_updated_session_state(
        normalize_session_state(None),
        SessionUpdate(
            request=PublicAPIRequest(text="follow up"),
            response_intent=result.intent,
            response_status="ok",
            response_success=result.success,
            context_delta=delta,
        ),
    )

    context = build_context_block(persisted)
    assert context is not None
    deps = RuntimeDeps(
        db=MagicMock(),
        locale="en",
        query="follow up",
        catalog=MockCatalogClient(),
    )
    _seed_tool_state(deps, context)

    assert deps.tool_state.session == session
