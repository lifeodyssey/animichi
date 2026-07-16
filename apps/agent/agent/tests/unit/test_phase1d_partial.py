"""Phase 1d graceful-partial runner and projection contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import NoReturn, get_args
from unittest.mock import MagicMock

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelMessage
from pydantic_ai.usage import RunUsage

import agent.agents.animichi_runner as runner
from agent.agents.agent_result import ProducedRoute, ProducedSearch, StepRecord
from agent.agents.animichi_agent import RuntimeOutput
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import PartialResponseModel
from agent.agents.session_state import (
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
    SessionState,
)
from agent.interfaces.response_builder import _UI_MAP, agent_result_to_response
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _search_payload(point_id: str = "p1") -> SearchPayloadState:
    return SearchPayloadState(
        kind="bangumi",
        rows=[PointState(id=point_id, name="Bridge", bangumi_id="1")],
        row_count=1,
        anime_id="1",
    )


def _seed_current_search(deps: RuntimeDeps) -> None:
    ref = ResultRef("search:new")
    deps.tool_state.session.store_search_result(ref, _search_payload("new"))
    deps.steps.append(
        StepRecord(
            tool="search_bangumi",
            success=True,
            params={"bangumi_id": "1"},
            provenance=ProducedSearch(outcome="ok", result_ref=ref),
        )
    )


async def _usage_limit_run(*_args: object, **kwargs: object) -> NoReturn:
    deps = kwargs["deps"]
    usage = kwargs["usage"]
    assert isinstance(deps, RuntimeDeps)
    assert isinstance(usage, RunUsage)
    _seed_current_search(deps)
    usage.requests = 12
    raise UsageLimitExceeded("request limit reached")


async def _route_usage_limit_run(*_args: object, **kwargs: object) -> NoReturn:
    deps = kwargs["deps"]
    assert isinstance(deps, RuntimeDeps)
    ref = RouteRef("route:new")
    deps.tool_state.session.store_route(
        ref,
        RoutePayloadState(ordered_points=[PointState(id="new", bangumi_id="1")]),
    )
    deps.steps.append(
        StepRecord(
            "plan_route",
            True,
            provenance=ProducedRoute(status="ok", route_ref=ref),
        )
    )
    raise UsageLimitExceeded("request limit reached")


@dataclass(frozen=True)
class _PlainRunResult:
    usage: RunUsage
    output: str = "untyped output"

    def new_messages(self) -> list[ModelMessage]:
        return []


async def _plain_run(*_args: object, **kwargs: object) -> _PlainRunResult:
    usage = kwargs["usage"]
    assert isinstance(usage, RunUsage)
    usage.requests = 1
    return _PlainRunResult(usage)


def _install_run(monkeypatch: pytest.MonkeyPatch, run: object) -> None:
    monkeypatch.setattr(runner.animichi_agent, "run", run)


def test_partial_model_round_trips_without_joining_model_output_union() -> None:
    partial = PartialResponseModel(message="Partial results are shown.")
    restored = PartialResponseModel.model_validate_json(partial.model_dump_json())
    assert restored == partial
    assert PartialResponseModel not in get_args(RuntimeOutput)


def test_partial_model_maps_to_stable_stage_and_ui() -> None:
    output = PartialResponseModel(message="Partial results are shown.")
    assert runner.runtime_stage(output, []) == "partial"
    assert _UI_MAP["partial"] == "GeneralAnswer"


async def test_usage_limit_returns_partial_with_current_turn_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_run(monkeypatch, _usage_limit_run)
    result = await runner.run_animichi_agent(
        text="find it",
        db=MagicMock(),
        locale="zh",
        catalog=MockCatalogClient(),
    )
    response = agent_result_to_response(result, include_debug=False)
    assert isinstance(result.output, PartialResponseModel)
    assert (result.intent, result.success, result.status) == (
        "partial",
        False,
        "partial",
    )
    assert result.usage is not None and result.usage.requests == 12
    assert (response.success, response.status) == (False, "partial")
    assert response.data["results"]["rows"][0]["id"] == "new"
    assert response.ui == {"component": "GeneralAnswer"}
    assert "部分" in response.message


async def test_usage_limit_never_projects_stale_registry_ref(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = SessionState()
    state.store_search_result(ResultRef("search:old"), _search_payload("old"))
    _install_run(monkeypatch, _usage_limit_run)
    result = await runner.run_animichi_agent(
        text="new turn",
        db=MagicMock(),
        locale="en",
        context={"session_state_v2": state.model_dump(mode="json")},
        catalog=MockCatalogClient(),
    )
    response = agent_result_to_response(result, include_debug=False)
    assert result.session_state.last_result_ref == "search:new"
    assert result.provenance.search is not None
    rows = response.data["results"]["rows"]
    assert [row["id"] for row in rows] == ["new"]


async def test_usage_limit_projects_current_route_over_stale_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = SessionState()
    state.store_route(
        RouteRef("route:old"),
        RoutePayloadState(ordered_points=[PointState(id="old", bangumi_id="1")]),
    )
    _install_run(monkeypatch, _route_usage_limit_run)
    result = await runner.run_animichi_agent(
        text="new turn",
        db=MagicMock(),
        locale="en",
        context={"session_state_v2": state.model_dump(mode="json")},
        catalog=MockCatalogClient(),
    )
    response = agent_result_to_response(result, include_debug=False)
    assert response.data["route"]["ordered_points"][0]["id"] == "new"


async def test_plain_string_output_uses_same_graceful_partial_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_run(monkeypatch, _plain_run)
    result = await runner.run_animichi_agent(
        text="hello",
        db=MagicMock(),
        locale="ja",
        catalog=MockCatalogClient(),
    )
    assert isinstance(result.output, PartialResponseModel)
    assert (result.intent, result.success, result.status) == (
        "partial",
        False,
        "partial",
    )
    assert result.session_state == SessionState()


def test_partial_message_unknown_locale_defaults_to_japanese() -> None:
    assert runner._partial_message("fr") == runner._partial_message("ja")
