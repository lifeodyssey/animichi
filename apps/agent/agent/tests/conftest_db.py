"""Three-arm database fixtures for integration and full-stack eval tests."""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import subprocess
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol, cast

import asyncpg
import pytest
from testcontainers.core.container import DockerContainer
from testcontainers.postgres import PostgresContainer

from agent.infrastructure.supabase.client import SupabaseClient
from agent.tests.atlas_helper import apply_migrations, expected_revisions
from agent.tests.db_config import (
    DatabaseArm,
    DatabaseConfig,
    dsn_host,
    is_local_host,
    preflight_plan,
    select_database_arm,
)
from agent.tests.neon_api import Branch, NeonApi

ROOT = Path(__file__).resolve().parents[4]
SEED_FILE = Path(__file__).parent / "fixtures" / "seed.sql"
OFFLINE_IMAGE = "animichi-test-postgres:16-3.4-pgvector-0.8.5"
OFFLINE_DOCKERFILE = ROOT / "docker" / "test-postgres" / "Dockerfile"
NEON_LOCAL_IMAGE = "neondatabase/neon_local:latest"
WAKE_TIMEOUT_SECONDS = 91.0
CONNECT_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True)
class DatabaseTarget:
    dsn: str
    arm: DatabaseArm
    branch_id: str | None = None

    def get_connection_url(self) -> str:
        return self.dsn


class WrappedContainer(Protocol):
    def stop(self, timeout: int) -> None: ...


class LifecycleContainer(Protocol):
    def start(self) -> object: ...

    def stop(self) -> None: ...

    def get_wrapped_container(self) -> WrappedContainer: ...


class PlainDsnContainer(Protocol):
    def get_connection_url(self, *, driver: None) -> str: ...


ContainerFactory = Callable[[DatabaseConfig, Branch], LifecycleContainer]


def _docker_available() -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        result = subprocess.run(
            ["docker", "info"], capture_output=True, timeout=5, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def _offline_build_command() -> str:
    relative = OFFLINE_DOCKERFILE.relative_to(ROOT)
    return f"docker build -f {relative} -t {OFFLINE_IMAGE} ."


def _require_offline_image() -> None:
    if not _docker_available():
        raise RuntimeError("Docker is required for the default TEST_DB=docker arm")
    result = subprocess.run(
        # literal (not OFFLINE_IMAGE): ruff S603 requires fully-literal subprocess args.
        ["docker", "image", "inspect", "animichi-test-postgres:16-3.4-pgvector-0.8.5"],
        capture_output=True,
        timeout=10,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"offline test image is missing; run: {_offline_build_command()}"
        )


def _clean_database_dsn(base_dsn: str, name: str) -> str:
    """Create a template1 database and return its DSN.

    The postgis base image pre-initialises POSTGRES_DB with the tiger/topology
    schemas, which atlas's clean-check refuses; migrations run in a fresh
    database instead (they create their own extensions).
    """

    async def _create() -> None:
        connection = await asyncpg.connect(base_dsn, timeout=10, statement_cache_size=0)
        try:
            await connection.execute(f'CREATE DATABASE "{name}" TEMPLATE template1')
        finally:
            await connection.close()

    asyncio.run(_create())
    scheme, _, rest = base_dsn.rpartition("/")
    del rest
    # the local container speaks no TLS; Go's libpq default (require) would fail.
    return f"{scheme}/{name}?sslmode=disable"


@contextmanager
def _offline_target() -> Iterator[DatabaseTarget]:
    _require_offline_image()
    with PostgresContainer(OFFLINE_IMAGE) as container:
        plain_dsn = cast(PlainDsnContainer, container)
        base = plain_dsn.get_connection_url(driver=None)
        yield DatabaseTarget(
            _clean_database_dsn(base, "animichi_test"), DatabaseArm.DOCKER
        )


def _new_neon_container(config: DatabaseConfig, parent: Branch) -> DockerContainer:
    assert config.neon_api_key is not None
    assert config.neon_project_id is not None
    container = DockerContainer(NEON_LOCAL_IMAGE).with_exposed_ports(5432)
    container.with_env("NEON_API_KEY", config.neon_api_key)
    container.with_env("NEON_PROJECT_ID", config.neon_project_id)
    container.with_env("PARENT_BRANCH_ID", parent.id)
    return container.with_env("DELETE_BRANCH", "true")


@contextmanager
def _neon_target(
    config: DatabaseConfig,
    api: NeonApi | None = None,
    container_factory: ContainerFactory | None = None,
) -> Iterator[DatabaseTarget]:
    assert config.neon_api_key is not None
    assert config.neon_project_id is not None
    client = api or NeonApi(config.neon_api_key, config.neon_project_id)
    parent = client.resolve_test_base()
    before = client.list_branches()
    factory = container_factory or cast(ContainerFactory, _new_neon_container)
    container = factory(config, parent)
    branch: Branch | None = None
    claim_name = f"wt-test-{uuid.uuid4().hex[:12]}"
    try:
        # 5-minute allowance: the filter compares Neon's server timestamps against
        # this local clock; positive host skew must not exclude the fresh branch
        # (the before/after delta remains the primary filter).
        claim_window_start = datetime.now(UTC) - timedelta(minutes=5)
        container.start()
        branch = client.wait_for_ephemeral(
            before, parent, claim_name, claim_window_start
        )
        dsn = client.connection_uri(branch.id)
        host = dsn_host(dsn)
        if is_local_host(host) or "-pooler" in host:
            raise RuntimeError(
                "Neon arm did not resolve a direct cloud database endpoint"
            )
        print(f"Neon test branch {branch.id} ready on database host {host}")
        yield DatabaseTarget(dsn, DatabaseArm.NEON, branch.id)
    finally:
        try:
            # graceful SIGTERM lets neon_local attempt its own branch cleanup.
            with contextlib.suppress(Exception):
                container.get_wrapped_container().stop(timeout=20)
            container.stop()
        finally:
            if branch is not None:
                _cleanup_claimed_branch(client, branch, claim_name)


def _cleanup_claimed_branch(client: NeonApi, branch: Branch, claim_name: str) -> None:
    try:
        client.wait_until_deleted(branch.id)
    except RuntimeError:
        client.delete_claimed_branch(branch.id, claim_name)
        print(f"Neon test branch {branch.id} force-deleted via API fallback")
    else:
        print(f"Neon test branch {branch.id} deleted")


@contextmanager
def _byo_target(config: DatabaseConfig) -> Iterator[DatabaseTarget]:
    assert config.database_url is not None
    yield DatabaseTarget(config.database_url, DatabaseArm.BYO)


def _target_for(config: DatabaseConfig) -> AbstractContextManager[DatabaseTarget]:
    if config.arm is DatabaseArm.DOCKER:
        return _offline_target()
    if config.arm is DatabaseArm.NEON:
        return _neon_target(config)
    return _byo_target(config)


async def _open_connection(
    dsn: str, timeout: float = CONNECT_TIMEOUT_SECONDS
) -> asyncpg.Connection:
    return await asyncpg.connect(dsn, timeout=timeout, statement_cache_size=0)


async def _open_pool(dsn: str) -> asyncpg.Pool:
    pool = await asyncpg.create_pool(dsn, statement_cache_size=0)
    assert pool is not None
    return pool


Clock = Callable[[], float]
Sleeper = Callable[[float], None]
Probe = Callable[[str, float, Clock], Awaitable[None]]


def _remaining(deadline: float, clock: Clock) -> float:
    remaining = deadline - clock()
    if remaining <= 0:
        raise TimeoutError("database wake operation exceeded its wall-clock budget")
    return remaining


async def _probe_database(dsn: str, deadline: float, clock: Clock) -> None:
    timeout = min(CONNECT_TIMEOUT_SECONDS, _remaining(deadline, clock))
    connection = await _open_connection(dsn, timeout)
    try:
        await asyncio.wait_for(
            connection.fetchval("SELECT 1"), timeout=_remaining(deadline, clock)
        )
    finally:
        await connection.close()


async def _wake_database_async(
    target: DatabaseTarget,
    clock: Clock = time.monotonic,
    sleeper: Sleeper = time.sleep,
    probe: Probe = _probe_database,
) -> None:
    deadline = clock() + WAKE_TIMEOUT_SECONDS
    for delay in (1, 2, 4, 8, 16, 0):
        try:
            await probe(target.dsn, deadline, clock)
            return
        except (asyncpg.PostgresError, OSError, TimeoutError):
            remaining = deadline - clock()
            if delay and remaining > 0:
                sleeper(min(float(delay), remaining))
            if remaining <= 0:
                break
    host = dsn_host(target.dsn)
    raise RuntimeError(f"database host {host} was unreachable after bounded retries")


def _wake_database(target: DatabaseTarget) -> None:
    asyncio.run(_wake_database_async(target))


async def _read_revisions(dsn: str) -> set[str]:
    connection = await _open_connection(dsn)
    try:
        rows = await connection.fetch(
            "SELECT version FROM public.atlas_schema_revisions"
        )
        return {str(row["version"]) for row in rows}
    finally:
        await connection.close()


async def _verify_revisions_async(target: DatabaseTarget) -> None:
    try:
        applied = await _read_revisions(target.dsn)
    except (asyncpg.PostgresError, OSError, TimeoutError) as error:
        raise RuntimeError("BYO Atlas revision verification failed") from error
    missing = set(expected_revisions()) - applied
    if missing:
        raise RuntimeError(f"BYO database is behind by {len(missing)} migration(s)")


def _verify_revisions(target: DatabaseTarget) -> None:
    asyncio.run(_verify_revisions_async(target))


async def _apply_seed(dsn: str) -> None:
    connection = await _open_connection(dsn)
    try:
        async with connection.transaction():
            await connection.execute(SEED_FILE.read_text(encoding="utf-8"))
    finally:
        await connection.close()


async def _seed_async(target: DatabaseTarget) -> None:
    try:
        await _apply_seed(target.dsn)
    except (asyncpg.PostgresError, OSError, TimeoutError) as error:
        raise RuntimeError("database seed failed; DSN withheld") from error


def _seed(target: DatabaseTarget) -> None:
    asyncio.run(_seed_async(target))


async def _capabilities(dsn: str) -> asyncpg.Record | None:
    connection = await _open_connection(dsn)
    try:
        return await connection.fetchrow(
            """
            SELECT to_regclass('public.bangumi') AS bangumi,
                   to_regclass('public.route_anime') AS route_anime,
                   EXISTS (
                       SELECT 1 FROM pg_extension WHERE extname = 'vector'
                   ) AS vector
            """
        )
    finally:
        await connection.close()


async def _verify_capabilities_async(target: DatabaseTarget) -> None:
    try:
        result = await _capabilities(target.dsn)
    except (asyncpg.PostgresError, OSError, TimeoutError) as error:
        raise RuntimeError("database capability check failed; DSN withheld") from error
    if result is None or not all(
        (result["bangumi"], result["route_anime"], result["vector"])
    ):
        raise RuntimeError("database lacks bangumi, route_anime, or pgvector")


def _verify_capabilities(target: DatabaseTarget) -> None:
    asyncio.run(_verify_capabilities_async(target))


def _verify_byo_identity(config: DatabaseConfig, target: DatabaseTarget) -> None:
    assert config.neon_api_key is not None
    assert config.neon_project_id is not None
    NeonApi(config.neon_api_key, config.neon_project_id).assert_mutable_dsn(target.dsn)


async def preflight_byo_database(
    config: DatabaseConfig, target: DatabaseTarget
) -> None:
    """Apply the shared BYO read-verify and mutation trust boundary."""
    plan = preflight_plan(config)
    await _wake_database_async(target)
    await _verify_revisions_async(target)
    await _verify_capabilities_async(target)
    if not config.allow_mutation:
        raise RuntimeError(
            "BYO database verified read-only; set TEST_DB_ALLOW_MUTATION=1"
        )
    if plan.verify_identity:
        _verify_byo_identity(config, target)
    if plan.apply_seed:
        await _seed_async(target)


def _prepare_database(config: DatabaseConfig, target: DatabaseTarget) -> None:
    if config.arm is DatabaseArm.BYO:
        asyncio.run(preflight_byo_database(config, target))
        print(f"Database preflight passed for {target.arm} host {dsn_host(target.dsn)}")
        return
    plan = preflight_plan(config)
    _wake_database(target)
    if plan.apply_atlas:
        elapsed = apply_migrations(target.dsn)
        print(f"Atlas apply on database host {dsn_host(target.dsn)}: {elapsed:.1f}s")
    _verify_capabilities(target)
    if plan.apply_seed:
        _seed(target)
    print(f"Database preflight passed for {target.arm} host {dsn_host(target.dsn)}")


@pytest.fixture(scope="session")
def pg_container() -> Iterator[DatabaseTarget]:
    config = select_database_arm(os.environ)
    with _target_for(config) as target:
        _prepare_database(config, target)
        yield target


@pytest.fixture
async def db_pool(pg_container: DatabaseTarget) -> AsyncIterator[asyncpg.Pool]:
    pool = await _open_pool(pg_container.dsn)
    yield pool
    await pool.close()


@pytest.fixture
async def real_db(pg_container: DatabaseTarget) -> AsyncIterator[SupabaseClient]:
    client = SupabaseClient(
        pg_container.dsn, min_pool_size=1, max_pool_size=2, statement_cache_size=0
    )
    await client.connect()
    yield client
    await client.close()
