from __future__ import annotations

from collections.abc import Mapping
from typing import cast

import pytest
from pydantic_evals.evaluators import LLMJudge

from agent.agents.base import parse_model_spec
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    QAResponseModel,
    SearchResponseModel,
)
from agent.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    DataKeysPresent,
    LocaleMatch,
    NonemptyResults,
    build_l3_evaluators,
)
from agent.tests.unit.eval_evaluator_fixtures import JA, ctx, result, steps


def _search_output() -> SearchResponseModel:
    return SearchResponseModel(
        intent="search_bangumi",
        message="found",
        data={"results": {"rows": [], "row_count": 0, "status": "ok"}},
    )


def _clarify_output() -> ClarifyResponseModel:
    return ClarifyResponseModel(
        intent="clarify",
        message="",
        data={
            "status": "needs_clarification",
            "question": "?",
            "options": [],
            "candidates": [],
        },
    )


def _judges() -> list[LLMJudge]:
    model = parse_model_spec(
        "openai:deepseek-v4-pro@https://api.deepseek.com",
        use_settings_fallbacks=False,
    )
    return cast(list[LLMJudge], build_l3_evaluators(model))


@pytest.mark.parametrize(
    ("message", "locale", "expected"),
    [
        ("これは日本語です", "ja", {"locale_match": 1.0}),
        ("これは日本語です", "en", {"locale_match": 0.0}),
        ("", "ja", {"locale_match": 0.0}),
        ("Hello there friend", "en", {"locale_match": 1.0}),
    ],
)
def test_locale_match_scores_message_language(
    message: str, locale: str, expected: Mapping[str, float]
) -> None:
    output = QAResponseModel(intent="general_qa", message=message)
    evaluator_ctx = ctx(
        AgentInput(query="q", locale=locale),
        result(steps(), output),
        AgentExpected(["general_qa"]),
    )
    assert dict(LocaleMatch().evaluate(evaluator_ctx)) == expected


@pytest.mark.parametrize(
    ("output", "data_keys", "expected"),
    [
        (_search_output(), ["results"], {"data_keys_present": 1.0}),
        (None, ["results"], {"data_keys_present": 0.0}),
        (
            _clarify_output(),
            ["question", "options", "status", "candidates"],
            {"data_keys_present": 1.0},
        ),
        (None, [], {"data_keys_present": 1.0}),
    ],
)
def test_data_keys_present_scores_response_payload(
    output: object | None, data_keys: list[str], expected: Mapping[str, float]
) -> None:
    evaluator_ctx = ctx(JA, result(steps(), output), AgentExpected([], data_keys))
    assert dict(DataKeysPresent().evaluate(evaluator_ctx)) == expected


@pytest.mark.parametrize(
    ("row_count", "expected"),
    [(2, {"nonempty_results": 1.0}), (0, {"nonempty_results": 0.0})],
)
def test_nonempty_results_scores_tagged_nearby_cases(
    row_count: int, expected: Mapping[str, float]
) -> None:
    evaluated = result(steps("search_nearby"), _search_output())
    evaluated.tool_state["search_nearby"] = {"row_count": row_count}
    evaluator_ctx = ctx(
        JA, evaluated, AgentExpected(["search_nearby"], expect_nonempty=True)
    )
    assert dict(NonemptyResults().evaluate(evaluator_ctx)) == expected


def test_nonempty_results_omits_metric_for_untagged_case() -> None:
    evaluated = result(steps("search_nearby"), _search_output())
    evaluated.tool_state["search_nearby"] = {"row_count": 3}
    evaluator_ctx = ctx(JA, evaluated, AgentExpected(["search_nearby"]))
    assert dict(NonemptyResults().evaluate(evaluator_ctx)) == {}


def test_build_l3_evaluators_returns_two_llm_judges() -> None:
    judges = _judges()
    assert (
        len(judges),
        isinstance(judges[0], LLMJudge),
        isinstance(judges[1], LLMJudge),
    ) == (
        2,
        True,
        True,
    )


def test_build_l3_evaluators_uses_temperature_zero() -> None:
    judges = _judges()
    assert judges[0].model_settings == {"temperature": 0.0}


def test_build_l3_evaluators_first_judge_is_non_asserting() -> None:
    judges = _judges()
    assert judges[0].assertion is False


def test_build_l3_evaluators_first_judge_scores_task_completion() -> None:
    judges = _judges()
    assert judges[0].score == {
        "evaluation_name": "task_completion",
        "include_reason": True,
    }


def test_build_l3_evaluators_second_judge_scores_hallucination() -> None:
    judges = _judges()
    assert judges[1].score["evaluation_name"] == "hallucination_check"
