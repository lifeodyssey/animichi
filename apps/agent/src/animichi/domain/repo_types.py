"""Shared, concrete row and JSONB shapes for the SQLModel persistence seam (#992).

The repository and port layers must not traffic in the unbounded
``dict[str, object]`` annotation (root AGENTS.md + `.claude/rules/python-types.md`).
These TypedDicts model the actual keys each repository query projects and the
JSONB envelopes (``state``/``metadata``/``response_data``) carry. They are
runtime-identical to dicts (so existing ``.get()`` consumers keep working) but
give mypy a concrete key shape — the repository uses TypedDict as the permitted
fallback for rows that do not map 1:1 onto an existing SQLModel class
("must be modelled, or at least a TypedDict").
"""

from __future__ import annotations

# typing.TypedDict is rejected by pydantic 2.13 on Python <3.12 (CI runs 3.11);
# typing_extensions is a guaranteed transitive dependency.
from typing_extensions import TypedDict


class PointRow(TypedDict, total=False):
    """A published pilgrim point (full ``points`` row, ``get_points_by_*``)."""

    id: str
    bangumi_id: str | None
    name: str
    name_cn: str | None
    latitude: float
    longitude: float
    location: object
    image: str | None
    episode: int | None
    time_seconds: int
    scene_desc: str | None
    origin: str | None
    origin_url: str | None
    city: str | None
    created_at: object
    updated_at: object


class NearbyPointRow(TypedDict, total=False):
    """One proximity-search point with its screenshot, distance, and title."""

    id: str
    bangumi_id: str | None
    name: str
    name_cn: str | None
    episode: int | None
    time_seconds: int
    screenshot_url: object
    origin: str | None
    latitude: float
    longitude: float
    distance_m: object
    title: object
    title_cn: object


class BangumiRow(TypedDict, total=False):
    """A bangumi master row (full ``bangumi`` row, ``get_bangumi``/``list_bangumi``)."""

    id: str
    title: str
    title_cn: str | None
    cover_url: str | None
    air_date: str | None
    summary: str | None
    eps_count: int | None
    rating: float | None
    points_count: int
    primary_color: str | None
    city: str | None
    platform: str | None
    created_at: object
    updated_at: object


class BangumiAreaRow(TypedDict, total=False):
    """One work with a point-count within a radius (``get_bangumi_by_area``)."""

    bangumi_id: str
    bangumi_title: str
    title_cn: str | None
    cover_url: str | None
    city: str | None
    points_count: int


class BangumiTitleRow(TypedDict, total=False):
    """One title-matched work with normalized display fields (``find_all_by_title``)."""

    id: str
    title: object
    title_cn: object
    cover_url: object
    city: object
    points_count: int


class BangumiCandidateRow(TypedDict, total=False):
    """One best match per requested title (``find_candidate_details_by_titles``)."""

    title: str
    bangumi_id: str | None
    cover_url: object
    city: object
    points_count: int


class SessionListRow(TypedDict, total=False):
    """Compact session summary row (``list_sessions``)."""

    session_id: str
    title: object
    first_query: object
    created_at: object
    updated_at: object


class FeedbackBadRow(TypedDict, total=False):
    """One unfavourable-feedback operator row (``fetch_bad_feedback``)."""

    id: str
    query_text: str
    intent: object
    comment: object
    created_at: object


class RequestLogUnscoredRow(TypedDict, total=False):
    """One awaiting-score request-log row (``fetch_request_log_unscored``)."""

    id: str
    query_text: str
    locale: str
    plan_steps: object
    intent: object


class SessionStateData(TypedDict, total=False):
    """Storage envelope persisted in ``sessions.state`` (open heterogeneous JSON).

    Normalized by ``interfaces.session_facade``; the typed runtime state rides
    the optional ``session_state_v2`` key.
    """

    interactions: list[object]
    route_history: list[object]
    last_intent: object
    last_status: object
    last_message: object
    summary: object
    updated_at: str
    session_state_v2: object


class SessionMetadata(TypedDict, total=False):
    """Session envelope metadata persisted in ``sessions.metadata``."""

    intent: object
    status: object
    updated_at: object


class ResponseData(TypedDict, total=False):
    """Assistant-message response payload persisted in ``messages.response_data``."""

    intent: str
    success: bool


__all__ = [
    "BangumiAreaRow",
    "BangumiCandidateRow",
    "BangumiRow",
    "BangumiTitleRow",
    "FeedbackBadRow",
    "NearbyPointRow",
    "PointRow",
    "RequestLogUnscoredRow",
    "ResponseData",
    "SessionListRow",
    "SessionMetadata",
    "SessionStateData",
]
