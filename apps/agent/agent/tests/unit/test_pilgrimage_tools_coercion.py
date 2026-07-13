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

import pytest
from pydantic_ai import ModelRetry

from agent.agents.pilgrimage_tools import ClarifyArgs


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
