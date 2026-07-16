"""Deterministic candidate-selection handlers that bypass the model."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import httpx

from agent.agents.agent_result import (
    AgentResult,
    ProducedRoute,
    ProducedSearch,
    StepProvenance,
    StepRecord,
    TurnProvenance,
)
from agent.agents.catalog_adapter import build_route_state, build_search_state
from agent.agents.geo_names import localized_city_name
from agent.agents.runtime_deps import OnStep, StepEvent
from agent.agents.runtime_models import RouteResponseModel, SearchResponseModel
from agent.agents.selection_messages import PLACE_MESSAGES, multi_message
from agent.agents.session_state import (
    CurrentAnime,
    PointState,
    SearchPayloadState,
    SessionState,
)
from agent.clients.catalog_client import CatalogClientProtocol, SearchResult
from agent.clients.catalog_errors import (
    RouteTooManyClustersError,
    RouteTooManyPointsError,
)
from agent.clients.errors import APIError

MAX_ROUTE_POINT_IDS = 500
_FETCH_ERRORS = (
    APIError,
    httpx.TransportError,
    httpx.TimeoutException,
    OSError,
    RuntimeError,
    ValueError,
)


class SelectionError(ValueError):
    """A stale or invalid candidate selection."""


@dataclass(frozen=True)
class ValidatedSelection:
    candidate_ids: list[str]
    reason: str


def normalize_candidate_ids(candidate_ids: list[str]) -> list[str]:
    """Trim and first-occurrence-dedupe candidate IDs."""
    return list(dict.fromkeys(value for raw in candidate_ids if (value := raw.strip())))


def validate_candidate_selection(
    state: SessionState,
    candidate_ids: list[str],
    clarification_id: int,
) -> ValidatedSelection:
    """Validate membership, revision, reason, and normalized cardinality."""
    pending = state.pending_clarification
    normalized = normalize_candidate_ids(candidate_ids)
    if pending is None or clarification_id != pending.revision:
        raise SelectionError("This choice expired; please try again.")
    if not normalized or any(item not in pending.candidate_ids for item in normalized):
        raise SelectionError("This choice expired; please try again.")
    if pending.reason == "anime_ambiguity":
        return ValidatedSelection(normalized, pending.reason)
    if pending.reason == "place_ambiguity" and len(normalized) == 1:
        return ValidatedSelection(normalized, pending.reason)
    raise SelectionError("This clarification requires a different response mode.")


async def execute_multi_selection(
    *,
    candidate_ids: list[str],
    state: SessionState,
    locale: str,
    catalog: CatalogClientProtocol,
    on_step: OnStep | None = None,
) -> AgentResult:
    """Fetch selected works in parallel, merge deterministically, then route."""
    await _emit(on_step, "plan_multi", "running", {})
    fetched = await asyncio.gather(
        *(catalog.points_by_work_id(item) for item in candidate_ids),
        return_exceptions=True,
    )
    steps = _fetch_steps(candidate_ids, fetched)
    successful = _successful_results(candidate_ids, fetched)
    if not successful:
        return await _multi_terminal_event(state, steps, locale, "error", on_step)
    merged = _merge_results(candidate_ids, successful, locale)
    result_ref = state.next_search_ref("multi", state.clarification_revision)
    state.store_search_result(result_ref, merged)
    if not merged.rows:
        status = "error" if len(successful) < len(candidate_ids) else "empty"
        provenance = ProducedSearch(outcome="empty", result_ref=result_ref)
        return await _multi_terminal_event(
            state, steps, locale, status, on_step, search=provenance
        )
    if len(merged.rows) > MAX_ROUTE_POINT_IDS:
        provenance = ProducedSearch(outcome="ok", result_ref=result_ref)
        return await _multi_terminal_event(
            state, steps, locale, "too_large", on_step, search=provenance
        )
    try:
        route = await catalog.route([point.id for point in merged.rows if point.id])
    except (RouteTooManyClustersError, RouteTooManyPointsError):
        provenance = ProducedSearch(outcome="ok", result_ref=result_ref)
        return await _multi_terminal_event(
            state, steps, locale, "too_large", on_step, search=provenance
        )
    except _FETCH_ERRORS:
        provenance = ProducedSearch(outcome="ok", result_ref=result_ref)
        return await _multi_terminal_event(
            state, steps, locale, "error", on_step, search=provenance
        )
    if route.point_count < 1:
        provenance = ProducedSearch(outcome="ok", result_ref=result_ref)
        return await _multi_terminal_event(
            state, steps, locale, "error", on_step, search=provenance
        )
    route_ref = state.next_route_ref("multi", state.clarification_revision)
    state.store_route(route_ref, build_route_state(route, result_ref, locale=locale))
    _set_current_anime(state, candidate_ids)
    omitted = _omitted_titles(state, merged.omitted_work_ids)
    _consume_pending(state)
    steps.append(_server_step("plan_multi", True, {"route_ref": str(route_ref)}))
    await _emit(on_step, "plan_multi", "done", {"route_ref": str(route_ref)})
    return AgentResult(
        output=RouteResponseModel(message=multi_message(locale, "ok", omitted)),
        intent="plan_multi",
        session_state=state,
        steps=steps,
        success_override=True,
        provenance=TurnProvenance(
            search=ProducedSearch(outcome="ok", result_ref=result_ref),
            route=ProducedRoute(status="ok", route_ref=route_ref),
        ),
    )


def _successful_results(
    ids: list[str], fetched: list[SearchResult | BaseException]
) -> list[tuple[str, SearchResult]]:
    return [
        (item, result)
        for item, result in zip(ids, fetched, strict=True)
        if isinstance(result, SearchResult)
    ]


def _fetch_steps(
    ids: list[str], fetched: list[SearchResult | BaseException]
) -> list[StepRecord]:
    return [
        _server_step(
            "search_bangumi",
            isinstance(result, SearchResult),
            {"bangumi_id": item},
        )
        for item, result in zip(ids, fetched, strict=True)
    ]


def _server_step(
    tool: str,
    success: bool,
    data: dict[str, object],
    provenance: StepProvenance | None = None,
) -> StepRecord:
    return StepRecord(
        tool=tool,
        success=success,
        params=data,
        data=data,
        provenance=provenance,
        error=None if success else "Catalog fetch failed",
        model_initiated=False,
    )


def _merge_results(
    selected: list[str], results: list[tuple[str, SearchResult]], locale: str
) -> SearchPayloadState:
    seen: set[str] = set()
    rows: list[PointState] = []
    omitted = [item for item in selected if not _contributed(item, results)]
    for _, result in results:
        for point in result.rows:
            if point.id not in seen:
                seen.add(point.id)
                city = localized_city_name(point.city, locale) if point.city else None
                rows.append(
                    PointState.model_validate(
                        point.model_copy(update={"city": city}).model_dump(mode="json")
                    )
                )
    return SearchPayloadState(
        kind="multi",
        rows=rows,
        row_count=len(rows),
        anime_ids=selected,
        omitted_work_ids=omitted or None,
        partial=any(result.partial for _, result in results) or bool(omitted),
    )


def _contributed(item: str, results: list[tuple[str, SearchResult]]) -> bool:
    return any(work_id == item and result.rows for work_id, result in results)


def _omitted_titles(state: SessionState, omitted: list[str] | None) -> list[str]:
    pending = state.pending_clarification
    if not omitted or pending is None:
        return omitted or []
    titles = {item.id: item.title for item in pending.ordered_candidates}
    return [titles.get(item, item) for item in omitted]


def _set_current_anime(state: SessionState, ids: list[str]) -> None:
    if len(ids) != 1:
        state.current_anime = None
        return
    pending = state.pending_clarification
    candidate = (
        next(
            (item for item in pending.ordered_candidates if item.id == ids[0]),
            None,
        )
        if pending
        else None
    )
    title = candidate.title if candidate is not None else ids[0]
    state.current_anime = CurrentAnime(bangumi_id=ids[0], title=title)


def _multi_terminal(
    state: SessionState,
    steps: list[StepRecord],
    locale: str,
    status: str,
    search: ProducedSearch | None = None,
) -> AgentResult:
    expected = status in {"empty", "too_large"}
    steps.append(_server_step("plan_multi", expected, {"status": status}))
    return AgentResult(
        output=RouteResponseModel(message=multi_message(locale, status)),
        intent="plan_multi",
        session_state=state,
        steps=steps,
        status=status,
        success_override=False,
        provenance=TurnProvenance(search=search),
    )


async def _multi_terminal_event(
    state: SessionState,
    steps: list[StepRecord],
    locale: str,
    status: str,
    on_step: OnStep | None,
    search: ProducedSearch | None = None,
) -> AgentResult:
    result = _multi_terminal(state, steps, locale, status, search)
    await _emit(on_step, "plan_multi", "done", {"status": status})
    return result


def _consume_pending(state: SessionState) -> None:
    state.pending_clarification = None
    state.geocode_staging = None
    state.clarification_revision += 1


async def execute_place_selection(
    *,
    candidate_id: str,
    state: SessionState,
    locale: str,
    catalog: CatalogClientProtocol,
    on_step: OnStep | None = None,
) -> AgentResult:
    """Consume staged place coordinates without re-geocoding."""
    await _emit(on_step, "search_nearby", "running", {})
    pending = state.pending_clarification
    candidate = (
        next(
            (item for item in pending.ordered_candidates if item.id == candidate_id),
            None,
        )
        if pending
        else None
    )
    if candidate is None or candidate.lat is None or candidate.lng is None:
        raise SelectionError("This place choice expired; please try again.")
    try:
        radius_m = candidate.effective_radius_m or 5_000
        points = await catalog.nearby(candidate.lat, candidate.lng, radius_m=radius_m)
    except _FETCH_ERRORS:
        result = _place_error(state, locale)
        await _emit(on_step, "search_nearby", "done", {"status": "error"})
        return result
    payload = build_search_state(points, kind="nearby", locale=locale)
    ref = state.next_search_ref("place", state.clarification_revision)
    state.store_search_result(ref, payload)
    _consume_pending(state)
    provenance = ProducedSearch(
        outcome="ok" if payload.row_count else "empty", result_ref=ref
    )
    step = _server_step("search_nearby", True, {"result_ref": str(ref)}, provenance)
    await _emit(on_step, "search_nearby", "done", {"result_ref": str(ref)})
    status = "ok" if payload.row_count else "empty"
    return AgentResult(
        output=SearchResponseModel(message=PLACE_MESSAGES[locale][status]),
        intent="search_nearby",
        session_state=state,
        steps=[step],
    )


def _place_error(state: SessionState, locale: str) -> AgentResult:
    return AgentResult(
        output=SearchResponseModel(message=PLACE_MESSAGES[locale]["error"]),
        intent="search_nearby",
        session_state=state,
        steps=[_server_step("search_nearby", False, {"status": "error"})],
        status="error",
        success_override=False,
    )


async def _emit(
    on_step: OnStep | None, tool: str, status: str, data: dict[str, object]
) -> None:
    if on_step is not None:
        await on_step(StepEvent(tool=tool, status=status, data=data))
