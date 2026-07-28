"""Unit tests for photo-search telemetry (five signals) and the D6 quota."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from agent.infrastructure.observability import photo_search as telemetry
from agent.infrastructure.observability.photo_search import (
    PhotoSearchQuota,
    PhotoSearchSignals,
    QuotaKey,
    record_photo_search,
)

_KEY = QuotaKey("user-1")


def _signals() -> PhotoSearchSignals:
    return PhotoSearchSignals(
        query_type="anime_screenshot",
        gps_available=True,
        layer_hit="2",
        candidates_shown=3,
        user_confirmed=False,
    )


def test_record_emits_all_five_signals(monkeypatch: pytest.MonkeyPatch) -> None:
    counter = MagicMock()
    monkeypatch.setattr(telemetry, "_photo_searches", counter)
    record_photo_search(_signals())
    counter.add.assert_called_once_with(
        1,
        {
            "query_type": "anime_screenshot",
            "gps_available": True,
            "layer_hit": "2",
            "candidates_shown": 3,
            "user_confirmed": False,
        },
    )


class FixedClock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def _quota(clock: FixedClock) -> PhotoSearchQuota:
    return PhotoSearchQuota(clock=clock)


def test_unconfigured_limit_is_unmetered() -> None:
    quota = _quota(FixedClock(datetime(2026, 7, 26, tzinfo=UTC)))
    assert quota.consume("anon", _KEY, None) is True
    assert quota.consume("anon", _KEY, None) is True


def test_limit_exhausts_within_the_same_day() -> None:
    quota = _quota(FixedClock(datetime(2026, 7, 26, tzinfo=UTC)))
    assert quota.consume("anon", _KEY, 2) is True
    assert quota.consume("anon", _KEY, 2) is True
    assert quota.consume("anon", _KEY, 2) is False


def test_tiers_and_keys_are_metered_separately() -> None:
    quota = _quota(FixedClock(datetime(2026, 7, 26, tzinfo=UTC)))
    assert quota.consume("anon", _KEY, 1) is True
    assert quota.consume("member", _KEY, 1) is True
    assert quota.consume("anon", QuotaKey("user-2"), 1) is True
    assert quota.consume("anon", _KEY, 1) is False


def test_quota_resets_at_the_next_day() -> None:
    clock = FixedClock(datetime(2026, 7, 26, 23, 59, tzinfo=UTC))
    quota = _quota(clock)
    assert quota.consume("anon", _KEY, 1) is True
    assert quota.consume("anon", _KEY, 1) is False
    clock.now = datetime(2026, 7, 27, 0, 1, tzinfo=UTC)
    assert quota.consume("anon", _KEY, 1) is True
