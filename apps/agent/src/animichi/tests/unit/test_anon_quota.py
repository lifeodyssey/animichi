"""Per-identity anonymous daily message quota read (issue #282, S1.10, TURN-3).

The admission verdict is a pure read since TURN-3 #951: the count is
incremented exactly once at terminal settlement by TurnOutcome, never at
admission. These tests pin the read semantics and the fail-open contract.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time

from sqlalchemy.exc import StatementError

from animichi.infrastructure.persistence.repositories.anon_quota import (
    SQLModelAnonQuotaRepository,
)
from animichi.interfaces.anon_quota import anonymous_quota_verdict, next_utc_midnight
from animichi.tests.unit.repositories._session_fake import RecordingSessionFactory

TODAY = date(2026, 7, 26)
ANON_ID = "anon_0123456789abcdef0123456789abcdef"


class _AnonQuotaRepoDouble:
    """Serves a fixed per-(usage_date, anon_id) count and records reads."""

    def __init__(self, count: int = 0) -> None:
        self.count = count
        self.calls: list[tuple[date, str]] = []

    async def count_for(self, *, usage_date: date, anon_id: str) -> int:
        self.calls.append((usage_date, anon_id))
        return self.count

    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int:
        del usage_date, anon_id
        self.count += 1
        return self.count


class _FailingRepo(_AnonQuotaRepoDouble):
    async def count_for(self, *, usage_date: date, anon_id: str) -> int:
        del usage_date, anon_id
        raise OSError("counter unavailable")


class _SqlFailingRepo(_AnonQuotaRepoDouble):
    """SQLAlchemy's statement errors derive straight from Exception, not
    from OSError — the same fail-open shape the asyncpg errors had."""

    async def count_for(self, *, usage_date: date, anon_id: str) -> int:
        del usage_date, anon_id
        raise StatementError(
            'relation "anon_daily_message_count" does not exist', None, None
        )


async def test_a_fresh_identity_reads_at_zero_and_passes() -> None:
    verdict = await anonymous_quota_verdict(
        _AnonQuotaRepoDouble(count=0), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.is_exhausted is False
    assert verdict.count == 0


async def test_the_nth_message_within_quota_passes() -> None:
    verdict = await anonymous_quota_verdict(
        _AnonQuotaRepoDouble(count=2), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.is_exhausted is False
    assert verdict.count == 2


async def test_the_quota_boundary_count_is_rejected() -> None:
    verdict = await anonymous_quota_verdict(
        _AnonQuotaRepoDouble(count=3), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.is_exhausted is True
    assert verdict.count == 3


async def test_the_rejection_carries_the_next_utc_reset_instant() -> None:
    verdict = await anonymous_quota_verdict(
        _AnonQuotaRepoDouble(count=3), anon_id=ANON_ID, quota=3, today=TODAY
    )
    expected = datetime.combine(date(2026, 7, 27), time.min, tzinfo=UTC)
    assert verdict.resets_at == next_utc_midnight(TODAY) == expected


async def test_the_read_is_keyed_per_identity_and_day() -> None:
    repo = _AnonQuotaRepoDouble(count=1)
    await anonymous_quota_verdict(repo, anon_id=ANON_ID, quota=3, today=TODAY)
    assert repo.calls == [(TODAY, ANON_ID)]


async def test_an_unconfigured_quota_never_reads_the_repo() -> None:
    repo = _AnonQuotaRepoDouble(count=99)
    verdict = await anonymous_quota_verdict(repo, anon_id=ANON_ID, quota=0, today=TODAY)
    assert verdict.is_exhausted is False
    assert repo.calls == []


async def test_a_malformed_anon_id_never_reads_the_repo() -> None:
    repo = _AnonQuotaRepoDouble(count=99)
    verdict = await anonymous_quota_verdict(
        repo, anon_id="not-an-anon-id", quota=3, today=TODAY
    )
    assert verdict.is_exhausted is False
    assert repo.calls == []


async def test_quota_verdict_is_inert_without_an_anon_quota_repo() -> None:
    verdict = await anonymous_quota_verdict(None, anon_id=ANON_ID, quota=3, today=TODAY)
    assert verdict.is_exhausted is False


async def test_a_counter_read_failure_fails_open() -> None:
    verdict = await anonymous_quota_verdict(
        _FailingRepo(), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.is_exhausted is False


async def test_a_missing_counter_table_fails_open() -> None:
    verdict = await anonymous_quota_verdict(
        _SqlFailingRepo(), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.is_exhausted is False


async def test_count_for_missing_row_returns_zero() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(None)
    repo = SQLModelAnonQuotaRepository(factory)
    assert await repo.count_for(usage_date=date(2026, 8, 11), anon_id="anon-x") == 0
