"""Partial catalog previews survive the typed tool and public projection."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast
from unittest.mock import MagicMock

from pydantic_ai import RunContext

from agent.agents.agent_result import AgentResult
from agent.agents.animichi_agent import _INSTRUCTIONS
from agent.agents.catalog_tools import run_work_search
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import SearchResponseModel
from agent.agents.tool_outcomes import SearchEmpty, SearchOk, SearchUpstreamDown
from agent.clients.catalog_client import PilgrimagePoint, SearchResult
from agent.clients.catalog_errors import (
    UpstreamUnavailableData,
    UpstreamUnavailableError,
)
from agent.interfaces.response_builder import agent_result_to_response
from agent.tests.eval.mock_catalog_client import MockCatalogClient


class _PartialCatalog(MockCatalogClient):
    async def points_by_work_id(self, work_id: str) -> SearchResult:
        return SearchResult(
            rows=[
                PilgrimagePoint(
                    id="p1",
                    name="Uji Bridge",
                    bangumi_id=work_id,
                    latitude=34.89,
                    longitude=135.8,
                )
            ],
            partial=True,
        )


@dataclass
class _Ctx:
    deps: RuntimeDeps


class _EmptyPartialCatalog(MockCatalogClient):
    async def points_by_work_id(self, work_id: str) -> SearchResult:
        return SearchResult(partial=True)


class _UpstreamDownCatalog(MockCatalogClient):
    async def points_by_work_id(self, work_id: str) -> SearchResult:
        raise UpstreamUnavailableError(UpstreamUnavailableData(upstream="anitabi"))


async def test_partial_search_result_flows_through_tool_state_and_wire() -> None:
    catalog = _PartialCatalog()
    deps = RuntimeDeps(MagicMock(), "zh", "search", catalog)
    ctx = cast(RunContext[RuntimeDeps], _Ctx(deps))

    outcome = await run_work_search(ctx, catalog, "115908")
    result = AgentResult(
        output=SearchResponseModel(message="Found preview points."),
        intent="search_bangumi",
        session_state=deps.tool_state.session,
        steps=deps.steps,
    )
    response = agent_result_to_response(result, include_debug=False)

    assert isinstance(outcome, SearchOk)
    payload = deps.tool_state.session.search_results[outcome.result_ref]
    assert (outcome.partial, payload.partial) == (True, True)
    results = response.data["results"]
    assert isinstance(results, dict)
    assert results["partial"] is True


async def test_empty_partial_search_is_projected_as_still_syncing() -> None:
    catalog = _EmptyPartialCatalog()
    deps = RuntimeDeps(MagicMock(), "en", "search", catalog)

    outcome = await run_work_search(
        cast(RunContext[RuntimeDeps], _Ctx(deps)), catalog, "115908"
    )
    result = AgentResult(
        output=SearchResponseModel(message="The catalog is still syncing."),
        intent="search_bangumi",
        session_state=deps.tool_state.session,
        steps=deps.steps,
    )
    response = agent_result_to_response(result, include_debug=False)

    assert isinstance(outcome, SearchEmpty)
    assert outcome.partial is True
    ref = deps.tool_state.session.last_result_ref
    assert (
        ref is not None and deps.tool_state.session.search_results[ref].partial is True
    )
    assert response.data["results"]["partial"] is True
    assert "do NOT assert the work has no pilgrimage points" in _INSTRUCTIONS


async def test_work_search_records_typed_upstream_down_without_a_registry_ref() -> None:
    catalog = _UpstreamDownCatalog()
    deps = RuntimeDeps(MagicMock(), "en", "search", catalog)

    outcome = await run_work_search(
        cast(RunContext[RuntimeDeps], _Ctx(deps)), catalog, "115908"
    )

    assert isinstance(outcome, SearchUpstreamDown)
    assert outcome.outcome == "upstream_unavailable"
    assert deps.steps[-1].data == {"outcome": "upstream_unavailable"}
    assert not deps.tool_state.session.search_results
