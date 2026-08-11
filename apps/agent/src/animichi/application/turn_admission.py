"""TurnAdmission (TURN-2 #949, TURN-3 #951) — one durable turn reservation.

Framework-independent: no FastAPI / PydanticAI imports. The use case owns
identity-to-payer mapping, the BYOK login gate, the anonymous budget/quota
ordering, and verdict mapping; the durable single-winner reservation is
delegated to an injected :class:`TurnOutcomeStore` (``application/
turn_outcome_port``). Every reservation is granted a lease (owner + expiry) so
the caller can later drive dispatch/settle/release through :class:`TurnOutcome`.
Quota is read (never incremented) here: the increment is exactly-once
settlement owned by :class:`TurnOutcome`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

from animichi.application.admission_limits import (
    anonymous_budget_verdict,
    anonymous_quota_verdict,
)
from animichi.application.adopt_sessions import ADOPT_TURN_KEY_PREFIX
from animichi.application.errors import InvalidInputError
from animichi.application.identity import (
    UsageScope,
    is_anonymous_identity,
    scope_for_identity,
)
from animichi.application.turn_admission_port import (
    AdmissionStatus,
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import TurnOutcomeStore, TurnRef
from animichi.domain.ports import AnonQuotaCounter, UsageMeter

AdmissionRejectionReason = Literal[
    "ownership",
    "stale_revision",
    "digest_mismatch",
    "quota_exhausted",
    "budget_exhausted",
    "byok_requires_login",
    "in_flight",
    "turn_failed",
]

#: How long a reserved turn may sit before the demand-driven sweep reclaims it.
DEFAULT_LEASE_SECONDS = 300


@dataclass(frozen=True)
class AdmissionIdentity:
    """The edge-forwarded identity headers (no credential material)."""

    user_id: str | None
    user_type: str | None


@dataclass(frozen=True)
class AdmissionPolicy:
    """Numeric admission cells, consumed from ONE source.

    ``quota`` is the per-identity anonymous daily message ceiling (``None``
    or ``0`` disables); ``budget_usd`` is the global anonymous daily cost
    ceiling (``0`` disables) — the AUTH-1 identity-policy mirror, surfaced by
    ``interfaces/admission_policy.py``.
    """

    quota: int | None = None
    budget_usd: float = 0.0


@dataclass(frozen=True)
class AdmissionRequest:
    """One caller turn to admit."""

    identity: AdmissionIdentity
    turn_key: str
    session_id: str | None = None
    expected_revision: int | None = None
    session_digest: str | None = None
    is_byok: bool = False


@dataclass(frozen=True)
class AdmissionRejection:
    """A typed admission refusal with its wire-facing fields."""

    reason: AdmissionRejectionReason
    resets_at: datetime | None = None


@dataclass(frozen=True)
class AdmissionVerdict:
    """Outcome of one admission attempt.

    ``replayed`` distinguishes a completed-turn replay from a fresh
    admission; ``revision`` is the session revision to echo back to the
    caller for the next turn. ``owner``/``lease_expires_at`` carry the granted
    lease for the fresh-reservation path (``None`` on replay).
    """

    admitted: bool
    payer: UsageScope
    revision: int | None = None
    replayed: bool = False
    session_id: str | None = None
    rejection: AdmissionRejection | None = None
    owner: str | None = None
    lease_expires_at: datetime | None = None


class TurnAdmission:
    """Use case: admit one turn through the durable reservation seam."""

    def __init__(
        self,
        *,
        store: TurnOutcomeStore | None,
        policy: AdmissionPolicy,
        usage_repo: UsageMeter | None = None,
        anon_quota_repo: AnonQuotaCounter | None = None,
        now: Callable[[], datetime] | None = None,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> None:
        self._store = store
        self._policy = policy
        self._usage_repo = usage_repo
        self._anon_quota_repo = anon_quota_repo
        self._now = now or (lambda: datetime.now(UTC))
        self._lease_seconds = lease_seconds

    async def __call__(self, request: AdmissionRequest) -> AdmissionVerdict:
        if not request.turn_key.strip():
            raise InvalidInputError(
                "admission turn_key must not be blank", field="turn_key"
            )
        if request.turn_key.startswith(ADOPT_TURN_KEY_PREFIX):
            raise InvalidInputError(
                "admission turn_key uses the reserved adopt: namespace",
                field="turn_key",
            )
        payer = scope_for_identity(
            request.identity.user_id,
            request.identity.user_type,
            is_byok=request.is_byok,
        )
        if request.is_byok and (
            request.identity.user_id is None
            or is_anonymous_identity(
                request.identity.user_id, request.identity.user_type
            )
        ):
            return _rejected("byok_requires_login", payer)
        if payer == "anon":
            budget_rejected = await self._budget_verdict(payer)
            if budget_rejected is not None:
                return budget_rejected

        outcome = await self._reserve(request, payer)
        if outcome.status != "admitted":
            return _outcome_verdict(outcome, payer)
        if payer == "anon":
            quota_rejected = await self._quota_verdict(request, outcome)
            if quota_rejected is not None:
                return quota_rejected
        return AdmissionVerdict(
            admitted=True,
            payer=payer,
            revision=outcome.revision,
            session_id=outcome.session_id,
            owner=outcome.owner,
            lease_expires_at=outcome.lease_expires_at,
        )

    async def _budget_verdict(self, payer: UsageScope) -> AdmissionVerdict | None:
        budget = await anonymous_budget_verdict(
            self._usage_repo, budget_usd=self._policy.budget_usd
        )
        return _rejected("budget_exhausted", payer) if budget.is_exhausted else None

    async def _quota_verdict(
        self, request: AdmissionRequest, outcome: ReservationOutcome
    ) -> AdmissionVerdict | None:
        quota = await anonymous_quota_verdict(
            self._anon_quota_repo,
            anon_id=request.identity.user_id or "",
            quota=self._policy.quota,
        )
        if not quota.is_exhausted:
            return None
        await self._fail(request, outcome)
        return AdmissionVerdict(
            admitted=False,
            payer="anon",
            session_id=outcome.session_id,
            rejection=AdmissionRejection("quota_exhausted", resets_at=quota.resets_at),
        )

    async def _reserve(
        self, request: AdmissionRequest, payer: UsageScope
    ) -> ReservationOutcome:
        if self._store is None:
            revision = (request.expected_revision or 0) + 1
            return ReservationOutcome(
                status="admitted",
                session_id=request.session_id,
                revision=revision,
                owner=uuid4().hex,
                lease_expires_at=self._now() + timedelta(seconds=self._lease_seconds),
            )
        return await self._store.reserve(
            ReserveRequest(
                session_id=request.session_id,
                turn_key=request.turn_key,
                identity_id=request.identity.user_id,
                payer=payer,
                expected_revision=request.expected_revision,
                session_digest=request.session_digest,
                owner=uuid4().hex,
                lease_expires_at=self._now() + timedelta(seconds=self._lease_seconds),
            )
        )

    async def _fail(
        self, request: AdmissionRequest, outcome: ReservationOutcome
    ) -> None:
        if self._store is not None and outcome.owner is not None:
            await self._store.release(
                TurnRef(
                    session_id=outcome.session_id or request.session_id,
                    turn_key=request.turn_key,
                ),
                owner=outcome.owner,
            )


def _outcome_verdict(
    outcome: ReservationOutcome, payer: UsageScope
) -> AdmissionVerdict:
    if outcome.status == "replay_completed":
        return AdmissionVerdict(
            admitted=True,
            payer=payer,
            revision=outcome.revision,
            replayed=True,
            session_id=outcome.session_id,
        )
    return _rejected(
        _rejection_for(outcome.status), payer, session_id=outcome.session_id
    )


def _rejection_for(status: AdmissionStatus) -> AdmissionRejectionReason:
    if status == "in_flight":
        return "in_flight"
    if status == "turn_failed":
        return "turn_failed"
    if status == "ownership":
        return "ownership"
    if status == "stale_revision":
        return "stale_revision"
    return "digest_mismatch"


def _rejected(
    reason: AdmissionRejectionReason,
    payer: UsageScope,
    *,
    session_id: str | None = None,
    resets_at: datetime | None = None,
) -> AdmissionVerdict:
    return AdmissionVerdict(
        admitted=False,
        payer=payer,
        session_id=session_id,
        rejection=AdmissionRejection(reason, resets_at=resets_at),
    )
