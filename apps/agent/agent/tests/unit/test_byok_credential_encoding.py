"""Malformed byte-header coverage for BYOK credential parsing (#535)."""

from __future__ import annotations

import pytest

from agent.agents.byok_models import ByokError, parse_byok_credential

pytestmark = pytest.mark.unit


def test_invalid_utf8_key_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="anthropic",
            key_header=b"\xff",
            model_header=None,
            base_url_header=None,
        )
    assert excinfo.value.code == "invalid_request"
    assert excinfo.value.message == "X-BYOK-Key must be valid UTF-8."


def test_invalid_utf8_base_url_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="openai-compatible",
            key_header=b"not-a-real-api-key",
            model_header="test-model",
            base_url_header=b"https://example.test/\xff",
        )
    assert excinfo.value.code == "invalid_request"
    assert excinfo.value.message == "X-BYOK-Base-Url must be valid UTF-8."
