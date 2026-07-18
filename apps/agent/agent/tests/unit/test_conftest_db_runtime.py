"""Runtime contracts for bounded fixture I/O and teardown."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import cast

import pytest

from agent.tests import conftest_db
from agent.tests.conftest_db import (
    DatabaseTarget,
    _clean_database_dsn,
    _neon_target,
    _open_connection,
    _open_pool,
    _probe_database,
    _wake_database_async,
)
from agent.tests.db_config import DatabaseArm, DatabaseConfig
from agent.tests.neon_api import Branch


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


class StopFailingContainer:
    def start(self) -> StopFailingContainer:
        return self

    def get_wrapped_container(self) -> StopFailingContainer:
        return self

    def stop(self, timeout: int | None = None) -> None:
        if timeout is None:
            raise RuntimeError("container stop failed")


class TeardownApi:
    project_id = "project-test"

    def __init__(self) -> None:
        self.deleted: tuple[str, str] | None = None

    def resolve_test_base(self) -> Branch:
        return Branch("br-parent", "test-base", self.project_id, "br-main", False)

    def list_branches(self) -> tuple[Branch, ...]:
        return ()

    def wait_for_ephemeral(
        self,
        before: tuple[Branch, ...],
        parent: Branch,
        claim_name: str,
        created_after: datetime,
    ) -> Branch:
        del before, parent, created_after
        return Branch("br-child", claim_name, self.project_id, "br-parent", False)

    def connection_uri(self, branch_id: str) -> str:
        assert branch_id == "br-child"
        return "postgresql://u:p@ep-safe.neon.tech/test"

    def wait_until_deleted(self, branch_id: str) -> None:
        assert branch_id == "br-child"
        raise RuntimeError("still present")

    def delete_claimed_branch(self, branch_id: str, claim_name: str) -> None:
        self.deleted = (branch_id, claim_name)


def test_container_stop_failure_cannot_skip_claimed_branch_delete() -> None:
    config = DatabaseConfig(
        DatabaseArm.NEON, neon_api_key="secret", neon_project_id="project-test"
    )
    api = TeardownApi()
    with pytest.raises(RuntimeError, match="container stop failed"):
        with _neon_target(
            config,
            cast(conftest_db.NeonApi, api),
            lambda _config, _parent: StopFailingContainer(),
        ):
            pass
    assert api.deleted is not None
    assert api.deleted[0] == "br-child"
    assert api.deleted[1].startswith("wt-test-")
