"""Boundary pins for the deterministic T1-T6 selection matrix."""

import httpx

from agent.agents.runtime_deps import StepEvent
from agent.agents.selection import execute_multi_selection
from agent.clients.catalog_client import SearchResult
from agent.interfaces.response_builder import agent_result_to_response
from agent.tests.unit.test_phase1c_selection_handlers import _Catalog, _pending, _point


async def test_500_points_routes_but_501_does_not() -> None:
    five_hundred = [_point(str(index), "1") for index in range(500)]
    catalog = _Catalog({"1": SearchResult(rows=five_hundred)})
    routed = await execute_multi_selection(
        candidate_ids=["1"], state=_pending(), locale="en", catalog=catalog
    )
    assert routed.success is True
    assert len(routed.session_state.routes) == 1
    catalog = _Catalog({"1": SearchResult(rows=five_hundred + [_point("500", "1")])})
    rejected = await execute_multi_selection(
        candidate_ids=["1"], state=_pending(), locale="en", catalog=catalog
    )
    assert (rejected.status, rejected.success) == ("too_large", False)
    assert not rejected.session_state.routes


async def test_50_cluster_success_and_typed_51_cluster_rejection() -> None:
    catalog = _Catalog({"1": SearchResult(rows=[_point("a", "1")])})
    routed = await execute_multi_selection(
        candidate_ids=["1"], state=_pending(), locale="en", catalog=catalog
    )
    assert routed.success is True  # catalog accepted its at-cap clustered fixture
    catalog = _Catalog({"1": SearchResult(rows=[_point("a", "1")])})
    catalog.route_error = True
    rejected = await execute_multi_selection(
        candidate_ids=["1"], state=_pending(), locale="en", catalog=catalog
    )
    assert (rejected.status, rejected.success) == ("too_large", False)
    assert rejected.session_state.pending_clarification is not None


async def test_mixed_empty_t2_routes_and_names_omission_without_ingest() -> None:
    catalog = _Catalog(
        {"1": SearchResult(), "2": SearchResult(rows=[_point("b", "2")])}
    )
    result = await execute_multi_selection(
        candidate_ids=["1", "2"], state=_pending(), locale="en", catalog=catalog
    )
    payload = result.session_state.search_results[result.session_state.last_result_ref]
    assert (result.success, payload.omitted_work_ids, payload.partial) == (
        True,
        ["1"],
        True,
    )
    assert "One" in result.message
    assert all(call[0] != "ingest" for call in catalog.calls)


async def test_mixed_failed_t3_routes_contributors_and_marks_partial() -> None:
    catalog = _Catalog(
        {"1": OSError("down"), "2": SearchResult(rows=[_point("b", "2")])}
    )
    result = await execute_multi_selection(
        candidate_ids=["1", "2"], state=_pending(), locale="en", catalog=catalog
    )
    payload = result.session_state.search_results[result.session_state.last_result_ref]
    assert (result.success, payload.omitted_work_ids, payload.partial) == (
        True,
        ["1"],
        True,
    )
    assert result.session_state.pending_clarification is None


async def test_t4_wire_has_results_without_route_and_same_revision_can_retry() -> None:
    state = _pending()
    catalog = _Catalog(
        {"1": SearchResult(), "2": SearchResult(rows=[_point("b", "2")])}
    )
    empty = await execute_multi_selection(
        candidate_ids=["1"], state=state, locale="en", catalog=catalog
    )
    empty_ref = state.last_result_ref
    wire = agent_result_to_response(empty, include_debug=False)
    assert "results" in wire.data and "route" not in wire.data
    assert state.pending_clarification is not None
    assert state.pending_clarification.revision == 4
    retried = await execute_multi_selection(
        candidate_ids=["2"], state=state, locale="en", catalog=catalog
    )
    assert retried.success is True
    assert state.pending_clarification is None
    assert len(state.search_results) == 2
    assert state.search_results[empty_ref].row_count == 0


async def test_t5_preserves_pending_and_writes_no_registry_refs() -> None:
    state = _pending()
    result = await execute_multi_selection(
        candidate_ids=["1", "2"],
        state=state,
        locale="en",
        catalog=_Catalog({"1": OSError("x"), "2": OSError("y")}),
    )
    assert (result.status, result.success) == ("error", False)
    assert state.pending_clarification is not None
    assert not state.search_results and not state.routes


async def test_route_transport_failure_is_typed_and_preserves_pending() -> None:
    state = _pending()
    catalog = _Catalog({"1": SearchResult(rows=[_point("a", "1")])})
    catalog.route_error = httpx.ConnectError("down")
    result = await execute_multi_selection(
        candidate_ids=["1"], state=state, locale="en", catalog=catalog
    )
    assert (result.status, result.success) == ("error", False)
    assert state.pending_clarification is not None


async def test_selection_emits_typed_running_and_done_events() -> None:
    events: list[StepEvent] = []

    async def on_step(event: StepEvent) -> None:
        events.append(event)

    await execute_multi_selection(
        candidate_ids=["1"],
        state=_pending(),
        locale="en",
        catalog=_Catalog({"1": SearchResult(rows=[_point("a", "1")])}),
        on_step=on_step,
    )
    assert [(event.tool, event.status) for event in events] == [
        ("plan_multi", "running"),
        ("plan_multi", "done"),
    ]
