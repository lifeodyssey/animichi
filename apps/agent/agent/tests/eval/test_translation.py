"""Translation eval — validates anime title and place name translation quality.

Tests translate_title against a dataset of known correct translations.
Checks both exact match and fuzzy match (for minor variations).

Usage:
    uv run pytest agent/tests/eval/test_translation.py -v -m integration --no-cov
"""

from __future__ import annotations

import json
from collections.abc import Callable, Coroutine, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import pytest
from dotenv import load_dotenv
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from agent.tests.eval.gate import (
    BaselineRecord,
    bootstrap_gate,
    read_baseline_record,
    write_baseline_record,
)

load_dotenv(Path(__file__).parents[3] / ".env")

# ── Case types ───────────────────────────────────────────────────────


@dataclass
class TranslationInput:
    title: str
    target_locale: str


@dataclass
class TranslationOutput:
    translated: str
    source: str
    confidence: float


@dataclass
class TranslationExpected:
    expected: str


# ── Task factory (closure replaces _STATE global) ────────────────────

TaskFn = Callable[[TranslationInput], Coroutine[object, object, TranslationOutput]]


class _EvalCaseResult(Protocol):
    name: str
    scores: Mapping[str, object] | None


class _EvalReport(Protocol):
    cases: list[_EvalCaseResult]


def make_translation_task(db: object) -> TaskFn:
    """Create a translation eval task with db bound via closure."""

    async def task(inp: TranslationInput) -> TranslationOutput:
        from agent.agents.translation import translate_title

        result = await translate_title(
            inp.title,
            target_locale=inp.target_locale,
            db=db,
        )
        return TranslationOutput(
            translated=result.translated,
            source=result.source,
            confidence=result.confidence,
        )

    return task


# ── Evaluators ───────────────────────────────────────────────────────


class ExactMatchEvaluator(Evaluator[TranslationInput, TranslationOutput]):
    """Score 1.0 if translation exactly matches expected."""

    def evaluate(
        self, ctx: EvaluatorContext[TranslationInput, TranslationOutput]
    ) -> float:
        exp = ctx.expected_output
        expected = getattr(exp, "expected", "") if exp else ""
        actual = ctx.output.translated.strip() if ctx.output else ""
        return 1.0 if actual == str(expected).strip() else 0.0


class FuzzyMatchEvaluator(Evaluator[TranslationInput, TranslationOutput]):
    """Score 1.0 if translation contains or is contained by expected."""

    def evaluate(
        self, ctx: EvaluatorContext[TranslationInput, TranslationOutput]
    ) -> float:
        exp = ctx.expected_output
        expected = str(getattr(exp, "expected", "") if exp else "").strip().lower()
        actual = ctx.output.translated.strip().lower() if ctx.output else ""
        if actual == expected:
            return 1.0
        if expected in actual or actual in expected:
            return 0.8
        return 0.0


class NotOriginalEvaluator(Evaluator[TranslationInput, TranslationOutput]):
    """Score 1.0 if translation is different from the original input."""

    def evaluate(
        self, ctx: EvaluatorContext[TranslationInput, TranslationOutput]
    ) -> float:
        original = ctx.inputs.title.strip()
        translated = ctx.output.translated.strip() if ctx.output else ""
        exp = ctx.expected_output
        expected_str = str(getattr(exp, "expected", "") if exp else "").strip()
        if expected_str == original:
            return 1.0
        return 1.0 if translated != original else 0.0


# ── Load dataset ─────────────────────────────────────────────────────

_DATASET_PATH = Path(__file__).parent / "datasets" / "translation_v1.json"
_BASELINES_DIR = Path(__file__).parent / "baselines"
_DATASET_NAME = _DATASET_PATH.stem
_MODEL_ID = "translation"


def _load_cases() -> list[
    Case[TranslationInput, TranslationOutput, TranslationExpected]
]:
    raw = json.loads(_DATASET_PATH.read_text())
    return [
        Case(
            name=item["id"],
            inputs=TranslationInput(title=item["title"], target_locale=item["target"]),
            expected_output=TranslationExpected(expected=item["expected"]),
        )
        for item in raw
    ]


CASES = _load_cases()

translation_dataset = Dataset(
    name="translation_v1",
    cases=CASES,
    evaluators=[
        ExactMatchEvaluator(),
        FuzzyMatchEvaluator(),
        NotOriginalEvaluator(),
    ],
)

# ── Pytest integration ───────────────────────────────────────────────

_LAYER = "translation"


def _score_value(score: object) -> float:
    return float(getattr(score, "value", score))


def _case_scores(case: _EvalCaseResult) -> dict[str, float]:
    scores = case.scores
    if scores is None:
        return {}
    return {str(name): _score_value(score) for name, score in scores.items()}


def _collect_case_scores(report: _EvalReport) -> dict[str, dict[str, float]]:
    return {str(case.name): _case_scores(case) for case in report.cases}


def _baseline_record(
    scores: dict[str, float],
    cases: dict[str, dict[str, float]],
    evaluated_count: int,
) -> BaselineRecord:
    return BaselineRecord(
        model=_MODEL_ID,
        dataset=_DATASET_NAME,
        tier="translation",
        case_count=len(CASES),
        evaluated_count=evaluated_count,
        scores=scores,
        cases=cases,
    )


@pytest.mark.integration
def test_translation_quality(request: pytest.FixtureRequest) -> None:
    """Run translation eval against real testcontainer DB."""
    try:
        real_db = request.getfixturevalue("real_db")
    except pytest.FixtureLookupError:
        pytest.skip("real_db fixture not available — Docker required.")
        return

    task = make_translation_task(db=real_db)
    report = translation_dataset.evaluate_sync(
        task,
        name="translation_eval",
        max_concurrency=20,
    )
    report.print(include_input=True, include_output=True)

    avg = report.averages()
    if avg is None:
        pytest.skip("All translation cases errored.")

    exact = avg.scores.get("ExactMatchEvaluator", 0)
    fuzzy = avg.scores.get("FuzzyMatchEvaluator", 0)
    not_original = avg.scores.get("NotOriginalEvaluator", 0)

    current_scores = {
        "ExactMatchEvaluator": exact,
        "FuzzyMatchEvaluator": fuzzy,
        "NotOriginalEvaluator": not_original,
    }

    print(f"\n{'=' * 50}")
    print(f"  Exact match:    {exact:.1%}")
    print(f"  Fuzzy match:    {fuzzy:.1%}")
    print(f"  Not original:   {not_original:.1%}")
    print(f"  Cases:          {len(CASES)}")
    print(f"{'=' * 50}")

    current_case_scores = _collect_case_scores(report)
    baseline = read_baseline_record(
        _LAYER,
        _MODEL_ID,
        baselines_dir=_BASELINES_DIR,
        expected_case_count=len(CASES),
    )
    if baseline is None:
        record = _baseline_record(
            current_scores, current_case_scores, len(report.cases)
        )
        write_baseline_record(
            record,
            layer=_LAYER,
            model_id=_MODEL_ID,
            baselines_dir=_BASELINES_DIR,
        )
        pytest.skip("Baseline created; re-run to enforce gate.")

    failures = bootstrap_gate(current_case_scores, baseline)
    assert not failures, "Translation eval regression:\n" + "\n".join(failures)
