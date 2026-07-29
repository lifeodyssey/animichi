"""Cross-language tests for the Python response builder -> strict Zod seam."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from agent.agents.agent_result import AgentResult
from agent.agents.runtime_models import BlockedResponseModel, PartialResponseModel
from agent.agents.session_state import (
    NearbyGroupState,
    OrderedCandidate,
    RouteSummaryState,
    SearchMetadataState,
    SessionState,
)
from agent.interfaces.chat_wire import chat_response_wire
from agent.interfaces.response_builder import agent_result_to_response
from agent.interfaces.schemas import JsonObject, PublicAPIResponse
from agent.tests.unit.conftest_public_api import make_result

_UNIT_DIR = Path(__file__).parent
_INTENTS = (
    "search_bangumi",
    "search_nearby",
    "plan_route",
    "plan_selected",
    "plan_multi",
    "general_qa",
    "greet_user",
    "clarify",
    "partial",
    "blocked",
    "unknown",
    "error",
)


def _terminal_result(intent: str) -> AgentResult:
    return AgentResult(
        output=_terminal_output(intent),
        intent=intent,
        session_state=SessionState(),
        status=intent,
        success_override=False,
    )


def _terminal_output(intent: str) -> PartialResponseModel | BlockedResponseModel:
    output = (
        PartialResponseModel(message="partial")
        if intent == "partial"
        else BlockedResponseModel(message="blocked")
    )
    return output


def _response(intent: str) -> PublicAPIResponse:
    if intent in {"partial", "blocked"}:
        return agent_result_to_response(_terminal_result(intent), include_debug=False)
    if intent == "error":
        return PublicAPIResponse(success=False, status="timeout", intent="error")
    result = _rich_result("general_qa" if intent == "unknown" else intent)
    response = agent_result_to_response(result, include_debug=False)
    response.intent = intent
    return response


def _rich_result(intent: str) -> AgentResult:
    result = make_result(intent, data=_payload(intent))
    _enrich_search(result)
    _enrich_route(result)
    _enrich_clarification(result)
    return result


def _payload(intent: str) -> JsonObject:
    point: JsonObject = {"id": "p1", "name": "Bridge", "bangumi_id": "1"}
    if intent in {"search_bangumi", "search_nearby"}:
        return {"results": {"rows": [point], "row_count": 1}}
    if intent.startswith("plan_"):
        return {"route": {"ordered_points": [point]}}
    return {}


def _enrich_search(result: AgentResult) -> None:
    ref = result.session_state.last_result_ref
    if ref is None:
        return
    payload = result.session_state.search_results[ref]
    payload.metadata = SearchMetadataState(anime_title="Work", source="catalog")
    payload.nearby_groups = [NearbyGroupState(bangumi_id="1", title="Work")]
    payload.omitted_work_ids = ["2"]
    payload.partial = True


def _enrich_route(result: AgentResult) -> None:
    if not result.session_state.route_lru:
        return
    route = result.session_state.routes[result.session_state.route_lru[-1]]
    route.summary = _route_summary()


def _route_summary() -> RouteSummaryState:
    return RouteSummaryState(
        point_count=1,
        total_minutes=1,
        total_distance_m=1.0,
        clusters=1,
        with_coordinates=0,
        without_coordinates=1,
    )


def _enrich_clarification(result: AgentResult) -> None:
    pending = result.session_state.pending_clarification
    if pending is None:
        return
    pending.ordered_candidates = [_candidate()]


def _candidate() -> OrderedCandidate:
    return OrderedCandidate(
        id="1",
        title="Work",
        city="Kyoto",
        points_count=3,
        lat=35.0,
        lng=135.0,
        effective_radius_m=500,
    )


def _run_parser(input_text: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "--import", "tsx", "chat_wire_parser.ts"],
        cwd=_UNIT_DIR,
        input=input_text,
        text=True,
        capture_output=True,
    )


def _run_warmup() -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "--import", "tsx", "chat_wire_parser.ts", "--warm"],
        cwd=_UNIT_DIR,
        text=True,
        capture_output=True,
    )


def _require_success(result: subprocess.CompletedProcess[str], failure: str) -> None:
    if result.returncode:
        raise AssertionError(f"{failure}:\n{result.stderr.strip()}") from None


@pytest.fixture(scope="module", autouse=True)
def _warm_tsx_loader() -> None:
    _run_warmup()
    result = _run_warmup()
    _require_success(result, "tsx toolchain not ready after warm-up")


def _parse_with_zod(value: object) -> str:
    result = _run_parser(json.dumps(value))
    _require_success(result, "wire contract violation")
    return result.stdout


@pytest.mark.parametrize("intent", _INTENTS)
def test_real_response_builder_wire_parses_in_zod(intent: str) -> None:
    wire = chat_response_wire(_response(intent))
    assert _parse_with_zod(wire) == intent
