"""Repeat-guard behavior: identical tool re-calls are deflected with guidance,
varied calls pass untouched, and the ledger never leaks across runs."""

from unittest.mock import MagicMock

from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    RetryPromptPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.animichi_agent import _REPEAT_GUARD_HINT, _tool_call_fingerprint
from agent.agents.animichi_runner import run_animichi_agent
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.streaming_function_model import streaming_function_model

_HINT = _REPEAT_GUARD_HINT.format(tool="resolve_anime")


def _retry_texts(messages: list[ModelMessage]) -> list[str]:
    return [
        str(part.content)
        for message in messages
        for part in message.parts
        if isinstance(part, RetryPromptPart)
    ]


def _resolve_then_qa(titles: list[str]) -> FunctionModel:
    """A scripted model: one resolve_anime per queued title, then qa_response."""

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if titles:
            title = titles.pop(0)
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": title})]
            )
        del messages
        return ModelResponse(parts=[ToolCallPart("qa_response", {"message": "ok"})])

    return streaming_function_model(respond)


async def _run(model: FunctionModel) -> tuple[object, list[str]]:
    seen_retries: list[str] = []
    original = model.function

    def observing(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen_retries.extend(_retry_texts(messages))
        assert original is not None
        response = original(messages, info)
        assert isinstance(response, ModelResponse)
        return response

    result = await run_animichi_agent(
        text="君の名は。の聖地を教えて",
        db=MagicMock(),
        locale="ja",
        model=streaming_function_model(observing),
        catalog=MockCatalogClient(),
    )
    return result, seen_retries


async def test_identical_repeat_gets_guidance_then_recovers() -> None:
    result, retries = await _run(_resolve_then_qa(["君の名は。", "君の名は。"]))

    assert any(_HINT in text for text in retries)
    executed = [step.tool for step in result.steps if step.tool == "resolve_anime"]
    assert len(executed) == 1


async def test_different_arguments_pass_untouched() -> None:
    result, retries = await _run(_resolve_then_qa(["君の名は。", "天気の子"]))

    assert not any(_HINT in text for text in retries)
    executed = [step.tool for step in result.steps if step.tool == "resolve_anime"]
    assert len(executed) == 2


async def test_ledger_is_scoped_to_a_single_run() -> None:
    _, first_retries = await _run(_resolve_then_qa(["君の名は。"]))
    _, second_retries = await _run(_resolve_then_qa(["君の名は。"]))

    assert not any(_HINT in text for text in first_retries)
    assert not any(_HINT in text for text in second_retries)


def test_fingerprint_is_stable_across_key_order() -> None:
    left = _tool_call_fingerprint("resolve_anime", {"a": 1, "b": "x"})
    right = _tool_call_fingerprint("resolve_anime", {"b": "x", "a": 1})

    assert left == right
    assert left != _tool_call_fingerprint("resolve_anime", {"a": 2, "b": "x"})
    assert left != _tool_call_fingerprint("search_nearby", {"a": 1, "b": "x"})


def _resolve_then_nearby() -> FunctionModel:
    """A model that ignores the convergence rules: resolve a miss, then still
    pivots to search_nearby (which the backstop must reject)."""
    script = iter(
        [
            ToolCallPart("resolve_anime", {"title": "no-such-anime-xyz"}),
            ToolCallPart("search_nearby", {"location": "Tokyo"}),
        ]
    )

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        del messages
        try:
            return ModelResponse(parts=[next(script)])
        except StopIteration:
            return ModelResponse(
                parts=[ToolCallPart("clarify_response", {"reason": "anime_not_found"})]
            )

    return streaming_function_model(respond)


async def test_backstop_blocks_search_after_unsettled_identity() -> None:
    seen_retries: list[str] = []
    model = _resolve_then_nearby()
    original = model.function

    def observing(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen_retries.extend(_retry_texts(messages))
        assert original is not None
        response = original(messages, info)
        assert isinstance(response, ModelResponse)
        return response

    result = await run_animichi_agent(
        text="no-such-anime-xyz の聖地",
        db=MagicMock(),
        locale="ja",
        model=streaming_function_model(observing),
        catalog=MockCatalogClient(),
    )

    assert any("anime identity is unsettled" in text for text in seen_retries)
    assert not any(step.tool == "search_nearby" for step in result.steps)
