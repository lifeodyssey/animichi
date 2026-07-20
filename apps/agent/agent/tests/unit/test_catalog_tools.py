"""Unit tests for the catalog-result store pipeline in catalog_tools.

tool_state must keep storing plain dict[str, object] (unchanged consumers in
response_builder.py / chat.py), while the tool function itself now returns
the named model instance to the caller.
"""

from __future__ import annotations

from agent.agents.catalog_tools import _store_catalog_result
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import PilgrimagePointModel
from agent.agents.tool_results import ResolveAnimeResult, SearchToolResult
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _deps() -> RuntimeDeps:
    return RuntimeDeps(db=object(), locale="ja", query="q", catalog=MockCatalogClient())


def _row(name: str) -> PilgrimagePointModel:
    return PilgrimagePointModel(id=name, name=name, latitude=1.0, longitude=1.0)


async def test_store_catalog_result_stores_dict_shape_in_tool_state() -> None:
    deps = _deps()
    payload = SearchToolResult(rows=[_row("a")], row_count=1)
    await _store_catalog_result(
        deps, tool=ToolName.SEARCH_BANGUMI, params={}, payload=payload, success=True
    )
    stored = deps.tool_state["search_bangumi"]
    assert isinstance(stored, dict)
    assert stored["row_count"] == 1


async def test_store_catalog_result_returns_typed_payload_unchanged() -> None:
    deps = _deps()
    payload = SearchToolResult(rows=[_row("a")], row_count=1)
    result = await _store_catalog_result(
        deps, tool=ToolName.SEARCH_BANGUMI, params={}, payload=payload, success=True
    )
    assert result is payload


async def test_store_catalog_result_failure_returns_none() -> None:
    deps = _deps()
    result = await _store_catalog_result(
        deps,
        tool=ToolName.RESOLVE_ANIME,
        params={},
        payload=ResolveAnimeResult(),
        success=False,
    )
    assert result is None


async def test_store_catalog_result_failure_does_not_populate_tool_state() -> None:
    deps = _deps()
    await _store_catalog_result(
        deps,
        tool=ToolName.RESOLVE_ANIME,
        params={},
        payload=ResolveAnimeResult(),
        success=False,
    )
    assert "resolve_anime" not in deps.tool_state


async def test_store_catalog_result_records_failed_step() -> None:
    deps = _deps()
    await _store_catalog_result(
        deps,
        tool=ToolName.RESOLVE_ANIME,
        params={},
        payload=ResolveAnimeResult(),
        success=False,
    )
    assert deps.steps[-1].success is False
