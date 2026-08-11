"""Shared fakes/helpers for the chat admission wire tests (TURN-2/3 #949/#951).

A scripted turn-outcome store and the FastAPI client plumbing both
``test_chat_admission_wire`` (rejection mapping) and
``test_chat_admission_handoff`` (lifecycle handoff) drive.
"""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi import FastAPI

from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import SweepReport, TurnRef
from animichi.config.settings import Settings
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}


class ScriptedStore:
    """A store that returns scripted outcomes and records lifecycle calls."""

    def __init__(self, outcome: ReservationOutcome) -> None:
        self.outcome = outcome
        self.requests: list[ReserveRequest] = []
        self.dispatch_calls: list[tuple[str | None, str, str | None]] = []
        self.settle_calls: list[tuple[str | None, str, str | None, str]] = []
        self.release_calls: list[tuple[str | None, str, str | None]] = []
        self.sweep_calls: list[int] = []

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        self.requests.append(request)
        if self.outcome.status == "admitted":
            return replace(
                self.outcome,
                owner=request.owner,
                lease_expires_at=request.lease_expires_at,
            )
        return self.outcome

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        self.dispatch_calls.append((ref.session_id, ref.turn_key, owner))
        return True

    async def settle(self, ref: TurnRef, *, owner: str, outcome: str) -> bool:
        self.settle_calls.append((ref.session_id, ref.turn_key, owner, outcome))
        return True

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        self.release_calls.append((ref.session_id, ref.turn_key, owner))
        return True

    async def sweep(self, *, now: object, owner: str, batch_size: int) -> SweepReport:
        del now, owner
        self.sweep_calls.append(batch_size)
        return SweepReport()


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _app(store: ScriptedStore) -> tuple[FastAPI, MagicMock]:
    db = build_stub_db()
    db.turn_reservation = store
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(success=True, status="ok", intent="general_qa")
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    app, _ = build_app(runtime_api=runtime, db=db, settings=Settings())
    return app, runtime


async def _post(app: FastAPI, headers: dict[str, str] | None = None) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)
