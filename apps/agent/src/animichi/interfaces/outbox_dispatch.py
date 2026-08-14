"""Shared apply of a settled turn's outbox effects (issue #1014, AC5).

The settlement component and the durable-outbox drain both use one
``SettlementApplier`` so an effect is applied identically whether it runs
inline at settle (enqueue + immediate apply + mark delivered) or is
recovered by the background drain after a process crash. The applier
speaks only repository ports and a ``SettlementPayload``; no request or
framework state leaks into it (AC5).
"""

from __future__ import annotations

from datetime import date

import structlog

from animichi.application.admission_limits import anon_quota_eligible
from animichi.application.identity import scope_for_identity
from animichi.application.model_turn_port import ModelTurnUsage
from animichi.application.outbox_payload import SettlementPayload
from animichi.application.outbox_port import OutboxRow
from animichi.domain.ports import (
    AnonQuotaCounter,
    ConversationLog,
    RequestAudit,
    UsageMeter,
)
from animichi.interfaces.usage_metering import UsagePrices, record_turn_usage, utc_today

logger = structlog.get_logger(__name__)


class SettlementInputs:
    """Repository ports an outbox effect applies through (AC5)."""

    def __init__(
        self,
        *,
        usage_repo: UsageMeter | None,
        anon_quota_repo: AnonQuotaCounter | None,
        request_audit_repo: RequestAudit | None,
        messages_repo: ConversationLog | None,
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
    """Apply a settled turn's durable usage / quota / audit effects."""

    def __init__(self, inputs: SettlementInputs) -> None:
        self._inputs = inputs

    async def apply(self, payload: SettlementPayload) -> None:
        """Apply every recorded external effect for one settled turn."""
        await self._apply_usage(payload)
        if payload.settle_quota:
            await self._apply_quota(payload)
        await self._apply_audit(payload)

    async def _apply_usage(self, payload: SettlementPayload) -> None:
        for item in payload.usage:
            scope = scope_for_identity(
                payload.user_id, payload.user_type, is_byok=item.payer == "byok"
            )
            prices = (
                self._inputs.prices
                if item.payer == "platform"
                else UsagePrices(0.0, 0.0)
            )
            await record_turn_usage(
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

    async def _apply_quota(self, payload: SettlementPayload) -> None:
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
            await repo.increment_and_count(
                usage_date=self._inputs.today or utc_today(), anon_id=anon_id
            )
        except Exception:
            logger.warning("anon_quota_settle_failed", exc_info=True)

    async def _apply_audit(self, payload: SettlementPayload) -> None:
        """Persist the user message on error (best-effort) and log the request."""
        if (
            not payload.user_message_persisted
            and payload.session_id
            and payload.request_text
        ):
            await self._persist_user_message(payload)
        if self._inputs.request_audit_repo is None:
            return
        try:
            await self._inputs.request_audit_repo.insert_request_log(
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

    async def _persist_user_message(self, payload: SettlementPayload) -> None:
        from animichi.interfaces.persistence import persist_messages
        from animichi.interfaces.public_api import PublicAPIResponse

        try:
            session_id = payload.session_id
            if session_id is None:
                return
            await persist_messages(
                messages_repo=self._inputs.messages_repo,
                session_id=session_id,
                user_text=payload.request_text,
                result=None,
                response=PublicAPIResponse(
                    success=False, status="error", intent="unknown"
                ),
                persist_user_only=True,
            )
        except (OSError, RuntimeError, ValueError, TypeError):
            logger.warning(
                "finally_persist_user_msg_failed", session_id=payload.session_id
            )


class SettlementOutboxDispatcher:
    """``OutboxDispatcher`` projection over :class:`SettlementApplier`."""

    def __init__(self, inputs: SettlementInputs) -> None:
        self._applier = SettlementApplier(inputs)

    async def apply(self, row: OutboxRow) -> bool:
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
                await self._applier._apply_usage(payload)
            elif row.kind == "quota":
                if payload.settle_quota:
                    await self._applier._apply_quota(payload)
            elif row.kind == "audit":
                await self._applier._apply_audit(payload)
            else:
                return False
        except Exception:
            logger.warning("outbox_apply_failed", exc_info=True)
            return False
        return True


__all__ = ["SettlementApplier", "SettlementInputs", "SettlementOutboxDispatcher"]
