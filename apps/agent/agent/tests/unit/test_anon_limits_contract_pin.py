"""Pin the Python anonymous-limit codes to `packages/contract` (issue #282).

`ANON_BUDGET_EXHAUSTED_CODE` (#274 S1.8) and `ANON_QUOTA_EXHAUSTED_CODE` (#282
S1.10) are wire literals three tiers must agree on: the container ingress
emits them, the web client classifies them into D11/D12. Python cannot import
the TypeScript module directly, so — like the worker-mirror pin in
`test_anonymous_docs_consistency.py` — this test reads the contract source as
text and asserts the literal is present, the same three-mirror pattern
`packages/contract/AGENTS.md` documents for the catalog error registry.

The codes and the `AnonQuotaExhaustedData`/`AnonLimitErrorEnvelope` shapes
live in `error-registry.ts` (issue #282's frontend half, #468, folded them
into the existing generic error-registry module rather than a standalone
`anon-limits.ts` — this pin follows that placement).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agent.interfaces.anon_quota import ANON_QUOTA_EXHAUSTED_CODE, QUOTA_RESETS_AT_FIELD
from agent.interfaces.usage_metering import ANON_BUDGET_EXHAUSTED_CODE

CONTRACT = (
    Path(__file__).resolve().parents[5]
    / "packages"
    / "contract"
    / "src"
    / "error-registry.ts"
)


@pytest.fixture(scope="module")
def contract_source() -> str:
    return CONTRACT.read_text(encoding="utf-8")


def test_the_budget_code_matches_the_contract_export(contract_source: str) -> None:
    assert (
        f'ANON_BUDGET_EXHAUSTED_CODE = "{ANON_BUDGET_EXHAUSTED_CODE}"'
        in contract_source
    )


def test_the_quota_code_matches_the_contract_export(contract_source: str) -> None:
    assert (
        f'ANON_QUOTA_EXHAUSTED_CODE = "{ANON_QUOTA_EXHAUSTED_CODE}"' in contract_source
    )


def test_the_two_wire_codes_stay_distinct() -> None:
    assert ANON_QUOTA_EXHAUSTED_CODE != ANON_BUDGET_EXHAUSTED_CODE


def test_the_reset_field_name_matches_the_contract_payload_shape(
    contract_source: str,
) -> None:
    """Anchored to the zod field declaration (`quota_resets_at: z.`), not just
    the bare key — a looser anchor would false-negative on a stray prose
    mention of the field and would go stale silently on a prettier reformat
    of the surrounding object literal (review follow-up)."""
    assert f"{QUOTA_RESETS_AT_FIELD}: z." in contract_source
