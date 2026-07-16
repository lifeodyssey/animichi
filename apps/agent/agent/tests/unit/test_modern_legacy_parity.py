"""N1 external-output parity matrix for modern and legacy composition."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.animichi_agent import build_animichi_agent
from agent.agents.runtime_deps import RuntimeDeps
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_CASES: list[tuple[str, dict[str, object]]] = [
    ("qa_response", {"message": "Answer"}),
]


def _deps() -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(), locale="en", query="test", catalog=MockCatalogClient()
    )


@pytest.mark.parametrize(("output_name", "payload"), _CASES)
async def test_modern_and_legacy_have_identical_output_contracts(
    monkeypatch: pytest.MonkeyPatch,
    output_name: str,
    payload: dict[str, object],
) -> None:
    monkeypatch.delenv("ANIMICHI_INPUT_GUARD", raising=False)

    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart(output_name, payload)])

    outputs = []
    for modern in (True, False):
        result = await build_animichi_agent(modern_composition=modern).run(
            "same user query", deps=_deps(), model=FunctionModel(respond)
        )
        outputs.append(result.output.model_dump(mode="json"))

    assert outputs[0] == outputs[1]
