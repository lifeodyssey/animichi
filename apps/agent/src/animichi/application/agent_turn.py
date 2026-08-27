"""AgentTurn (TURN-4 #955) — the single application use case for one turn.

The turn kinds, neutral result/envelope types, and ports live in
``application.turn_types``; this module owns the use case itself: admission
verdict, dispatch-certainty, execute, persist, and exactly-once settlement
through :class:`TurnOutcome` (the CAS guard).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from uuid import uuid4

import structlog

from animichi.application.errors import ApplicationError, InvalidInputError
from animichi.application.turn_admission import AdmissionRequest, AdmissionVerdict
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import TurnRef
from animichi.application.turn_types import (
    ExecutionResult,
    ReservationBinding,
    SessionGateway,
    SessionSnapshot,
    SessionUpdate,
    TextTurn,
    TurnExecution,
    TurnInput,
    TurnResult,
    TurnSelectionError,
    TurnSettlement,
    TurnSideEffects,
    TurnStageSink,
    _request_text,
)

logger = structlog.get_logger(__name__)


def _carried_output(exc: BaseException) -> object | None:
    """The result produced before a catastrophic escape (meter it anyway)."""
    return getattr(exc, _CARRIED_ATTR, None)


def _carry_output(exc: Exception, output: object | None) -> None:
    """Tag a catastrophic escape with the output it already produced."""
    setattr(exc, _CARRIED_ATTR, output)


_CARRIED_ATTR = "_agent_turn_output"
_DETACHED_TIMED_RESULTS: set[asyncio.Future[ExecutionResult]] = set()


def _consume_timed_result(future: asyncio.Future[ExecutionResult]) -> None:
    _DETACHED_TIMED_RESULTS.discard(future)
    with suppress(asyncio.CancelledError):
        future.exception()


def _cancel_timed_result(future: asyncio.Future[ExecutionResult]) -> None:
    _DETACHED_TIMED_RESULTS.add(future)
    future.add_done_callback(_consume_timed_result)
    future.cancel()


class AgentTurn:
    """Use case: gate, execute, persist, and settle one typed turn."""

    def __init__(
        self,
        *,
        outcome: TurnOutcome,
        session: SessionGateway,
        settlement: TurnSettlement,
        execution: TurnExecution,
        detect_injection: Callable[[str], bool],
        guard_enabled: Callable[[], bool],
        blocked_outcome: Callable[[SessionSnapshot, str], object],
        extract_delta: Callable[[object], dict[str, object]],
        timeout: float | None = None,
    ) -> None:
        self._outcome = outcome
        self._session = session
        self._settlement = settlement
        self._execution = execution
        self._detect_injection = detect_injection
        self._guard_enabled = guard_enabled
        self._blocked_outcome = blocked_outcome
        self._extract_delta = extract_delta
        self._timeout = timeout

    async def __call__(
        self,
        turn: TurnInput,
        *,
        binding: ReservationBinding | None = None,
        on_step: TurnStageSink | None = None,
    ) -> TurnResult:
        """Handle one turn; the terminal paths settle exactly once."""
        started_at = time.perf_counter()
        verdict = turn.verdict or await self._admit(turn)
        if verdict.rejection is not None:
            return self._rejected(verdict)
        reserved = not verdict.replayed
        outcome, ref, owner = self._reservation_context(turn, verdict, binding)
        prepared = await self._prepare_snapshot(
            turn, verdict, outcome, ref, owner, reserved
        )
        if isinstance(prepared, TurnResult):
            return prepared
        return await self._run_and_settle(
            turn, verdict, outcome, ref, owner, reserved, prepared, on_step, started_at
        )

    def _rejected(self, verdict: AdmissionVerdict) -> TurnResult:
        """The admission-time rejection outcome (no reservation was taken)."""
        return TurnResult(
            outcome="rejected",
            rejection=verdict.rejection,
            session_id=verdict.session_id,
        )

    def _reservation_context(
        self,
        turn: TurnInput,
        verdict: AdmissionVerdict,
        binding: ReservationBinding | None,
    ) -> tuple[TurnOutcome, TurnRef, str]:
        """Resolve the (outcome, ref, owner) triple guarding this turn."""
        outcome = binding.outcome if binding is not None else self._outcome
        ref = (
            binding.ref
            if binding is not None
            else TurnRef(session_id=verdict.session_id, turn_key=turn.turn_key)
        )
        owner = binding.owner if binding is not None else verdict.owner or ""
        return outcome, ref, owner

    async def _prepare_snapshot(
        self,
        turn: TurnInput,
        verdict: AdmissionVerdict,
        outcome: TurnOutcome,
        ref: TurnRef,
        owner: str,
        reserved: bool,
    ) -> SessionSnapshot | TurnResult:
        """Load the session and dispatch the reservation, or a lost lease."""
        snapshot, dispatched = await self._load_and_dispatch(
            turn, verdict, outcome, ref, owner, reserved
        )
        if reserved and not dispatched:
            await outcome.release(ref, owner=owner)
            return TurnResult(
                outcome="lease_lost",
                session_id=turn.session_id,
                revision=verdict.revision,
            )
        return snapshot

    async def _load_and_dispatch(
        self,
        turn: TurnInput,
        verdict: AdmissionVerdict,
        outcome: TurnOutcome,
        ref: TurnRef,
        owner: str,
        reserved: bool,
    ) -> tuple[SessionSnapshot, bool]:
        """Load the session and flip reserved->running; clean up on escape.

        Both awaits below can be where a client disconnect cancels this turn
        (P0 SSE §2.1). `CancelledError` is a `BaseException`, not an
        `Exception`, since Python 3.8 — it must be named explicitly or the
        reservation is left stuck (`load`: still `reserved`; `dispatch`: its
        own commit outcome is unknown at the cancellation point) until its
        lease expires.
        """
        try:
            snapshot = await self._session.load(
                None if verdict.replayed else turn.session_id,
                user_id=turn.identity.user_id,
            )
            dispatched = await outcome.dispatch(ref, owner=owner) if reserved else True
        except asyncio.CancelledError:
            if reserved:
                await self._relinquish_reservation(outcome, ref, owner)
            raise
        except Exception:
            # The turn died before dispatch committed: the reservation is
            # released, never settled (TURN-3 #951 phase-aware release).
            if reserved:
                await outcome.release(ref, owner=owner)
            raise
        return snapshot, dispatched

    async def _relinquish_reservation(
        self, outcome: TurnOutcome, ref: TurnRef, owner: str
    ) -> None:
        """Give up a reservation whose state is ambiguous after a cancel.

        A cancel mid-`dispatch` may land before or after the store's
        reserved->running commit lands, so try the pre-commit release first
        (a no-op once the flip already happened) and fall back to a failed
        settle for the post-commit case — either way the reservation never
        sits stuck for its full lease.
        """
        released = await outcome.release(ref, owner=owner)
        if not released:
            await outcome.settle(ref, owner=owner, outcome="failed")

    async def _run_and_settle(
        self,
        turn: TurnInput,
        verdict: AdmissionVerdict,
        outcome: TurnOutcome,
        ref: TurnRef,
        owner: str,
        reserved: bool,
        snapshot: SessionSnapshot,
        on_step: TurnStageSink | None,
        started_at: float,
    ) -> TurnResult:
        """Run the turn; a cancel (P0 SSE §2.1) or any crash still settles."""
        try:
            return await self._run(
                turn,
                verdict,
                outcome,
                ref,
                owner,
                reserved,
                snapshot,
                on_step,
                started_at,
            )
        except (asyncio.CancelledError, Exception) as exc:
            # `CancelledError` is a `BaseException`, not an `Exception`, since
            # Python 3.8 — it must be named explicitly here too.
            await self._settle_failed(
                outcome, ref, owner, reserved, _carried_output(exc), turn, started_at
            )
            raise

    async def _run(
        self,
        turn: TurnInput,
        verdict: AdmissionVerdict,
        outcome: TurnOutcome,
        ref: TurnRef,
        owner: str,
        reserved: bool,
        snapshot: SessionSnapshot,
        on_step: TurnStageSink | None,
        started_at: float,
    ) -> TurnResult:
        """Execute, persist, and settle the terminal path."""
        session_id = snapshot.session_id
        if verdict.replayed:
            return await self._run_replay(
                turn, verdict, outcome, ref, owner, session_id, started_at
            )
        try:
            executed = await self._execute(turn, snapshot, on_step)
        except TimeoutError:
            logger.warning("agent_turn_timeout", text=_request_text(turn)[:50])
            return await self._error_turn(
                turn,
                verdict,
                outcome,
                ref,
                owner,
                reserved,
                "timeout",
                None,
                session_id,
                started_at,
            )
        except TurnSelectionError:
            logger.warning("agent_turn_invalid_selection")
            return await self._error_turn(
                turn,
                verdict,
                outcome,
                ref,
                owner,
                reserved,
                "invalid_selection",
                None,
                session_id,
                started_at,
            )
        except InvalidInputError as exc:
            return await self._error_turn(
                turn,
                verdict,
                outcome,
                ref,
                owner,
                reserved,
                exc.error_code,
                dict(exc.details),
                session_id,
                started_at,
            )
        except ApplicationError as exc:
            return await self._error_turn(
                turn,
                verdict,
                outcome,
                ref,
                owner,
                reserved,
                exc.error_code,
                dict(exc.details),
                session_id,
                started_at,
            )
        if executed.error_code is not None:
            return await self._error_turn(
                turn,
                verdict,
                outcome,
                ref,
                owner,
                reserved,
                executed.error_code,
                executed.error_details,
                session_id,
                started_at,
            )
        if session_id is None:
            session_id = uuid4().hex
        try:
            persisted = await self._session.persist(
                session_id,
                SessionUpdate(
                    request_text=_request_text(turn),
                    response_intent=executed.intent,
                    response_status=executed.status,
                    response_success=executed.status != "error",
                    context_delta=executed.context_delta,
                    new_messages=executed.new_messages,
                    output=executed.output,
                ),
            )
        except Exception as exc:
            # The turn already ran (the model was paid): the catastrophic
            # settle-failed path must still meter the produced result.
            _carry_output(exc, executed.output)
            raise
        await self._terminal(
            outcome,
            ref,
            owner,
            reserved,
            session_id,
            executed.output,
            executed.intent,
            executed.status,
            turn,
            started_at,
            persisted.user_message_persisted,
        )
        return TurnResult(
            outcome="replayed" if verdict.replayed else "completed",
            output=executed.output,
            session_id=session_id,
            revision=verdict.revision,
            persisted=persisted,
        )

    async def _run_replay(
        self,
        turn: TurnInput,
        verdict: AdmissionVerdict,
        outcome: TurnOutcome,
        ref: TurnRef,
        owner: str,
        session_id: str | None,
        started_at: float,
    ) -> TurnResult:
        """Recover a committed turn without re-invoking the model (AC3).

        A replay returns the stored outcome payload (never calls the execution
        port) and does not re-persist the transcript, so no duplicate user
        message is created. Settlement still runs with quota off so the
        terminal audit/metering is consistent but never double-charged.
        """
        await self._terminal(
            outcome,
            ref,
            owner,
            False,
            session_id,
            verdict.outcome_payload,
            "replayed",
            "ok",
            turn,
            started_at,
            user_message_persisted=True,
        )
        return TurnResult(
            outcome="replayed",
            output=verdict.outcome_payload,
            session_id=session_id or verdict.session_id,
            revision=verdict.revision,
            persisted=None,
        )

    async def _error_turn(
        self,
        turn: TurnInput,
        verdict: AdmissionVerdict,
        outcome: TurnOutcome,
        ref: TurnRef,
        owner: str,
        reserved: bool,
        error_code: str,
        error_details: dict[str, object] | None,
        session_id: str | None,
        started_at: float,
    ) -> TurnResult:
        """A response-producing failure: persist best-effort, settle completed."""
        persisted = None
        if session_id is not None:
            try:
                persisted = await self._session.persist(
                    session_id,
                    SessionUpdate(
                        request_text=_request_text(turn),
                        response_intent="error",
                        response_status=error_code,
                        response_success=False,
                    ),
                )
            except (OSError, RuntimeError, ValueError, TypeError):
                logger.warning("agent_turn_error_persist_failed", error_code=error_code)
        await self._terminal(
            outcome,
            ref,
            owner,
            reserved,
            session_id,
            None,
            "error",
            "error",
            turn,
            started_at,
            persisted.user_message_persisted if persisted is not None else False,
        )
        return TurnResult(
            outcome="error",
            session_id=session_id or verdict.session_id,
            revision=verdict.revision,
            error_code=error_code,
            error_details=error_details,
            persisted=persisted,
        )

    async def _settle_failed(
        self,
        outcome: TurnOutcome,
        ref: TurnRef,
        owner: str,
        reserved: bool,
        output: object | None,
        turn: TurnInput,
        started_at: float,
    ) -> None:
        """Catastrophic escape: settle (completed when a response was already
        produced, else failed), then re-raise."""
        side = self._side(
            session_id=turn.session_id,
            output=output,
            intent="error",
            status="error",
            started_at=started_at,
            turn=turn,
            settle_quota=reserved,
        )
        if reserved:
            await outcome.settle(
                ref,
                owner=owner,
                outcome="completed" if output is not None else "failed",
                on_settled=lambda: self._settlement.settle(side),
            )
        else:
            await self._settlement.settle(side)

    async def _terminal(
        self,
        outcome: TurnOutcome,
        ref: TurnRef,
        owner: str,
        reserved: bool,
        session_id: str | None,
        output: object | None,
        intent: str,
        status: str,
        turn: TurnInput,
        started_at: float,
        user_message_persisted: bool,
    ) -> None:
        """Settle the terminal path exactly once (CAS win runs side effects)."""
        side = self._side(
            session_id,
            output,
            intent,
            status,
            started_at,
            turn,
            reserved,
            user_message_persisted=user_message_persisted,
        )
        if reserved:
            await outcome.settle(
                ref,
                owner=owner,
                outcome="completed",
                outcome_payload=output,
                on_settled=lambda: self._settlement.settle(side),
            )
        else:
            await self._settlement.settle(side)

    async def _admit(self, turn: TurnInput) -> AdmissionVerdict:

        return await self._outcome.admit(
            AdmissionRequest(
                identity=turn.identity,
                session_id=turn.session_id,
                turn_key=turn.turn_key,
                expected_revision=turn.expected_revision,
                session_digest=turn.session_digest,
                request_digest=turn.request_digest,
                is_byok=turn.is_byok,
            )
        )

    async def _execute(
        self,
        turn: TurnInput,
        snapshot: SessionSnapshot,
        on_step: TurnStageSink | None,
    ) -> ExecutionResult:
        if isinstance(turn.kind, TextTurn):
            if not turn.kind.text.strip():
                raise InvalidInputError(
                    "user message text must not be blank", field="text"
                )
            injected = self._detect_injection(turn.kind.text)
            if injected:
                logger.warning(
                    "input_guardrail_injection_detected",
                    length=len(turn.kind.text),
                )
            if self._guard_enabled() and injected:
                blocked = self._blocked_outcome(snapshot, turn.kind.locale)
                return ExecutionResult(
                    output=blocked,
                    context_delta=self._extract_delta(blocked),
                    intent="blocked",
                    status="blocked",
                )
            return await self._timed(
                self._execution.execute(
                    turn.kind,
                    context=snapshot.context,
                    history=snapshot.history,
                    model=turn.model,
                    on_step=on_step,
                )
            )
        return await self._timed(
            self._execution.execute(
                turn.kind,
                context=snapshot.context,
                history=(),
                model=None,
                on_step=on_step,
            )
        )

    async def _timed(self, call: Awaitable[ExecutionResult]) -> ExecutionResult:
        """Bounded execution: a turn past its deadline surfaces as a timeout."""
        if self._timeout is None:
            return await call
        future = asyncio.ensure_future(call)
        try:
            done, _ = await asyncio.wait({future}, timeout=self._timeout)
        except asyncio.CancelledError:
            _cancel_timed_result(future)
            raise
        if future in done:
            return future.result()
        _cancel_timed_result(future)
        raise TimeoutError

    def _side(
        self,
        session_id: str | None,
        output: object | None,
        intent: str,
        status: str,
        started_at: float,
        turn: TurnInput,
        settle_quota: bool,
        user_message_persisted: bool = False,
    ) -> TurnSideEffects:
        return TurnSideEffects(
            turn_key=turn.turn_key,
            result=output,
            session_id=session_id,
            user_id=turn.identity.user_id,
            user_type=turn.identity.user_type,
            is_byok=turn.is_byok,
            settle_quota=settle_quota,
            elapsed_ms=int((time.perf_counter() - started_at) * 1000),
            intent=intent,
            status=status,
            request_text=_request_text(turn),
            user_message_persisted=user_message_persisted,
        )
