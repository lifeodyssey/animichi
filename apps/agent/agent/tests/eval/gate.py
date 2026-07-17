"""Statistical baseline gate for eval reports."""

from __future__ import annotations

import logging
import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

logger = logging.getLogger(__name__)
CaseScores = Mapping[str, Mapping[str, float]]


class BaselineRecord(BaseModel):
    """Schema-v2 baseline with aggregate and per-case scores."""

    model_config = ConfigDict(frozen=True)

    schema_version: Literal[2] = 2
    model: str
    dataset: str
    tier: str
    repeat: int = 1
    case_count: int
    evaluated_count: int
    errored_count: int = 0
    scores: dict[str, float]
    cases: dict[str, dict[str, float]]
    note: str | None = None


@dataclass(frozen=True)
class _GateOptions:
    iterations: int
    confidence: float
    min_effect: float
    min_paired: int


@dataclass(frozen=True)
class _GateContext:
    current_cases: CaseScores
    baseline: BaselineRecord
    rng: random.Random
    options: _GateOptions


def baseline_path(layer: str, model_id: str, baselines_dir: Path) -> Path:
    safe_model = model_id.replace(":", "-").replace("@", "-").replace("/", "-")
    return baselines_dir / f"{layer}_{safe_model}.json"


def read_baseline_record(
    layer: str,
    model_id: str,
    *,
    baselines_dir: Path,
    expected_case_count: int | None = None,
    expected_metrics: Sequence[str] | None = None,
) -> BaselineRecord | None:
    path = baseline_path(layer, model_id, baselines_dir)
    if not path.exists():
        _warn_missing(layer, model_id, path)
        return None
    record = _load_record(path, layer, model_id)
    if record is None or _is_stale(
        record, expected_case_count, expected_metrics, layer, model_id
    ):
        return None
    return record


def write_baseline_record(
    record: BaselineRecord,
    *,
    layer: str,
    model_id: str,
    baselines_dir: Path,
) -> Path:
    baselines_dir.mkdir(parents=True, exist_ok=True)
    path = baseline_path(layer, model_id, baselines_dir)
    path.write_text(record.model_dump_json(indent=2) + "\n")
    return path


def bootstrap_gate(
    current_cases: CaseScores,
    baseline: BaselineRecord,
    *,
    iterations: int = 2000,
    confidence: float = 0.95,
    seed: int = 309,
    min_effect: float = 0.01,
    min_paired: int = 10,
) -> list[str]:
    options = _GateOptions(iterations, confidence, min_effect, min_paired)
    ctx = _GateContext(current_cases, baseline, random.Random(seed), options)
    failures = _metric_failures(ctx)
    return [failure for failure in failures if failure is not None]


def error_rate_gate(
    current_errored: int,
    current_total: int,
    baseline: BaselineRecord | None,
    *,
    iterations: int = 2000,
    confidence: float = 0.95,
    seed: int = 309,
    min_effect: float = 0.02,
) -> list[str]:
    ceiling_failure = _absolute_error_rate_failure(current_errored, current_total)
    if ceiling_failure is not None:
        return [ceiling_failure]
    if baseline is None:
        return []
    if _has_zero_error_total(current_total, baseline):
        logger.warning("Skipping error_rate: zero total cases")
        return []
    samples = _error_rate_samples(
        current_errored, current_total, baseline, iterations, seed
    )
    failure = _error_rate_failure(samples, confidence, min_effect)
    return [] if failure is None else [failure]


def _absolute_error_rate_failure(errored: int, total: int) -> str | None:
    """Fail uncapped runs when more than 20% of cases error, baseline-independent."""
    error_rate = errored / total if total > 0 else 1.0
    if error_rate <= 0.20:
        return None
    return (
        f"{errored}/{total} cases errored ({error_rate:.0%}). "
        "Check API key and model endpoint."
    )


def _metric_failures(ctx: _GateContext) -> list[str | None]:
    return [_metric_failure(metric, ctx) for metric in _baseline_metrics(ctx.baseline)]


def _load_record(path: Path, layer: str, model_id: str) -> BaselineRecord | None:
    try:
        return BaselineRecord.model_validate_json(path.read_text())
    except ValidationError as exc:
        _warn_invalid_baseline(path, layer, model_id, exc)
        return None


def _warn_invalid_baseline(
    path: Path, layer: str, model_id: str, exc: ValidationError
) -> None:
    logger.warning("Invalid baseline for %s/%s at %s: %s", layer, model_id, path, exc)


def _warn_missing(layer: str, model_id: str, path: Path) -> None:
    logger.warning("Missing baseline for %s/%s at %s", layer, model_id, path)


def _is_stale(
    record: BaselineRecord,
    expected: int | None,
    expected_metrics: Sequence[str] | None,
    layer: str,
    model_id: str,
) -> bool:
    if expected is not None and _case_count_stale(record, expected, layer, model_id):
        return True
    if expected is not None and _evaluated_count_low(record, expected, layer, model_id):
        return True
    return _metric_vocabulary_stale(record, expected_metrics, layer, model_id)


def _metric_vocabulary_stale(
    record: BaselineRecord,
    expected: Sequence[str] | None,
    layer: str,
    model: str,
) -> bool:
    if expected is None:
        return False
    expected_set = set(expected)
    aggregate_current = set(record.scores) == expected_set
    cases_current = _case_metrics(record) == expected_set
    if aggregate_current and cases_current:
        return False
    logger.warning("Stale baseline for %s/%s: metric vocabulary changed", layer, model)
    return True


def _case_count_stale(
    record: BaselineRecord, expected: int, layer: str, model: str
) -> bool:
    if record.case_count == expected:
        return False
    _warn_stale_case_count(layer, model, expected, record.case_count)
    return True


def _evaluated_count_low(
    record: BaselineRecord, expected: int, layer: str, model: str
) -> bool:
    if record.evaluated_count >= expected * 0.80:
        return False
    _warn_low_evaluated(layer, model, record.evaluated_count, expected)
    return True


def _warn_stale_case_count(layer: str, model: str, expected: int, actual: int) -> None:
    logger.warning(
        "Stale baseline for %s/%s: expected %d cases, found %d",
        layer,
        model,
        expected,
        actual,
    )


def _warn_low_evaluated(layer: str, model: str, actual: int, expected: int) -> None:
    logger.warning(
        "Baseline for %s/%s has too few evaluated cases: %d < 80%% of %d",
        layer,
        model,
        actual,
        expected,
    )


def _baseline_metrics(baseline: BaselineRecord) -> list[str]:
    return sorted(_case_metrics(baseline).union(baseline.scores))


def _case_metrics(baseline: BaselineRecord) -> set[str]:
    return {metric for scores in baseline.cases.values() for metric in scores}


def _metric_failure(metric: str, ctx: _GateContext) -> str | None:
    deltas = _paired_deltas(ctx, metric)
    if len(deltas) < ctx.options.min_paired:
        _warn_few_pairs(metric, len(deltas), ctx.options.min_paired)
        return None
    lower, upper = _bootstrap_ci(deltas, ctx)
    return _failure_if_regression(metric, deltas, lower, upper, ctx.options)


def _paired_deltas(ctx: _GateContext, metric: str) -> list[float]:
    case_ids = sorted(set(ctx.baseline.cases).intersection(ctx.current_cases))
    return [
        _delta(ctx, metric, case_id)
        for case_id in case_ids
        if _has_metric(ctx, metric, case_id)
    ]


def _has_metric(ctx: _GateContext, metric: str, case_id: str) -> bool:
    return (
        metric in ctx.baseline.cases[case_id] and metric in ctx.current_cases[case_id]
    )


def _delta(ctx: _GateContext, metric: str, case_id: str) -> float:
    return ctx.baseline.cases[case_id][metric] - ctx.current_cases[case_id][metric]


def _bootstrap_ci(
    deltas: list[float],
    ctx: _GateContext,
) -> tuple[float, float]:
    samples = sorted(
        _sample_mean(deltas, ctx.rng) for _ in range(max(ctx.options.iterations, 1))
    )
    tail = (1.0 - ctx.options.confidence) / 2.0
    return _percentile(samples, tail), _percentile(samples, 1.0 - tail)


def _sample_mean(deltas: list[float], rng: random.Random) -> float:
    total = 0.0
    for _ in deltas:
        total += rng.choice(deltas)
    return total / len(deltas)


def _percentile(values: list[float], quantile: float) -> float:
    index = int(quantile * (len(values) - 1))
    return values[index]


def _error_rate_samples(
    current_errored: int,
    current_total: int,
    baseline: BaselineRecord,
    iterations: int,
    seed: int,
) -> list[float]:
    rng = random.Random(seed)
    current = _error_indicators(current_errored, current_total)
    total = baseline.evaluated_count + baseline.errored_count
    prior = _error_indicators(baseline.errored_count, total)
    return sorted(
        _sample_mean(current, rng) - _sample_mean(prior, rng)
        for _ in range(max(iterations, 1))
    )


def _error_indicators(errored: int, total: int) -> list[float]:
    return [1.0] * errored + [0.0] * (total - errored)


def _has_zero_error_total(current_total: int, baseline: BaselineRecord) -> bool:
    baseline_total = baseline.evaluated_count + baseline.errored_count
    return current_total <= 0 or baseline_total <= 0


def _error_rate_failure(
    samples: list[float],
    confidence: float,
    min_effect: float,
) -> str | None:
    lower, upper = _error_rate_ci(samples, confidence)
    if lower <= min_effect:
        return None
    return _format_error_rate_failure(samples, lower, upper)


def _error_rate_ci(samples: list[float], confidence: float) -> tuple[float, float]:
    tail = (1.0 - confidence) / 2.0
    return _percentile(samples, tail), _percentile(samples, 1.0 - tail)


def _format_error_rate_failure(
    samples: list[float],
    lower: float,
    upper: float,
) -> str:
    return f"error_rate: mean_delta={_mean(samples):.4f}, ci=[{lower:.4f}, {upper:.4f}]"


def _failure_if_regression(
    metric: str,
    deltas: list[float],
    lower: float,
    upper: float,
    options: _GateOptions,
) -> str | None:
    if lower <= options.min_effect:
        return None
    return (
        f"{metric}: mean_delta={_mean(deltas):.4f}, "
        f"ci=[{lower:.4f}, {upper:.4f}], n={len(deltas)}"
    )


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _warn_few_pairs(metric: str, paired: int, min_paired: int) -> None:
    logger.warning(
        "Skipping %s: only %d paired cases, need %d", metric, paired, min_paired
    )
