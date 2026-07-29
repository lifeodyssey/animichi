"""Photo-search telemetry (SD-22/23 five signals) and per-use quota (D6)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Literal, NewType

import logfire
from pydantic import BaseModel

from agent.agents.vision_supply_router import QuotaTier

QueryType = Literal["anime_screenshot", "real_world_photo", "vision_unavailable"]
# The client-submitted confirm signal (anonymous-reachable) may only claim to
# have seen a real search outcome — never "vision_unavailable" (#502 review
# round 2): that value backs an ops alert, and there is never a candidate
# list to confirm on that outcome. Keeping the client type narrower prevents
# an anonymous caller from injecting fake events into that alert source.
ClientQueryType = Literal["anime_screenshot", "real_world_photo"]
LayerHit = Literal["1", "2", "none"]
QuotaKey = NewType("QuotaKey", str)
Clock = Callable[[], datetime]

_photo_searches = logfire.metric_counter(
    "photo_search_total",
    description="Photo searches recorded with the five SD-22/23 signals.",
)


class PhotoSearchSignals(BaseModel):
    """The five per-search telemetry signals (SD-22/23)."""

    query_type: QueryType
    gps_available: bool
    layer_hit: LayerHit
    candidates_shown: int
    user_confirmed: bool


def record_photo_search(signals: PhotoSearchSignals) -> None:
    """Emit one photo-search event carrying all five signals."""
    _photo_searches.add(
        1,
        {
            "query_type": signals.query_type,
            "gps_available": signals.gps_available,
            "layer_hit": signals.layer_hit,
            "candidates_shown": signals.candidates_shown,
            "user_confirmed": signals.user_confirmed,
        },
    )


class PhotoSearchQuota:
    """Per-day, per-tier photo-search counter, separate from the message quota.

    Exact limits are an operations decision (issue #260: values are explicitly
    not fixed by this story); ``None`` means the cap is not yet configured and
    consumption is unmetered.

    In-process only: counters reset on restart and are not shared across
    container instances, so the cap is best-effort. Shared storage must land
    before ops sets real limits (#446); past-day slots are also never pruned.
    """

    def __init__(self, clock: Clock) -> None:
        self._clock = clock
        self._used: dict[tuple[QuotaTier, QuotaKey, str], int] = {}

    def consume(self, tier: QuotaTier, key: QuotaKey, limit: int | None) -> bool:
        if limit is None:
            return True
        slot = (tier, key, self._clock().date().isoformat())
        used = self._used.get(slot, 0)
        if used >= limit:
            return False
        self._used[slot] = used + 1
        return True
