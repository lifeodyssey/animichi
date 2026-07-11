"""Translation eval — validates anime title and place name translation quality.

Tests translate_title against a dataset of known correct translations.
Checks both exact match and fuzzy match (for minor variations).

Usage:
    uv run pytest agent/tests/eval/test_translation.py -v -m integration --no-cov
"""

from __future__ import annotations

from pathlib import Path

import pytest
from dotenv import load_dotenv

from agent.tests.eval.exec_tiers import collect_case_scores
from agent.tests.eval.gate import (
    BaselineRecord,
    bootstrap_gate,
    error_rate_gate,
    read_baseline_record,
    write_baseline_record,
)
from agent.tests.eval.translation_eval_cases import (
    CASES,
    make_translation_task,
    translation_dataset,
)

load_dotenv(Path(__file__).parents[3] / ".env")

_BASELINES_DIR = Path(__file__).parent / "baselines"
_DATASET_NAME = "translation_v1"
_MODEL_ID = "translation"

# ── Pytest integration ───────────────────────────────────────────────

_LAYER = "translation"


def _baseline_record(
    scores: dict[str, float],
    cases: dict[str, dict[str, float]],
    evaluated_count: int,
    errored_count: int,
) -> BaselineRecord:
    return BaselineRecord(
        model=_MODEL_ID,
        dataset=_DATASET_NAME,
        tier="translation",
        case_count=len(CASES),
        evaluated_count=evaluated_count,
        errored_count=errored_count,
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

    current_case_scores = collect_case_scores(report)
    baseline = read_baseline_record(
        _LAYER,
        _MODEL_ID,
        baselines_dir=_BASELINES_DIR,
        expected_case_count=len(CASES),
    )
    if baseline is None:
        record = _baseline_record(
            current_scores,
            current_case_scores,
            len(report.cases),
            len(report.failures),
        )
        write_baseline_record(
            record,
            layer=_LAYER,
            model_id=_MODEL_ID,
            baselines_dir=_BASELINES_DIR,
        )
        pytest.skip("Baseline created; re-run to enforce gate.")

    failures = [
        *bootstrap_gate(current_case_scores, baseline),
        *error_rate_gate(
            len(report.failures),
            len(report.cases) + len(report.failures),
            baseline,
        ),
    ]
    assert not failures, "Translation eval regression:\n" + "\n".join(failures)
