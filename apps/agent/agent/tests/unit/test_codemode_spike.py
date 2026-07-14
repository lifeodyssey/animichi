"""Offline construction and plumbing test for the CodeMode spike."""

from __future__ import annotations

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.profiles import ModelProfile

from agent.agents import animichi_agent as production_module
from agent.agents.runtime_deps import RuntimeDeps
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.null_database import NullDatabase

_QA_OUTPUT = {
    "intent": "general_qa",
    "message": "offline",
    "data": {"status": "info"},
    "ui": {},
}


def _function_model(observed: dict[str, str]) -> FunctionModel:
    def respond(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        observed.update(
            {tool.name: tool.description or "" for tool in info.function_tools}
        )
        return ModelResponse(parts=[ToolCallPart("qa_response", _QA_OUTPUT)])

    return FunctionModel(
        respond, profile=ModelProfile(supported_native_tools=frozenset())
    )


def _production_state() -> tuple[str, tuple[str, ...]]:
    production = production_module.animichi_agent
    names = tuple(production._function_toolset.tools)
    return repr(production.root_capability), names


async def test_codemode_spike_is_isolated_and_benchmark_is_injectable() -> None:
    before = _production_state()
    from agent.spikes.codemode.agent import (
        CODEMODE_TOOL_NAMES,
        build_codemode_animichi_agent,
    )
    from agent.spikes.codemode.benchmark import QUERIES, run_benchmark

    observed: dict[str, str] = {}
    model = _function_model(observed)
    spike = build_codemode_animichi_agent()
    deps = RuntimeDeps(NullDatabase(), "ja", QUERIES[0], MockCatalogClient())
    await spike.run(QUERIES[0], deps=deps, model=model)
    assert set(observed) == {"run_code"}
    assert all(name in observed["run_code"] for name in CODEMODE_TOOL_NAMES)

    report = await run_benchmark("baseline", 1, model=model, queries=QUERIES[:1])
    assert _production_state() == before
    assert report.runs[0].valid_typed_output
    assert report.runs[0].exception is None
    assert report.output_schema_digest is not None
    assert report.error_bearing_run_count == 0
    assert report.total_tool_failure_count == 0
