"""Runtime contracts for bounded fixture I/O: wake probe budget and asyncpg."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import pytest

from animichi.tests import conftest_db
from animichi.tests.conftest_db import (
    DatabaseTarget,
    _clean_database_dsn,
    _open_connection,
    _open_pool,
    _probe_database,
    _wake_database_async,
)
from animichi.tests.db_config import DatabaseArm


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, delay: float) -> None:
        self.sleeps.append(delay)
        self.now += delay


def test_wake_probe_retries_share_one_wall_clock_budget() -> None:
    clock = FakeClock()

    async def fail_probe(
        dsn: str, deadline: float, current_time: Callable[[], float]
    ) -> None:
        assert dsn.endswith("/test")
        clock.now += min(10, deadline - current_time())
        raise TimeoutError

    target = DatabaseTarget("postgresql://u:p@localhost/test", DatabaseArm.BYO)
    with pytest.raises(RuntimeError, match="bounded retries"):
        asyncio.run(
            _wake_database_async(
                target, clock=clock, sleeper=clock.sleep, probe=fail_probe
            )
        )
    assert clock.now == conftest_db.WAKE_TIMEOUT_SECONDS
    assert clock.sleeps == [1, 2, 4, 8, 16]


class FakeConnection:
    async def execute(self, statement: str) -> None:
        assert statement.startswith("CREATE DATABASE")

    async def close(self) -> None:
        return None

    async def fetchval(self, statement: str) -> int:
        assert statement == "SELECT 1"
        return 1


def test_probe_connect_and_select_share_remaining_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = FakeClock()
    clock.now = 3
    timeouts: list[float] = []

    async def open_connection(dsn: str, timeout: float = 10) -> FakeConnection:
        assert dsn.endswith("/test")
        timeouts.append(timeout)
        return FakeConnection()

    async def wait_for(value: Awaitable[object], timeout: float) -> object:
        timeouts.append(timeout)
        return await value

    monkeypatch.setattr(conftest_db, "_open_connection", open_connection)
    monkeypatch.setattr(conftest_db.asyncio, "wait_for", wait_for)
    asyncio.run(_probe_database("postgresql://u:p@localhost/test", 7, clock))
    assert timeouts == [4, 4]


class FakePool:
    async def close(self) -> None:
        return None


def test_fixture_asyncpg_calls_all_disable_statement_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_sizes: list[int] = []
    connection = FakeConnection()
    pool = FakePool()

    async def connect(
        dsn: str, *, timeout: float, statement_cache_size: int
    ) -> FakeConnection:
        assert dsn.startswith("postgresql://") and timeout > 0
        cache_sizes.append(statement_cache_size)
        return connection

    async def create_pool(dsn: str, *, statement_cache_size: int) -> FakePool:
        assert dsn.startswith("postgresql://")
        cache_sizes.append(statement_cache_size)
        return pool

    monkeypatch.setattr(conftest_db.asyncpg, "connect", connect)
    monkeypatch.setattr(conftest_db.asyncpg, "create_pool", create_pool)
    dsn = "postgresql://u:p@localhost/postgres"
    _clean_database_dsn(dsn, "fixture_test")
    asyncio.run(_open_connection(dsn))

    assert asyncio.run(_open_pool(dsn)) is pool
    assert cache_sizes == [0, 0, 0]
