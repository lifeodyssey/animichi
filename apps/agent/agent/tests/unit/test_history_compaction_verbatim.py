"""Task 5 (#273, OQ-8(c)): compaction-time verbatim entity retention.

Extends the existing `CompactToolReturns._candidate_summary` precedent —
this covers the new, decoupled entity-retention path only. Ordinal
candidate preservation stays covered by `test_native_history_candidates.py`.
"""

from __future__ import annotations

from typing import cast
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

from agent.agents.animichi_agent import _summarize_tool_content
from agent.agents.history_compaction import CompactToolReturns
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.session_state import SessionState
from agent.agents.tool_state import ToolState
from agent.domain.compaction_retention import RetainedEntityLedger
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_LONG_CONTENT = "x" * 500


def _call_pair(
    tool_name: str, args: dict[str, object], content: object, call_id: str
) -> list[ModelMessage]:
    return [
        ModelResponse(parts=[ToolCallPart(tool_name, args, call_id)]),
        ModelRequest(parts=[ToolReturnPart(tool_name, content, call_id)]),
    ]


def _ctx(session: SessionState) -> RunContext[RuntimeDeps]:
    deps = RuntimeDeps(
        db=MagicMock(),
        locale="ja",
        query="q",
        catalog=MockCatalogClient(),
        tool_state=ToolState(session=session),
    )
    return RunContext(deps=deps, model=TestModel(), usage=RunUsage())


async def test_place_name_survives_compaction_in_session_state() -> None:
    session = SessionState()
    messages = _call_pair(
        "search_nearby", {"location": "資生堂前"}, _LONG_CONTENT, "call-1"
    )
    compact = CompactToolReturns[RuntimeDeps](_summarize_tool_content, keep_recent=0)

    await compact.compact(messages, _ctx(session))

    entities = session.compaction_retained_entities.entities
    assert len(entities) == 1
    assert entities[0].tool_name == "search_nearby"
    assert entities[0].value == "資生堂前"


async def test_no_extractable_entity_writes_no_retention_payload() -> None:
    session = SessionState()
    messages = _call_pair(
        "plan_route", {"search_result_ref": "ref-1"}, _LONG_CONTENT, "call-2"
    )
    compact = CompactToolReturns[RuntimeDeps](_summarize_tool_content, keep_recent=0)

    await compact.compact(messages, _ctx(session))

    assert session.compaction_retained_entities.is_empty()


async def test_short_return_needs_no_compaction_and_retains_nothing() -> None:
    session = SessionState()
    messages = _call_pair("search_nearby", {"location": "資生堂前"}, "ok", "call-3")
    compact = CompactToolReturns[RuntimeDeps](_summarize_tool_content, keep_recent=0)

    await compact.compact(messages, _ctx(session))

    assert session.compaction_retained_entities.is_empty()


async def test_extraction_failure_degrades_without_raising() -> None:
    """A `ctx` shape that isn't a real `RunContext[RuntimeDeps]` (here, the
    `None` sentinel other compaction tests already pass) must never raise —
    it just degrades to today's plain truncation behaviour."""
    messages = _call_pair(
        "search_nearby", {"location": "資生堂前"}, _LONG_CONTENT, "call-4"
    )
    compact = CompactToolReturns[None](_summarize_tool_content, keep_recent=0)

    compacted = await compact.compact(messages, cast(RunContext[None], None))

    returned = cast(ToolReturnPart, cast(ModelRequest, compacted[1]).parts[0])
    assert returned.content != _LONG_CONTENT


async def test_missing_call_args_degrades_without_raising() -> None:
    """A tool return with no matching `ToolCallPart` (the pair was itself
    compacted away by an earlier turn) must not raise."""
    session = SessionState()
    request = ModelRequest(
        parts=[ToolReturnPart("search_nearby", _LONG_CONTENT, "orphan-call")]
    )
    compact = CompactToolReturns[RuntimeDeps](_summarize_tool_content, keep_recent=0)

    compacted = await compact.compact([request], _ctx(session))

    returned = cast(ToolReturnPart, cast(ModelRequest, compacted[0]).parts[0])
    assert returned.content != _LONG_CONTENT
    assert session.compaction_retained_entities.is_empty()


def test_fresh_ledger_is_empty() -> None:
    assert RetainedEntityLedger().is_empty()


def test_blank_value_after_sanitization_is_a_no_op() -> None:
    ledger = RetainedEntityLedger()

    ledger.record("search_nearby", "   \x00\x1f  ")

    assert ledger.is_empty()


def test_consumption_gate_retained_entity_reaches_trusted_prompt_context() -> None:
    """Named consumption point: a retained entity's live value must appear in
    the actual rendered prompt, or this ledger would be dead scaffolding."""
    from agent.agents.animichi_agent import trusted_session_context

    session = SessionState()
    session.compaction_retained_entities.record("search_nearby", "資生堂前")

    context = trusted_session_context(_ctx(session).deps)

    assert "資生堂前" in context
    assert "Verbatim entity retained from an earlier search_nearby call" in context
