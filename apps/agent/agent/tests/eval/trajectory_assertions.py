"""Deterministic per-case trajectory assertions for the L0 smoke tier (S1.13).

Each L0 case declares a set of acceptable stage chains. This module checks the
observed model-initiated tool trace against those chains with no LLM-judge call
involved: expected tool set, expected order, over-repetition of a tool, and a
per-case step ceiling derived from the longest accepted chain.

The scored evaluators in ``official_evaluators`` answer "how close was it";
these answer "is it acceptable at all", as a pass/fail the gate can act on.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from agent.tests.eval.direct_gates import TrajectoryCase


@dataclass(frozen=True)
class TrajectoryExpectation:
    """One case's observed tool trace and the chains that would accept it."""

    case_id: str
    observed: tuple[str, ...]
    accepted: tuple[tuple[str, ...], ...]

    @classmethod
    def from_case(
        cls, case: TrajectoryCase, accepted: Sequence[Sequence[str]]
    ) -> TrajectoryExpectation:
        return cls(
            case_id=case.case_id,
            observed=tuple(call.tool for call in case.tool_calls),
            accepted=tuple(tuple(chain) for chain in accepted),
        )

    @property
    def step_ceiling(self) -> int:
        return max((len(chain) for chain in self.accepted), default=0)


def trajectory_assertion_failures(
    expectations: Sequence[TrajectoryExpectation],
) -> list[str]:
    """Return one failure line per violated assertion, across all cases."""
    return [
        failure
        for expectation in expectations
        for failure in case_assertion_failures(expectation)
    ]


def case_assertion_failures(expectation: TrajectoryExpectation) -> list[str]:
    """Check set, order, over-repetition and step ceiling for a single case."""
    if not expectation.accepted:
        return []
    checks = (
        _shape_failure(expectation),
        _repetition_failure(expectation),
        _ceiling_failure(expectation),
    )
    return [failure for failure in checks if failure is not None]


def print_trajectory_assertions(
    expectations: Sequence[TrajectoryExpectation], *, enforced: bool
) -> None:
    """Print the assertion verdict even when it is report-only."""
    failures = trajectory_assertion_failures(expectations)
    mode = "enforced" if enforced else "report-only"
    print(f"\nTrajectory assertions ({mode}): {len(failures)} violation(s)")
    for failure in failures:
        print(f"  - {failure}")


def _shape_failure(expectation: TrajectoryExpectation) -> str | None:
    """Report a wrong tool set, or — when the set is right — a wrong order."""
    if expectation.observed in expectation.accepted:
        return None
    if _set_matches_any(expectation):
        return _order_message(expectation)
    return _set_message(expectation)


def _set_matches_any(expectation: TrajectoryExpectation) -> bool:
    observed = Counter(expectation.observed)
    return any(Counter(chain) == observed for chain in expectation.accepted)


def _order_message(expectation: TrajectoryExpectation) -> str:
    return (
        f"{expectation.case_id}: tool order {_render(expectation.observed)} "
        f"matches no accepted chain {_render_chains(expectation.accepted)}"
    )


def _set_message(expectation: TrajectoryExpectation) -> str:
    observed, accepted = set(expectation.observed), _closest_set(expectation)
    return (
        f"{expectation.case_id}: unexpected tools "
        f"{_render(sorted(observed - accepted))}, missing tools "
        f"{_render(sorted(accepted - observed))} "
        f"(accepted: {_render_chains(expectation.accepted)})"
    )


def _closest_set(expectation: TrajectoryExpectation) -> set[str]:
    observed = set(expectation.observed)
    return max(
        (set(chain) for chain in expectation.accepted),
        key=lambda chain: len(chain & observed),
        default=set(),
    )


def _repetition_failure(expectation: TrajectoryExpectation) -> str | None:
    allowed = _allowed_repeats(expectation)
    excessive = sorted(
        tool
        for tool, count in Counter(expectation.observed).items()
        if count > allowed.get(tool, 0)
    )
    if not excessive:
        return None
    return f"{expectation.case_id}: tool(s) called more often than any accepted chain allows: {_render(excessive)}"


def _allowed_repeats(expectation: TrajectoryExpectation) -> dict[str, int]:
    allowed: Counter[str] = Counter()
    for chain in expectation.accepted:
        allowed |= Counter(chain)
    return dict(allowed)


def _ceiling_failure(expectation: TrajectoryExpectation) -> str | None:
    if len(expectation.observed) <= expectation.step_ceiling:
        return None
    return (
        f"{expectation.case_id}: {len(expectation.observed)} model-initiated tool "
        f"calls exceed the accepted ceiling of {expectation.step_ceiling}"
    )


def _render(tools: Sequence[str]) -> str:
    return "[" + ", ".join(tools) + "]"


def _render_chains(chains: Sequence[Sequence[str]]) -> str:
    return " | ".join(_render(tuple(chain)) for chain in chains)
