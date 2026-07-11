"""Execution-tier helpers for model-backed evals."""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, TypeVar

from pydantic import BaseModel, ConfigDict

from agent.agents.agent_result import AgentResult
from agent.agents.runtime_deps import TitleTranslator, WebSearcher
from agent.interfaces.public_api import detect_language

T = TypeVar("T")


class CaseRow(BaseModel):
    """Persisted per-case eval result row."""

    id: str | None = None
    scores: dict[str, float] | None = None
    error: str | None = None
    intent: str | None = None
    message: str | None = None
    message_locale: str | None = None
    steps: list[str] | None = None
    step_count: int | None = None
    query: str | None = None
    locale: str | None = None
    expected_stages: list[str] | None = None


class ResultsPayload(BaseModel):
    """Schema-v1 persisted eval results for reproducible post-hoc analysis."""

    model_config = ConfigDict(frozen=True)

    model: str
    dataset: str
    tier: str
    repeat: int = 1
    retries: int = 0
    case_count: int
    evaluated_count: int
    errored_count: int
    scores: dict[str, float]
    cases: list[CaseRow]


@dataclass(frozen=True)
class EvalWebMocks:
    web_searcher: WebSearcher | None = None
    title_translator: TitleTranslator | None = None


@dataclass(frozen=True)
class EvalTierTarget:
    db: object
    catalog_factory: Callable[[], object]
    layer: str
    tier: str
    source: str
    web_mocks: EvalWebMocks = field(default_factory=EvalWebMocks)


def trajectory_web_mocks() -> EvalWebMocks:
    from agent.tests.eval.mock_web import MockTitleTranslator, MockWebSearcher

    return EvalWebMocks(MockWebSearcher(), MockTitleTranslator())


class _EvalCaseResult(Protocol):
    name: str
    scores: Mapping[str, object] | None
    output: object | None
    inputs: object | None
    expected_output: object | None


class _EvalCaseFailure(Protocol):
    name: str
    error_message: str
    inputs: object | None
    expected_output: object | None


class _EvalReport(Protocol):
    cases: list[_EvalCaseResult]
    failures: list[_EvalCaseFailure]


def cap_cases(cases: list[T], cap: int | None) -> list[T]:
    """Return an even-spread deterministic subset, preserving order."""
    if cap is None or cap <= 0 or cap >= len(cases):
        return cases
    return [cases[index] for index in _even_indices(len(cases), cap)]


def read_max_cases() -> int | None:
    """Read EVAL_MAX_CASES; unset/0 means full dataset."""
    raw = os.environ.get("EVAL_MAX_CASES")
    if raw in (None, "", "0"):
        return None
    value = int(raw)
    return value if value > 0 else None


def is_fullstack() -> bool:
    """Return whether the full-stack eval tier is enabled."""
    return os.environ.get("EVAL_FULLSTACK") == "1"


def results_filename(layer: str, model_id: str) -> str:
    """Build the tier-aware results filename for a layer/model pair."""
    return f"{layer}_{_safe_model(model_id)}.json"


def collect_case_scores(report: _EvalReport) -> dict[str, dict[str, float]]:
    """Collect per-case evaluator scores from a pydantic-evals report."""
    return {str(case.name): _case_scores(case) for case in report.cases}


def error_rate_message(report: _EvalReport) -> str | None:
    """Return the standard high-error-rate message when the run is unhealthy."""
    total = len(report.cases) + len(report.failures)
    errored = len(report.failures)
    error_rate = errored / total if total > 0 else 1.0
    if error_rate <= 0.20:
        return None
    return _format_error_rate(errored, total, error_rate)


def build_results_payload(
    report: _EvalReport,
    *,
    model_id: str,
    dataset: str,
    tier: str,
    case_count: int,
    scores: dict[str, float],
) -> ResultsPayload:
    """Build the persisted results payload for a report."""
    return ResultsPayload(
        model=model_id,
        dataset=dataset,
        tier=tier,
        case_count=case_count,
        evaluated_count=len(report.cases),
        errored_count=len(report.failures),
        scores=scores,
        cases=_case_rows(report),
    )


def save_results(
    *,
    results_dir: Path,
    layer: str,
    model_id: str,
    payload: ResultsPayload,
) -> Path:
    """Persist results JSON to the layer/model-specific file."""
    results_dir.mkdir(exist_ok=True)
    path = results_dir / results_filename(layer, model_id)
    path.write_text(payload.model_dump_json(indent=2) + "\n")
    print(f"\nPer-case results saved to: {path}")
    return path


def _even_indices(length: int, cap: int) -> list[int]:
    if cap == 1:
        return [0]
    last = length - 1
    return [round(index * last / (cap - 1)) for index in range(cap)]


def _safe_model(model_id: str) -> str:
    return model_id.replace(":", "-").replace("@", "-").replace("/", "-")


def _format_error_rate(errored: int, total: int, error_rate: float) -> str:
    return (
        f"{errored}/{total} cases errored ({error_rate:.0%}). "
        "Check API key and model endpoint."
    )


def _score_value(score: object) -> float:
    return float(getattr(score, "value", score))


def _case_scores(case: _EvalCaseResult) -> dict[str, float]:
    scores = case.scores
    if scores is None:
        return {}
    return {str(name): _score_value(score) for name, score in scores.items()}


def _case_rows(report: _EvalReport) -> list[CaseRow]:
    rows = [_success_row(case) for case in report.cases]
    rows.extend(_failure_row(failure) for failure in report.failures)
    return rows


def _success_row(case: _EvalCaseResult) -> CaseRow:
    return _case_row(
        str(case.name),
        _case_scores(case),
        _case_error(case),
        case.output,
        case.inputs,
        case.expected_output,
    )


def _failure_row(failure: _EvalCaseFailure) -> CaseRow:
    return _case_row(
        str(failure.name),
        None,
        failure.error_message,
        None,
        failure.inputs,
        failure.expected_output,
    )


def _case_row(
    case_id: str,
    scores: dict[str, float] | None,
    error: str | None,
    output: object | None,
    inputs: object | None,
    expected: object | None,
) -> CaseRow:
    return CaseRow(
        id=case_id,
        scores=scores,
        error=error,
        intent=_output_intent(output),
        message=_output_message(output),
        message_locale=_output_locale(output),
        steps=_output_steps(output),
        step_count=_output_step_count(output),
        query=_input_query(inputs),
        locale=_input_locale(inputs),
        expected_stages=_expected_stages(expected),
    )


def _case_error(case: _EvalCaseResult) -> str | None:
    error = getattr(case, "task_error", None)
    return str(error) if error else None


def _output_intent(output: object | None) -> str | None:
    return output.intent if isinstance(output, AgentResult) else None


def _output_message(output: object | None) -> str | None:
    if not isinstance(output, AgentResult):
        return None
    return output.message[:200]


def _output_locale(output: object | None) -> str | None:
    message = _output_message(output)
    return detect_language(message) if message else None


def _output_steps(output: object | None) -> list[str] | None:
    if not isinstance(output, AgentResult):
        return None
    return [step.tool for step in output.steps]


def _output_step_count(output: object | None) -> int | None:
    return len(output.steps) if isinstance(output, AgentResult) else None


def _input_query(inputs: object | None) -> str | None:
    query = getattr(inputs, "query", None)
    return query[:100] if isinstance(query, str) else None


def _input_locale(inputs: object | None) -> str | None:
    locale = getattr(inputs, "locale", None)
    return locale if isinstance(locale, str) else None


def _expected_stages(expected: object | None) -> list[str] | None:
    stages = getattr(expected, "acceptable_stages", None)
    return [str(stage) for stage in stages] if isinstance(stages, list) else None
