"""Durable-outbox drain wiring for the Agent service (issue #1014, AC5).

The background drain loop and the startup drain recover undelivered outbox
rows and apply each external effect exactly once per row. Extracted from the
app factory so ``fastapi_service`` stays under the file-size cap; the
lifespan keeps wiring these into the service.
"""

from __future__ import annotations

import asyncio

import structlog

from animichi.application.outbox import TurnOutbox
from animichi.config.settings import Settings
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.interfaces.outbox_dispatch import (
    SettlementInputs,
    SettlementOutboxDispatcher,
)
from animichi.interfaces.usage_metering import UsagePrices

logger = structlog.get_logger(__name__)

#: Interval between outbox drain passes (seconds); bounded, demand-driven (AC5).
DEFAULT_OUTBOX_DRAIN_INTERVAL = 60.0


def _outbox_inputs(
    runtime_db: PersistenceRepos, settings: Settings
) -> SettlementInputs:
    """Build the repository inputs the durable-outbox drain applies through."""
    return SettlementInputs(
        usage_repo=runtime_db.usage,
        anon_quota_repo=runtime_db.anon_quota,
        request_audit_repo=runtime_db.feedback,
        messages_repo=runtime_db.session,
        prices=UsagePrices(
            input_usd_per_mtok=settings.model_input_cost_per_mtok_usd,
            output_usd_per_mtok=settings.model_output_cost_per_mtok_usd,
        ),
    )


async def _drain_outbox_once(runtime_db: PersistenceRepos, settings: Settings) -> int:
    """One bounded drain pass over the durable outbox (AC5).

    Applies every undelivered external effect exactly once and returns how many
    deliveries were made. Best-effort: a failure logs and leaves rows pending
    for the next pass.
    """
    outbox = TurnOutbox(store=runtime_db.outbox)
    dispatcher = SettlementOutboxDispatcher(_outbox_inputs(runtime_db, settings))
    return await outbox.drain(dispatcher)


async def _outbox_drain_loop(
    runtime_db: PersistenceRepos,
    settings: Settings,
    interval: float,
) -> None:
    """Background drain loop recovering undelivered outbox rows (AC5)."""
    while True:
        try:
            await asyncio.sleep(interval)
            await _drain_outbox_once(runtime_db, settings)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("outbox_drain_failed", exc_info=True)


async def _run_startup_outbox_drain(
    runtime_db: object,
    settings: Settings,
) -> None:
    """Best-effort outbox drain on Agent startup (AC5 crash recovery)."""
    if not isinstance(runtime_db, PersistenceRepos):
        return
    try:
        await _drain_outbox_once(runtime_db, settings)
    except Exception:
        logger.warning("startup_outbox_drain_failed", exc_info=True)
