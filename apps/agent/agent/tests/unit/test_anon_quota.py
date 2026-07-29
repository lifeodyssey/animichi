"""Per-identity anonymous daily message quota (issue #282, S1.10)."""

from __future__ import annotations

from datetime import UTC, date, datetime

from asyncpg.exceptions import UndefinedTableError

from agent.interfaces.anon_quota import anonymous_quota_verdict, next_utc_midnight

TODAY = date(2026, 7, 26)
TOMORROW = date(2026, 7, 27)
ANON_ID = "anon_0123456789abcdef0123456789abcdef"


class _AnonQuotaRepoDouble:
    """Counts increments per (usage_date, anon_id), like the real UPSERT."""

    def __init__(self) -> None:
        self.counts: dict[tuple[date, str], int] = {}
        self.calls: list[tuple[date, str]] = []

    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int:
        self.calls.append((usage_date, anon_id))
        key = (usage_date, anon_id)
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]


class _FailingRepo(_AnonQuotaRepoDouble):
    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int:
        del usage_date, anon_id
        raise OSError("counter unavailable")


class _PgFailingRepo(_AnonQuotaRepoDouble):
    """asyncpg's errors derive straight from Exception, not from OSError."""

    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int:
        del usage_date, anon_id
        raise UndefinedTableError('relation "anon_daily_message_count" does not exist')


class _Db:
    def __init__(self, anon_quota: object) -> None:
        self.anon_quota = anon_quota


async def test_a_brand_new_identity_starts_at_full_quota_not_zero() -> None:
    """First-ever message for a fresh identity must not already read exhausted."""
    verdict = await anonymous_quota_verdict(
        _Db(_AnonQuotaRepoDouble()), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.exhausted is False
    assert verdict.count == 1


async def test_the_nth_message_within_quota_passes() -> None:
    repo = _AnonQuotaRepoDouble()
    db = _Db(repo)
    for _ in range(3):
        verdict = await anonymous_quota_verdict(
            db, anon_id=ANON_ID, quota=3, today=TODAY
        )
    assert verdict.exhausted is False
    assert verdict.count == 3


async def test_the_n_plus_first_message_trips_the_quota() -> None:
    repo = _AnonQuotaRepoDouble()
    db = _Db(repo)
    for _ in range(3):
        await anonymous_quota_verdict(db, anon_id=ANON_ID, quota=3, today=TODAY)
    verdict = await anonymous_quota_verdict(db, anon_id=ANON_ID, quota=3, today=TODAY)
    assert verdict.exhausted is True
    assert verdict.count == 4


async def test_a_different_identity_has_its_own_independent_count() -> None:
    repo = _AnonQuotaRepoDouble()
    db = _Db(repo)
    for _ in range(3):
        await anonymous_quota_verdict(db, anon_id=ANON_ID, quota=3, today=TODAY)
    other = await anonymous_quota_verdict(
        db, anon_id="anon_fedcba9876543210fedcba9876543210", quota=3, today=TODAY
    )
    assert other.exhausted is False
    assert other.count == 1


async def test_crossing_a_utc_day_boundary_resets_the_count() -> None:
    """Same identity, new UTC day: the counter starts fresh, not carried over."""
    repo = _AnonQuotaRepoDouble()
    db = _Db(repo)
    for _ in range(3):
        await anonymous_quota_verdict(db, anon_id=ANON_ID, quota=3, today=TODAY)
    verdict = await anonymous_quota_verdict(
        db, anon_id=ANON_ID, quota=3, today=TOMORROW
    )
    assert verdict.exhausted is False
    assert verdict.count == 1


async def test_a_none_quota_disables_the_check_and_never_touches_the_repo() -> None:
    repo = _AnonQuotaRepoDouble()
    verdict = await anonymous_quota_verdict(
        _Db(repo), anon_id=ANON_ID, quota=None, today=TODAY
    )
    assert verdict.exhausted is False
    assert repo.calls == []


async def test_a_zero_quota_also_disables_the_check_same_as_none() -> None:
    """0 disables, matching the budget breaker's convention — NOT "reject
    everything" (review follow-up: the two knobs must agree on what 0 means)."""
    repo = _AnonQuotaRepoDouble()
    verdict = await anonymous_quota_verdict(
        _Db(repo), anon_id=ANON_ID, quota=0, today=TODAY
    )
    assert verdict.exhausted is False
    assert repo.calls == []


async def test_a_malformed_anon_id_is_neither_counted_nor_rejected() -> None:
    """The container re-validates X-User-Id itself (issue #460 precedent) —
    structural correctness must not depend on the edge alone."""
    repo = _AnonQuotaRepoDouble()
    verdict = await anonymous_quota_verdict(
        _Db(repo), anon_id="anon_not-hex", quota=3, today=TODAY
    )
    assert verdict.exhausted is False
    assert repo.calls == []


async def test_an_anon_id_missing_the_prefix_is_also_rejected_as_malformed() -> None:
    repo = _AnonQuotaRepoDouble()
    verdict = await anonymous_quota_verdict(
        _Db(repo),
        anon_id="0123456789abcdef0123456789abcdef",
        quota=3,
        today=TODAY,
    )
    assert verdict.exhausted is False
    assert repo.calls == []


async def test_a_valid_prefix_with_trailing_junk_is_still_malformed() -> None:
    """Kills a `.fullmatch` -> `.match` mutation: `re.match` only anchors at
    the *start*, so on a pattern ending in `$` it still lets a trailing
    newline through (`$` matches just before one), while `.fullmatch`
    requires the entire string to match with nothing left over. An
    otherwise-valid id with anything appended — including a bare trailing
    newline — must not be treated as a real identity."""
    repo = _AnonQuotaRepoDouble()
    valid_prefix = "anon_" + "0123456789abcdef0123456789abcdef"
    verdict = await anonymous_quota_verdict(
        _Db(repo), anon_id=f"{valid_prefix}\n", quota=3, today=TODAY
    )
    assert verdict.exhausted is False
    assert repo.calls == []


async def test_a_counter_read_failure_fails_open() -> None:
    verdict = await anonymous_quota_verdict(
        _Db(_FailingRepo()), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.exhausted is False


async def test_a_postgres_failure_fails_the_quota_check_open() -> None:
    verdict = await anonymous_quota_verdict(
        _Db(_PgFailingRepo()), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.exhausted is False


async def test_quota_verdict_is_inert_without_an_anon_quota_repo() -> None:
    verdict = await anonymous_quota_verdict(
        object(), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.exhausted is False


def test_next_utc_midnight_is_the_start_of_the_following_utc_day() -> None:
    assert next_utc_midnight(TODAY) == datetime(2026, 7, 27, tzinfo=UTC)


async def test_the_verdict_carries_the_next_utc_reset_instant() -> None:
    verdict = await anonymous_quota_verdict(
        _Db(_AnonQuotaRepoDouble()), anon_id=ANON_ID, quota=3, today=TODAY
    )
    assert verdict.resets_at == datetime(2026, 7, 27, tzinfo=UTC)
