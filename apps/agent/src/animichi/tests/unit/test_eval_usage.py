"""Token-usage reporting through the offline trajectory runtime."""

from __future__ import annotations

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_evals import Case, Dataset

from animichi.tests.eval.eval_harness import make_agent_task
from animichi.tests.eval.evaluators import AgentInput
from animichi.tests.eval.exec_tiers import build_results_payload
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.eval.null_database import NullDatabase
from animichi.tests.streaming_function_model import streaming_function_model


def _qa_driver() -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "qa_response",
                    {"message": "こんにちは。"},
                )
            ]
        )

    return streaming_function_model(respond)


async def test_mock_trajectory_report_carries_usage() -> None:
    task = make_agent_task(NullDatabase(), MockCatalogClient, _qa_driver())
    dataset = Dataset(
        name="usage",
        cases=[Case(name="usage-1", inputs=AgentInput("こんにちは", "ja"))],
    )
    report = await dataset.evaluate(task, name="usage", max_concurrency=1)
    payload = build_results_payload(
        report,
        model_id="function",
        dataset="usage",
        tier="trajectory",
        case_count=1,
        scores={},
    )

    assert payload.usage.requests > 0
    assert payload.usage.cases_with_usage == 1
    assert payload.cases[0].usage is not None
