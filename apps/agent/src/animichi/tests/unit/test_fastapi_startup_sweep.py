"""Agent startup reconciliation (TURN-3 #951).

The demand-driven sweep runs as a background task on startup once the
lifespan composes the repository aggregate, reclaiming stale leases before
the first admission reads policy/quota/budget. It must never block readiness
(#694).
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from animichi.application.turn_admission_port import ReservationOutcome, ReserveRequest
from animichi.application.turn_outcome_port import SweepReport, TurnRef
from animichi.config.settings import Settings
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.session.memory import InMemorySessionStore
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


def _db(store: _SweepStore) -> PersistenceRepos:
    db = PersistenceRepos(
        sessionmaker=MagicMock(),
        session=MagicMock(),
        turn_reservation=store,
        bangumi=MagicMock(),
        points=MagicMock(),
        usage=MagicMock(),
        anon_quota=MagicMock(),
        feedback=MagicMock(),
        memory=MagicMock(),
    )
    return db


def test_startup_sweep_runs_once_the_aggregate_is_composed() -> None:
    store = _SweepStore()
    app = create_fastapi_app(
        db=_db(store),
        session_store=InMemorySessionStore(),
        settings=Settings(),
    )
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
    # Shutdown awaits the background sweep task, so it has run by now.
    assert store.sweeps != []


def test_startup_sweep_does_not_block_readiness() -> None:
    """Issue #694 discipline: the sweep runs in the background and must not
    gate the first request."""
    import asyncio
    import threading

    release = threading.Event()

    class _BlockingSweepStore(_SweepStore):
        async def sweep(
            self, *, now: object, owner: str, batch_size: int, lease_seconds: int
        ) -> SweepReport:
            await asyncio.to_thread(release.wait)
            return await super().sweep(
                now=now, owner=owner, batch_size=batch_size, lease_seconds=lease_seconds
            )

    store = _BlockingSweepStore()
    app = create_fastapi_app(
        db=_db(store),
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


def test_failing_sweep_does_not_fail_the_app_lifespan() -> None:
    class _ExplodingStore(_SweepStore):
        async def sweep(
            self, *, now: object, owner: str, batch_size: int, lease_seconds: int
        ) -> SweepReport:
            del now, owner, batch_size, lease_seconds
            raise RuntimeError("pool down")

    app = create_fastapi_app(
        db=_db(_ExplodingStore()),
        session_store=InMemorySessionStore(),
        settings=Settings(),
    )
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
