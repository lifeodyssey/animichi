"""Execution-tier helpers for model-backed evals."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ConfigDict
from pydantic_evals.reporting import EvaluationReport, ReportCase, ReportCaseFailure

from agent.agents.agent_result import AgentResult
from agent.agents.runtime_deps import TitleTranslator, WebSearcher
from agent.interfaces.public_api import detect_language

T = TypeVar("T")
InputsT = TypeVar("InputsT")
OutputT = TypeVar("OutputT")
MetadataT = TypeVar("MetadataT")


class UsageRow(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    requests: int = 0


class UsageSummary(UsageRow):
    cases_with_usage: int = 0


class CaseRow(BaseModel):
    id: str | None = None
    scores: dict[str, float] | None = None
    reasons: dict[str, str] | None = None
    error: str | None = None
    intent: str | None = None
    message: str | None = None
    message_locale: str | None = None
    steps: list[str] | None = None
    step_count: int | None = None
    query: str | None = None
    locale: str | None = None
    expected_stages: list[str] | None = None
    usage: UsageRow | None = None


class ResultsPayload(BaseModel):
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
    usage: UsageSummary = UsageSummary()


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


def cap_cases(cases: list[T], cap: int | None) -> list[T]:
    if cap is None or cap <= 0 or cap >= len(cases):
        return cases
    return [cases[index] for index in _even_indices(len(cases), cap)]


def read_max_cases() -> int | None:
    raw = os.environ.get("EVAL_MAX_CASES")
    if raw is None or raw in ("", "0"):
        return None
    value = int(raw)
    return value if value > 0 else None


def is_fullstack() -> bool:
    return os.environ.get("EVAL_FULLSTACK") == "1"


def results_filename(layer: str, model_id: str) -> str:
    return f"{layer}_{_safe_model(model_id)}.json"


def collect_case_scores(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
) -> dict[str, dict[str, float]]:
    return {str(case.name): _case_scores(case) for case in report.cases}


def error_rate_message(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
) -> str | None:
    total = len(report.cases) + len(report.failures)
    errored = len(report.failures)
    error_rate = errored / total if total > 0 else 1.0
    if error_rate <= 0.20:
        return None
    return _format_error_rate(errored, total, error_rate)


def build_results_payload(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
    *,
    model_id: str,
    dataset: str,
    tier: str,
    case_count: int,
    scores: dict[str, float],
) -> ResultsPayload:
    return ResultsPayload(
        model=model_id,
        dataset=dataset,
        tier=tier,
        case_count=case_count,
        evaluated_count=len(report.cases),
        errored_count=len(report.failures),
        scores=scores,
        cases=_case_rows(report),
        usage=_aggregate_usage(report),
    )


def save_results(
    *,
    results_dir: Path,
    layer: str,
    model_id: str,
    payload: ResultsPayload,
) -> Path:
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
    value = getattr(score, "value", score)
    if isinstance(value, int | float | str | bytes | bytearray):
        return float(value)
    raise TypeError(f"Score is not numeric: {value!r}")


def _case_scores(case: ReportCase[InputsT, OutputT, MetadataT]) -> dict[str, float]:
    scores = case.scores
    if scores is None:
        return {}
    return {str(name): _score_value(score) for name, score in scores.items()}


def _case_rows(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
) -> list[CaseRow]:
    rows = [_success_row(case) for case in report.cases]
    rows.extend(_failure_row(failure) for failure in report.failures)
    return rows


def _success_row(case: ReportCase[InputsT, OutputT, MetadataT]) -> CaseRow:
    return _case_row(
        str(case.name),
        _case_scores(case),
        _case_reasons(case),
        None,
        case.output,
        case.inputs,
        case.metadata,
    )


def _failure_row(
    failure: ReportCaseFailure[InputsT, OutputT, MetadataT],
) -> CaseRow:
    return _case_row(
        str(failure.name),
        None,
        None,
        failure.error_message,
        None,
        failure.inputs,
        failure.metadata,
    )


def _case_row(
    case_id: str,
    scores: dict[str, float] | None,
    reasons: dict[str, str] | None,
    error: str | None,
    output: object | None,
    inputs: object | None,
    metadata: object | None,
) -> CaseRow:
    return CaseRow(
        id=case_id,
        scores=scores,
        reasons=reasons,
        error=error,
        intent=_output_intent(output),
        message=_output_message(output),
        message_locale=_output_locale(output),
        steps=_output_steps(output),
        step_count=_output_step_count(output),
        query=_input_query(inputs),
        locale=_input_locale(inputs),
        expected_stages=_expected_stages(metadata),
        usage=_output_usage(output),
    )


def _output_usage(output: object | None) -> UsageRow | None:
    if not isinstance(output, AgentResult) or output.usage is None:
        return None
    return UsageRow(
        input_tokens=output.usage.input_tokens,
        output_tokens=output.usage.output_tokens,
        requests=output.usage.requests,
    )


def _aggregate_usage(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
) -> UsageSummary:
    usages = [_output_usage(case.output) for case in report.cases]
    present = [usage for usage in usages if usage is not None]
    return UsageSummary(
        input_tokens=sum(usage.input_tokens for usage in present),
        output_tokens=sum(usage.output_tokens for usage in present),
        requests=sum(usage.requests for usage in present),
        cases_with_usage=len(present),
    )


def _case_reasons(
    case: ReportCase[InputsT, OutputT, MetadataT],
) -> dict[str, str] | None:
    scores = case.scores
    if scores is None:
        return None
    reasons = {
        str(name): reason
        for name, score in scores.items()
        if (reason := _score_reason(score))
    }
    return reasons or None


def _score_reason(score: object) -> str | None:
    reason = getattr(score, "reason", None)
    return reason if isinstance(reason, str) else None


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
