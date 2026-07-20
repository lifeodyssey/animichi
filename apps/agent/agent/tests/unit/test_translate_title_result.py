"""Key-parity and typed-signature guarantees for TranslateTitleResult.

S7.8: translate_anime_title used to return a bare dict[str, object] built
from these exact four keys. These tests lock in that the new named model
serializes to the identical key set and that the tool signature is now
genuinely typed, not just documented as such.
"""

from __future__ import annotations

from typing import get_type_hints

import pytest
from pydantic import ValidationError

from agent.agents.tool_outcomes import TranslateTitleResult
from agent.agents.web_tools import translate_anime_title

_LEGACY_DICT_KEYS = frozenset({"original", "translated", "source", "confidence"})


def test_translate_title_result_key_parity_with_legacy_dict() -> None:
    """The retired dict[str, object] return had exactly these four keys."""
    result = TranslateTitleResult(
        original="君の名は。",
        translated="你的名字",
        source="catalog",
        confidence=1.0,
    )

    assert set(result.model_dump(mode="json").keys()) == _LEGACY_DICT_KEYS


def test_translate_title_result_rejects_unknown_fields() -> None:
    payload = {
        "original": "a",
        "translated": "b",
        "source": "catalog",
        "confidence": 1.0,
        "unexpected": "nope",
    }

    with pytest.raises(ValidationError):
        TranslateTitleResult.model_validate(payload)


def test_translate_anime_title_return_annotation_is_the_named_model() -> None:
    hints = get_type_hints(translate_anime_title)

    assert hints["return"] is TranslateTitleResult
