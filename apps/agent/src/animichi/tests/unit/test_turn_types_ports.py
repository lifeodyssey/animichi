"""Turn port contracts are structurally instantiable (TURN-4 #955 coverage loop).

The SessionGateway / TurnSettlement / TurnExecution protocols are the typed
adapter seams AgentTurn speaks. A bare subclass that overrides none of the
methods inherits the ``...`` stub bodies; calling them pins that the port
surface stays awaitable and returns the stub default, so the interface lines
are exercised rather than left as never-taken exits.
"""

from __future__ import annotations

import asyncio

from animichi.application.turn_types import (
    SessionGateway,
    TurnExecution,
    TurnSettlement,
)


class _StubGateway(SessionGateway):
    pass


class _StubSettlement(TurnSettlement):
    pass


class _StubExecution(TurnExecution):
    pass


def test_session_gateway_stub_methods_are_awaitable() -> None:
    gateway = _StubGateway()

    async def run() -> None:
        owner = await gateway.check_owner(None, None)
        snapshot = await gateway.load(None, user_id=None)
        outcome = await gateway.persist("s-1", None)

        assert owner is None
        assert snapshot is None
        assert outcome is None

    asyncio.run(run())


def test_settlement_stub_is_awaitable() -> None:
    settlement = _StubSettlement()

    async def run() -> None:
        assert await settlement.settle(None) is None

    asyncio.run(run())


def test_execution_stub_is_awaitable() -> None:
    execution = _StubExecution()

    async def run() -> None:
        assert (
            await execution.execute(
                None, context=None, history=(), model=None, on_step=None
            )
            is None
        )

    asyncio.run(run())
