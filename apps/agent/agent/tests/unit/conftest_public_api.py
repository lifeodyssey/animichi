"""Shared typed AgentResult builders for public API tests."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    QAResponseModel,
    RouteResponseModel,
    RuntimeStageOutput,
    SearchResponseModel,
)
from agent.agents.session_state import (
    CurrentAnime,
    OrderedCandidate,
    PendingClarification,
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
    SessionState,
)


def _build_output(intent: str, message: str, state: SessionState) -> RuntimeStageOutput:
    if intent == "clarify":
        pending = state.pending_clarification
        reason = pending.reason if pending else "anime_not_found"
        ids = pending.candidate_ids if pending else []
        return ClarifyResponseModel(reason=reason, message=message, candidate_ids=ids)
    if intent in {"search_bangumi", "search_nearby"}:
        return SearchResponseModel(message=message)
    if intent in {"plan_route", "plan_selected", "plan_multi"}:
        return RouteResponseModel(message=message)
    return QAResponseModel(message=message)


def _rows(data: dict[str, object], key: str) -> list[PointState]:
    value = data.get(key)
    payload = value if isinstance(value, dict) else {}
    raw_rows = payload.get("rows") or payload.get("ordered_points")
    rows = raw_rows if isinstance(raw_rows, list) else []
    return [PointState.model_validate(row) for row in rows if isinstance(row, dict)]


def _state(
    intent: str, data: dict[str, object], steps: list[StepRecord]
) -> SessionState:
    state = SessionState(current_anime=_resolved_anime(steps))
    if intent == "clarify":
        _seed_pending(state, data)
    if intent in {"search_bangumi", "search_nearby"}:
        _seed_search(state, intent, _rows(data, "results"))
    if intent in {"plan_route", "plan_selected", "plan_multi"}:
        _seed_route(state, intent, _rows(data, "route"))
    return state


def _resolved_anime(steps: list[StepRecord]) -> CurrentAnime | None:
    for step in reversed(steps):
        data = step.data or {}
        bangumi_id = data.get("bangumi_id")
        title = data.get("title") or data.get("anime_title")
        if isinstance(bangumi_id, str) and isinstance(title, str):
            return CurrentAnime(bangumi_id=bangumi_id, title=title)
    return None


def _seed_pending(state: SessionState, data: dict[str, object]) -> None:
    raw_ids = data.get("candidate_ids")
    ids = (
        [item for item in raw_ids if isinstance(item, str)]
        if isinstance(raw_ids, list)
        else []
    )
    reason = data.get("reason")
    valid_reason = reason if isinstance(reason, str) else "anime_not_found"
    candidates = [OrderedCandidate(id=item, title=item) for item in ids]
    state.pending_clarification = PendingClarification.model_validate(
        {
            "reason": valid_reason,
            "candidate_ids": ids,
            "ordered_candidates": candidates,
            "revision": 1,
        }
    )
    state.clarification_revision = 1


def _seed_search(state: SessionState, intent: str, rows: list[PointState]) -> None:
    ref = ResultRef("search:test")
    state.store_search_result(
        ref,
        SearchPayloadState(
            kind="nearby" if intent == "search_nearby" else "bangumi",
            rows=rows,
            row_count=len(rows),
            anime_id=state.current_anime.bangumi_id if state.current_anime else None,
        ),
    )


def _seed_route(state: SessionState, intent: str, rows: list[PointState]) -> None:
    source_ref = ResultRef("search:test")
    if rows:
        state.store_search_result(
            source_ref,
            SearchPayloadState(
                kind="multi" if intent == "plan_multi" else "bangumi",
                rows=rows,
                row_count=len(rows),
                anime_id=rows[0].bangumi_id,
                anime_ids=list(
                    dict.fromkeys(row.bangumi_id for row in rows if row.bangumi_id)
                ),
            ),
        )
    state.store_route(
        RouteRef("route:test"),
        RoutePayloadState(ordered_points=rows, source_ref=source_ref if rows else None),
    )


def make_result(
    intent: str = "search_bangumi",
    locale: str = "ja",
    message: str = "該当する巡礼地が見つかりませんでした。",
    data: dict[str, object] | None = None,
    steps: list[StepRecord] | None = None,
    tool_state: dict[str, object] | None = None,
) -> AgentResult:
    """Build a compact output plus its authoritative typed registry."""
    del locale, tool_state
    payload = data or {"results": {"rows": [], "row_count": 0}}
    records = steps or []
    state = _state(intent, payload, records)
    return AgentResult(
        output=_build_output(intent, message, state),
        intent=intent,
        session_state=state,
        steps=records,
    )


def make_fake_agent(
    result_fn: Callable[..., AgentResult] | None = None,
) -> Callable[..., Awaitable[AgentResult]]:
    async def _fake(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        message_history: object | None = None,
        on_step: object | None = None,
        catalog: object | None = None,
    ) -> AgentResult:
        del text, db, model, context, message_history, on_step, catalog
        return (
            result_fn(locale=locale)
            if result_fn is not None
            else make_result(locale=locale)
        )

    return _fake


def install_mock_pipeline(monkeypatch: object) -> None:
    monkeypatch.setattr(
        "agent.interfaces.public_api.run_animichi_agent", make_fake_agent()
    )
