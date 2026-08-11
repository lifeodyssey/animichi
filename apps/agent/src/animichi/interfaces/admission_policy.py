"""Admission policy — ONE source for the numeric admission cells (TURN-2 #949).

The agent's admission layer consumes a single :class:`AdmissionPolicy` built
from :class:`~animichi.config.settings.Settings`. The AUTH-1 identity matrix
(``packages/contract/src/identity-contract.ts``) is the canonical owner of
these numbers for the deployed edge; the anonymous cells are mirrored here so
an agent-side hardcode can never drift from the contract — the pin lives in
``test_auth1_identity_policy_pin.py``.
"""

from __future__ import annotations

from animichi.application.turn_admission import AdmissionPolicy
from animichi.config.settings import Settings

#: AUTH-1 DEFAULT_IDENTITY_POLICY.anonymous mirrors (identity-contract.ts).
#: The values are `None`/`0` here because the agent's ops surface already
#: decides whether a control is enabled; the mirror pins the contract's
#: canonical anonymous cells so any divergence fails the pin test.
AUTH1_ANONYMOUS_DAILY_MESSAGE_QUOTA = 20
AUTH1_ANONYMOUS_DAILY_COST_BUDGET_USD = 5.0


def admission_policy(settings: Settings) -> AdmissionPolicy:
    """Resolve the numeric admission cells from one source (settings).

    ``None``/``0`` cells keep their existing "control disabled" convention;
    the AUTH-1 mirror documents the deployed anonymous defaults for ops.
    """
    return AdmissionPolicy(
        quota=settings.anon_daily_message_quota,
        budget_usd=settings.anon_daily_cost_budget_usd,
    )
