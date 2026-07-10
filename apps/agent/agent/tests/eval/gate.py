"""Statistical baseline gate for eval reports."""

from __future__ import annotations

import logging
import random
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

logger = logging.getLogger(__name__)
CaseScores = Mapping[str, Mapping[str, float]]


class BaselineRecord(BaseModel):
    """Schema-v2 baseline with aggregate and per-case scores."""

    model_config = ConfigDict(frozen=True)

    schema_version: int = 2
    model: str
    dataset: str
    tier: str
    repeat: int = 1
    case_count: int
    evaluated_count: int
    scores: dict[str, float]
    cases: dict[str, dict[str, float]]


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
) -> BaselineRecord | None:
    path = baseline_path(layer, model_id, baselines_dir)
    if not path.exists():
        _warn_missing(layer, model_id, path)
        return None
    record = _load_record(path, layer, model_id)
    if record is None or _is_stale(record, expected_case_count, layer, model_id):
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


def _metric_failures(ctx: _GateContext) -> list[str | None]:
    return [_metric_failure(metric, ctx) for metric in _baseline_metrics(ctx.baseline)]


def _load_record(path: Path, layer: str, model_id: str) -> BaselineRecord | None:
    try:
        return BaselineRecord.model_validate_json(path.read_text())
    except ValidationError as exc:
        logger.warning(
            "Invalid baseline for %s/%s at %s: %s", layer, model_id, path, exc
        )
        return None


def _warn_missing(layer: str, model_id: str, path: Path) -> None:
    logger.warning("Missing baseline for %s/%s at %s", layer, model_id, path)


def _is_stale(
    record: BaselineRecord,
    expected: int | None,
    layer: str,
    model_id: str,
) -> bool:
    if expected is None:
        return False
    if _case_count_stale(record, expected, layer, model_id):
        return True
    return _evaluated_count_low(record, expected, layer, model_id)


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
    return sorted({metric for scores in baseline.cases.values() for metric in scores})


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


def _failure_if_regression(
    metric: str,
    deltas: list[float],
    lower: float,
    upper: float,
    options: _GateOptions,
) -> str | None:
    if lower <= options.min_effect:
        return None
    return _describe_failure(metric, _mean(deltas), lower, upper, options, len(deltas))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _describe_failure(
    metric: str,
    mean_delta: float,
    lower: float,
    upper: float,
    options: _GateOptions,
    n: int,
) -> str:
    return f"{metric}: mean_delta={mean_delta:.4f}, ci{options.confidence:.0%}=[{lower:.4f}, {upper:.4f}], n={n}"


def _warn_few_pairs(metric: str, paired: int, min_paired: int) -> None:
    logger.warning(
        "Skipping %s: only %d paired cases, need %d", metric, paired, min_paired
    )
