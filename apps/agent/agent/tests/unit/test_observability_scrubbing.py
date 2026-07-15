"""Logfire message-content and operating-query scrub policy."""

from __future__ import annotations

import json

import pytest
from logfire._internal.scrubbing import Scrubber

from agent.interfaces.routes._deps import (
    _SCRUB_PATTERNS,
    _enable_message_content_scrubbing,
    _preserve_operating_query,
)


@pytest.mark.parametrize(
    "message",
    [
        "Bearer secret.jwt.token",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
        "Authorization: Bearer secret.jwt.token",
    ],
)
def test_message_token_is_redacted_while_query_text_survives(message: str) -> None:
    _enable_message_content_scrubbing()
    value = {
        "pydantic_ai.all_messages": [{"parts": [{"content": message}]}],
        "gen_ai.input.messages": [{"content": "api-key=another-secret"}],
        "query_text": "Authorization anime near Uji",
    }
    scrubber = Scrubber(_SCRUB_PATTERNS, _preserve_operating_query)

    scrubbed, _notes = scrubber.scrub_value(("attributes",), value)

    message_json = json.dumps(scrubbed["pydantic_ai.all_messages"])
    genai_json = json.dumps(scrubbed["gen_ai.input.messages"])
    assert message not in message_json
    assert "another-secret" not in genai_json
    assert "Scrubbed" in message_json
    assert "Scrubbed" in genai_json
    assert scrubbed["query_text"] == "Authorization anime near Uji"
