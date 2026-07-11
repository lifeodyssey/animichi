from __future__ import annotations

from collections.abc import Mapping
from typing import cast

import pytest
from pydantic_evals.evaluators import EvaluatorContext, LLMJudge

from agent.agents.agent_result import AgentResult, StepRecord
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
    build_l3_evaluators,
)


def _steps(*tools: str) -> list[StepRecord]:
    return [StepRecord(tool=t, success=True) for t in tools]


def _result(steps: list[StepRecord], output: object | None = None) -> AgentResult:
    out = output or QAResponseModel(intent="general_qa", message="テスト")
    return AgentResult(output=out, steps=steps)


def _ctx(
    inputs: AgentInput, output: AgentResult, meta: AgentExpected
) -> EvaluatorContext[AgentInput, AgentResult, AgentExpected]:
    return EvaluatorContext(
        name="t",
        inputs=inputs,
        metadata=meta,
        expected_output=None,
        output=output,
        duration=0.0,
        _span_tree=None,
        attributes={},
        metrics={},
    )


_JA = AgentInput(query="q", locale="ja")


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
    ctx = _ctx(
        AgentInput(query="q", locale=locale),
        _result(_steps(), output),
        AgentExpected(["general_qa"]),
    )
    assert dict(LocaleMatch().evaluate(ctx)) == expected


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
    ctx = _ctx(_JA, _result(_steps(), output), AgentExpected([], data_keys=data_keys))
    assert dict(DataKeysPresent().evaluate(ctx)) == expected


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
