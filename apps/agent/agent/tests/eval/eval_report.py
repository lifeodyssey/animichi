"""Reporting helpers for four-layer eval aggregate scores."""

from __future__ import annotations

from collections.abc import Sequence

from pydantic_evals.reporting import ReportCaseAggregate


def collect_scores(
    avg: ReportCaseAggregate, metric_names: Sequence[str]
) -> dict[str, float]:
    """Pull the named metric averages out of a report ``averages()`` object."""
    missing = [name for name in metric_names if name not in avg.scores]
    if missing:
        available = ", ".join(sorted(avg.scores)) or "<none>"
        raise ValueError(
            f"Missing metric(s): {', '.join(missing)}. Available: {available}"
        )
    return {name: float(avg.scores[name]) for name in metric_names}


def print_scores(
    scores: dict[str, float],
    model_id: str,
    *,
    case_count: int,
    l3_on: bool,
    tier: str | None = None,
) -> None:
    """Print a per-metric score table."""
    print(f"\n{'=' * 60}")
    print(f"  Model:    {model_id}")
    if tier is not None:
        print(f"  Tier:     {tier}")
    print(f"  Cases:    {case_count}")
    print(f"  L3 judge: {'on' if l3_on else 'off'}")
    for name, value in scores.items():
        print(f"  {name:<22}{value:.1%}")
    print(f"{'=' * 60}")
