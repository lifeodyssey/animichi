"""MiMo (model `mimo-v2.5`) sometimes returns the `clarify` tool's `options`
argument as a JSON-encoded string (e.g. `'["A","B"]'`) instead of a native
list. PydanticAI validates tool arguments before the tool function runs, so
an uncoerced string is rejected, MiMo re-sends the same malformed string, and
after `retries=2` the agent raises `UnexpectedModelBehavior`.

`ClarifyArgs._coerce_options` (a `field_validator(mode="before")`) fixes this
by parsing a JSON-string `options` back into a list before Pydantic's type
validation runs — mirroring the response-side coercion pattern in
`runtime_models.py`, but early enough to save the tool call itself.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic_ai import ModelRetry
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.pilgrimage_runner import run_pilgrimage_agent
from agent.agents.pilgrimage_tools import ClarifyArgs
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def test_json_string_options_coerces_to_equivalent_list() -> None:
    """A JSON-encoded `options` string (the MiMo bug) coerces to a list."""
    args = ClarifyArgs(
        question="どちらの作品ですか？",
        options='["君の名は。","ラブライブ！"]',
    )

    assert args.options == ["君の名は。", "ラブライブ！"]


def test_native_list_options_passes_through_unchanged() -> None:
    """An already-native list is left untouched by the coercion."""
    options = ["君の名は。", "ラブライブ！"]

    args = ClarifyArgs(question="どちらの作品ですか？", options=options)

    assert args.options == options


def test_omitted_options_defaults_to_none() -> None:
    """No `options` supplied at all still defaults to `None` (not coerced)."""
    args = ClarifyArgs(question="どちらの作品ですか？")

    assert args.options is None


@pytest.mark.parametrize(
    "bad_options",
    [
        pytest.param('"hi"', id="decodes-to-str"),
        pytest.param("{}", id="decodes-to-dict"),
        pytest.param("not valid json at all [", id="invalid-json"),
    ],
)
def test_non_list_decoding_string_raises_model_retry(bad_options: str) -> None:
    """A string that doesn't decode to a JSON array raises `ModelRetry`.

    It must NOT silently pass through as a one-element string list, and it
    must surface as `ModelRetry` (not a generic `ValidationError`) so
    PydanticAI's tool manager feeds the model a clear, actionable retry
    prompt instead of a raw type-mismatch error.
    """
    with pytest.raises(ModelRetry, match="JSON array of strings"):
        ClarifyArgs(question="どちらの作品ですか？", options=bad_options)


@pytest.mark.parametrize(
    "bad_options",
    [
        pytest.param("[1,2]", id="list-of-ints"),
        pytest.param('[1,"a"]', id="mixed-list"),
        pytest.param("[null]", id="list-with-null"),
    ],
)
def test_list_of_non_string_items_raises_model_retry(bad_options: str) -> None:
    """A JSON string decoding to a list is not enough — items must be `str`.

    `'[1,2]'` decodes to `[1, 2]` (ints), which used to pass the bare
    `isinstance(decoded, list)` check and fall through to Pydantic's
    `list[str]` type validation — raising a raw `ValidationError` instead of
    the crafted `ModelRetry` guidance the model needs to self-correct.
    """
    with pytest.raises(ModelRetry, match="JSON array of strings"):
        ClarifyArgs(question="どちらの作品ですか？", options=bad_options)


_CLARIFY_RESPONSE_OUTPUT = {
    "intent": "clarify",
    "message": "请选择一个",
    "data": {
        "status": "needs_clarification",
        "question": "你是指哪一个？",
        "options": ["A", "B"],
        "candidates": [],
    },
    "ui": {},
}


def _clarify_succeeded(messages: list[ModelMessage]) -> bool:
    """True once a *successful* `clarify` tool return shows up in history.

    Checks for `ToolReturnPart` specifically (not just any part named
    "clarify") so a failed/retried call — which produces a `RetryPromptPart`
    instead — is not mistaken for success.
    """
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == "clarify"
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _clarify_then_output(
    messages: list[ModelMessage], info: AgentInfo
) -> ModelResponse:
    """Call `clarify` with a JSON-STRING `options` (the MiMo bug), then finish.

    Keeps re-emitting the same malformed-looking call until it actually
    succeeds. If the JSON-string coercion were broken, PydanticAI would feed
    back a retry prompt instead of a tool return, this function would keep
    resending the identical call, and the run would exhaust `retries=2` and
    raise `UnexpectedModelBehavior` — the original MiMo failure mode.
    """
    if _clarify_succeeded(messages):
        return ModelResponse(
            parts=[ToolCallPart("clarify_response", _CLARIFY_RESPONSE_OUTPUT)]
        )
    return ModelResponse(
        parts=[
            ToolCallPart(
                "clarify",
                {"question": "你是指哪一个？", "options": '["A","B"]'},
            )
        ]
    )


async def test_clarify_tool_coerces_json_string_options_end_to_end() -> None:
    """Regression guard: `clarify()` (the tool function) has zero coverage
    outside this test — every other test constructs `ClarifyArgs` directly.

    Drives the REAL agent pipeline with a `FunctionModel` that sends
    `options` as a JSON-encoded string, exactly the MiMo bug, proving the
    coercion survives PydanticAI's actual tool-call argument validation
    rather than just a direct `ClarifyArgs(...)` construction.
    """
    db = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(return_value=[])

    result = await run_pilgrimage_agent(
        text="你是指哪一个？",
        db=db,
        locale="zh",
        model=FunctionModel(_clarify_then_output),
        catalog=MockCatalogClient(),
    )

    assert result.intent == "clarify"
    clarify_steps = [step for step in result.steps if step.tool == "clarify"]
    assert len(clarify_steps) == 1
    assert clarify_steps[0].success is True
    assert clarify_steps[0].data is not None
    coerced_options = clarify_steps[0].data["options"]
    assert isinstance(coerced_options, list)
    assert coerced_options == ["A", "B"]
