"""Complete output-validator trust-boundary pins."""

from unittest.mock import MagicMock

import pytest
from pydantic_ai import ModelRetry

from agent.agents.agent_result import RejectedSearch, StepRecord
from agent.agents.animichi_agent import validate_output
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
    SessionState,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _context(state: SessionState, steps: list[StepRecord]) -> MagicMock:
    deps = RuntimeDeps(
        db=MagicMock(), locale="en", query="test", catalog=MockCatalogClient()
    )
    deps.tool_state.session = state
    deps.steps = steps
    return MagicMock(deps=deps)


@pytest.mark.parametrize(
    ("output", "state", "steps"),
    [
        (
            SearchResponseModel(message="x"),
            SessionState(),
            [StepRecord("search_bangumi", True)],
        ),
        (
            SearchResponseModel(message="x"),
            SessionState.model_validate(
                {
                    "search_results": {"search:1": {"kind": "bangumi", "row_count": 0}},
                    "last_result_ref": "search:1",
                }
            ),
            [],
        ),
        (
            RouteResponseModel(message="x"),
            SessionState(),
            [StepRecord("plan_route", True)],
        ),
        (
            RouteResponseModel(message="x"),
            SessionState(
                routes={RouteRef("route:1"): RoutePayloadState()},
                route_lru=[RouteRef("route:1")],
            ),
            [],
        ),
    ],
)
async def test_search_and_route_reject_step_or_registry_fabrication(
    output: SearchResponseModel | RouteResponseModel,
    state: SessionState,
    steps: list[StepRecord],
) -> None:
    with pytest.raises(ModelRetry):
        await validate_output(_context(state, steps), output)


@pytest.mark.parametrize(
    "reason",
    ["anime_not_found", "place_too_broad", "unknown_place", "missing_location"],
)
async def test_no_candidate_clarify_reasons_require_exact_empty_ids(
    reason: str,
) -> None:
    pending = PendingClarification.model_validate(
        {"reason": reason, "candidate_ids": [], "revision": 2}
    )
    state = SessionState(pending_clarification=pending, clarification_revision=2)
    output = ClarifyResponseModel.model_validate(
        {"reason": reason, "message": "Please clarify.", "candidate_ids": []}
    )
    assert await validate_output(_context(state, []), output) is output


async def test_place_ambiguity_accepts_exact_ordered_candidate_ids() -> None:
    pending = PendingClarification(
        reason="place_ambiguity", candidate_ids=["uji", "uji-city"], revision=2
    )
    state = SessionState(pending_clarification=pending, clarification_revision=2)
    output = ClarifyResponseModel(
        reason="place_ambiguity",
        message="Which place?",
        candidate_ids=["uji", "uji-city"],
    )
    assert await validate_output(_context(state, []), output) is output


async def test_place_ambiguity_cannot_authorize_search_from_a_prior_turn() -> None:
    prior_ref = ResultRef("search:prior:1")
    pending = PendingClarification(
        reason="place_ambiguity",
        candidate_ids=["uji-city", "uji-station"],
        ordered_candidates=[
            OrderedCandidate(id="uji-city", title="Uji City"),
            OrderedCandidate(id="uji-station", title="Uji Station"),
        ],
        revision=3,
    )
    state = SessionState(
        search_results={prior_ref: SearchPayloadState(kind="nearby")},
        search_result_lru=[prior_ref],
        last_result_ref=prior_ref,
        pending_clarification=pending,
        clarification_revision=3,
    )
    steps = [
        StepRecord(
            "search_nearby",
            False,
            data={"outcome": "place_ambiguity"},
            provenance=RejectedSearch(outcome="place_ambiguity"),
        )
    ]

    with pytest.raises(ModelRetry):
        await validate_output(_context(state, steps), SearchResponseModel(message="x"))

    assert state.pending_clarification == pending
