"""Agent startup reconciliation (TURN-3 #951).

The demand-driven sweep runs on startup once the pool connects, reclaiming
stale leases before the first admission reads policy/quota/budget. It must
never block readiness (the connect runs in the background).
"""

from __future__ import annotations

import asyncio
import threading
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from animichi.application.turn_admission_port import ReservationOutcome, ReserveRequest
from animichi.application.turn_outcome_port import SweepReport, TurnRef
from animichi.config.settings import Settings
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.infrastructure.supabase.client import SupabaseClient
from animichi.interfaces.fastapi_service import create_fastapi_app


class _SweepStore:
    """Store double recording the startup sweep."""

    def __init__(self) -> None:
        self.sweeps: list[int] = []

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        del request
        return ReservationOutcome(status="admitted", revision=1)

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        del ref, owner
        return True

    async def settle(self, ref: TurnRef, *, owner: str, outcome: str) -> bool:
        del ref, owner, outcome
        return True

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        del ref, owner
        return True

    async def sweep(
        self, *, now: object, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        del now, owner
        self.sweeps.append(batch_size)
        return SweepReport()


def _db(store: _SweepStore) -> MagicMock:
    db = MagicMock(spec=SupabaseClient)
    db.connect = AsyncMock()
    db.turn_reservation = store
    return db


def test_startup_sweep_runs_once_the_pool_connects() -> None:
    store = _SweepStore()
    app = create_fastapi_app(
        db=_db(store),
        session_store=InMemorySessionStore(),
        settings=Settings(),
    )
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
    # Shutdown awaits the chained sweep task, so it has run by now.
    assert store.sweeps != []


def test_startup_sweep_does_not_block_readiness() -> None:
    """Issue #694 discipline: the pool connect runs in the background, so the
    startup sweep — chained after it — must not gate the first request."""
    release = threading.Event()
    store = _SweepStore()
    db = _db(store)

    async def slow_connect() -> None:
        await asyncio.to_thread(release.wait)

    db.connect = slow_connect
    app = create_fastapi_app(
        db=db,
        session_store=InMemorySessionStore(),
        settings=Settings(),
    )
    with TestClient(app) as client:
        try:
            assert client.get("/healthz").status_code == 200
        finally:
            release.set()


def test_startup_sweep_failure_is_logged_not_fatal() -> None:
    import animichi.interfaces.fastapi_service as svc

    class _Exploding:
        def sweep(self) -> object:
            raise RuntimeError("boom")

    def build(_db: object) -> object:
        del _db
        return _Exploding()

    original = svc.build_startup_turn_outcome
    svc.build_startup_turn_outcome = build
    try:
        asyncio.run(svc._run_startup_sweep(object()))
    finally:
        svc.build_startup_turn_outcome = original


def test_sweep_after_connect_skips_when_connect_fails() -> None:

    store = _SweepStore()
    db = _db(store)

    async def broken_connect() -> None:
        raise RuntimeError("pool down")

    db.connect = broken_connect
    app = create_fastapi_app(
        db=db,
        session_store=InMemorySessionStore(),
        settings=Settings(),
    )
    try:
        with TestClient(app) as client:
            assert client.get("/healthz").status_code == 200
    except RuntimeError:
        # Shutdown awaits the failed connect task; the sweep must not run.
        pass
    assert store.sweeps == []
