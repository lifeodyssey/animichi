"""Shared apply of a settled turn's outbox effects (issue #1014, AC5).

The ``SettlementOutboxDispatcher`` is the only consumer of these effects: it
applies a single undelivered outbox row's effect on the same transaction that
the durable-outbox store marks the row delivered on, so effect + delivered-mark
commit atomically (exactly-once with non-idempotent effects). Repositories that
are not wired (``None``) skip their effect, preserving the existing semantics.
The applier speaks only repository ports and a ``SettlementPayload``; no
request or framework state leaks into it (AC5).
"""

from __future__ import annotations

from datetime import date

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from animichi.application.admission_limits import anon_quota_eligible
from animichi.application.identity import scope_for_identity
from animichi.application.model_turn_port import ModelTurnUsage
from animichi.application.outbox_payload import SettlementPayload
from animichi.application.outbox_port import OutboxRow
from animichi.infrastructure.persistence.repositories.anon_quota import (
    SQLModelAnonQuotaRepository,
)
from animichi.infrastructure.persistence.repositories.feedback import (
    SQLModelFeedbackRepository,
)
from animichi.infrastructure.persistence.repositories.session import (
    SQLModelSessionRepository,
)
from animichi.infrastructure.persistence.repositories.usage import (
    SQLModelUsageRepository,
)
from animichi.interfaces.usage_metering import (
    UsagePrices,
    record_turn_usage_on,
    utc_today,
)

logger = structlog.get_logger(__name__)


class SettlementInputs:
    """Repository ports an outbox effect applies through (AC5)."""

    def __init__(
        self,
        *,
        usage_repo: SQLModelUsageRepository | None,
        anon_quota_repo: SQLModelAnonQuotaRepository | None,
        request_audit_repo: SQLModelFeedbackRepository | None,
        messages_repo: SQLModelSessionRepository | None,
        prices: UsagePrices,
        today: date | None = None,
    ) -> None:
        self.usage_repo = usage_repo
        self.anon_quota_repo = anon_quota_repo
        self.request_audit_repo = request_audit_repo
        self.messages_repo = messages_repo
        self.prices = prices
        self.today = today


class SettlementApplier:
    """Apply one settled turn's durable usage / quota / audit effects."""

    def __init__(self, inputs: SettlementInputs) -> None:
        self._inputs = inputs

    async def apply_session(
        self, session: AsyncSession, payload: SettlementPayload
    ) -> None:
        """Apply every recorded external effect on the caller's transaction."""
        await self._apply_usage_on(session, payload)
        if payload.settle_quota:
            await self._apply_quota_on(session, payload)
        await self._apply_audit_on(session, payload)

    async def _apply_usage_on(
        self, session: AsyncSession, payload: SettlementPayload
    ) -> None:
        for item in payload.usage:
            scope = scope_for_identity(
                payload.user_id, payload.user_type, is_byok=item.payer == "byok"
            )
            prices = (
                self._inputs.prices
                if item.payer == "platform"
                else UsagePrices(0.0, 0.0)
            )
            await record_turn_usage_on(
                session,
                self._inputs.usage_repo,
                usage=ModelTurnUsage(
                    completion_tokens=item.completion_tokens,
                    prompt_tokens=item.prompt_tokens,
                    requests=item.requests,
                ),
                scope=scope,
                prices=prices,
                today=self._inputs.today,
            )

    async def _apply_quota_on(
        self, session: AsyncSession, payload: SettlementPayload
    ) -> None:
        scope = scope_for_identity(
            payload.user_id, payload.user_type, is_byok=payload.is_byok
        )
        if scope != "anon":
            return
        repo = self._inputs.anon_quota_repo
        anon_id = payload.user_id or ""
        if repo is None or not anon_quota_eligible(anon_id):
            return
        try:
            await repo.increment_and_count_on(
                session,
                usage_date=self._inputs.today or utc_today(),
                anon_id=anon_id,
            )
        except Exception:
            logger.warning("anon_quota_settle_failed", exc_info=True)

    async def _apply_audit_on(
        self, session: AsyncSession, payload: SettlementPayload
    ) -> None:
        """Persist the user message on error (best-effort) and log the request."""
        if (
            not payload.user_message_persisted
            and payload.session_id
            and payload.request_text
        ):
            await self._persist_user_message_on(session, payload)
        if self._inputs.request_audit_repo is None:
            return
        try:
            await self._inputs.request_audit_repo.insert_request_log_on(
                session,
                session_id=payload.session_id,
                query_text=payload.request_text,
                locale=payload.locale,
                plan_steps=payload.plan_steps,
                intent=payload.intent,
                status=payload.status,
                latency_ms=payload.elapsed_ms,
            )
        except (OSError, RuntimeError, ValueError, TypeError):
            logger.warning("request_log_failed", session_id=payload.session_id)

    async def _persist_user_message_on(
        self, session: AsyncSession, payload: SettlementPayload
    ) -> None:
        try:
            session_id = payload.session_id
            if session_id is None or payload.request_text == "":
                return
            if self._inputs.messages_repo is None:
                return
            await self._inputs.messages_repo.insert_message_on(
                session, session_id, "user", payload.request_text
            )
        except (OSError, RuntimeError, ValueError, TypeError):
            logger.warning(
                "finally_persist_user_msg_failed", session_id=payload.session_id
            )


class SettlementOutboxDispatcher:
    """Apply one undelivered outbox row on the drain's transaction (AC5)."""

    def __init__(self, inputs: SettlementInputs) -> None:
        self._applier = SettlementApplier(inputs)

    async def apply_session(self, session: AsyncSession, row: OutboxRow) -> bool:
        """Apply only the one external effect recorded on this row (AC5).

        Each undelivered row owns exactly one effect (usage / quota / audit),
        so the drain applies it once — never re-applying the sibling effects
        that belong to other rows of the same turn.
        """
        payload = SettlementPayload.from_json(row.payload)
        if payload is None:
            return False
        try:
            if row.kind == "usage":
                await self._applier._apply_usage_on(session, payload)
            elif row.kind == "quota":
                if payload.settle_quota:
                    await self._applier._apply_quota_on(session, payload)
            elif row.kind == "audit":
                await self._applier._apply_audit_on(session, payload)
            else:
                return False
        except Exception:
            logger.warning("outbox_apply_failed", exc_info=True)
            return False
        return True


__all__ = ["SettlementApplier", "SettlementInputs", "SettlementOutboxDispatcher"]
