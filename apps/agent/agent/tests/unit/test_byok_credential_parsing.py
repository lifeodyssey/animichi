"""Unit tests for BYOK header parsing (#284 T3-AC4, T3-AC5).

Each truth-table row is asserted individually with its own expected verdict,
mirroring the discipline used for the egress guard's own boundary table
(T1-AC2) — a single "all reject" assertion would pass even if the parser
picked the wrong reason for each case.
"""

from __future__ import annotations

import pytest

from agent.agents.byok_models import ByokCredential, ByokError, parse_byok_credential

pytestmark = pytest.mark.unit


def test_no_byok_headers_returns_none() -> None:
    """T3-AC4: absent headers must resolve to `None`, not a rejection."""
    result = parse_byok_credential(
        provider_header=None,
        key_header=None,
        model_header=None,
        base_url_header=None,
    )
    assert result is None


def test_openai_compatible_happy_path() -> None:
    credential = parse_byok_credential(
        provider_header="openai-compatible",
        key_header=b"sk-fake-key",
        model_header="gpt-test",
        base_url_header=b"https://example.test/v1",
    )
    assert credential == ByokCredential(
        provider="openai-compatible",
        key="sk-fake-key",
        model="gpt-test",
        base_url="https://example.test/v1",
    )


def test_anthropic_happy_path_no_model_uses_default() -> None:
    credential = parse_byok_credential(
        provider_header="anthropic",
        key_header=b"sk-ant-fake",
        model_header=None,
        base_url_header=None,
    )
    assert credential is not None
    assert credential.provider == "anthropic"
    assert credential.model
    assert credential.base_url is None


def test_gemini_happy_path_no_model_uses_default() -> None:
    credential = parse_byok_credential(
        provider_header="gemini",
        key_header=b"gemini-fake",
        model_header=None,
        base_url_header=None,
    )
    assert credential is not None
    assert credential.provider == "gemini"
    assert credential.model


def test_provider_present_key_empty_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="openai-compatible",
            key_header=b"   ",
            model_header="gpt-test",
            base_url_header=None,
        )
    assert excinfo.value.code == "invalid_request"


def test_provider_present_key_missing_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="anthropic",
            key_header=None,
            model_header=None,
            base_url_header=None,
        )
    assert excinfo.value.code == "invalid_request"


def test_unknown_provider_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="unknown-provider",
            key_header=b"sk-fake",
            model_header=None,
            base_url_header=None,
        )
    assert excinfo.value.code == "invalid_request"


def test_base_url_on_anthropic_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="anthropic",
            key_header=b"sk-ant-fake",
            model_header=None,
            base_url_header=b"https://example.test",
        )
    assert excinfo.value.code == "invalid_request"


def test_base_url_on_gemini_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="gemini",
            key_header=b"gemini-fake",
            model_header=None,
            base_url_header=b"https://example.test",
        )
    assert excinfo.value.code == "invalid_request"


def test_base_url_not_https_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="openai-compatible",
            key_header=b"sk-fake",
            model_header="gpt-test",
            base_url_header=b"http://example.test",
        )
    assert excinfo.value.code == "invalid_request"


def test_openai_compatible_missing_model_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="openai-compatible",
            key_header=b"sk-fake",
            model_header=None,
            base_url_header=b"https://example.test",
        )
    assert excinfo.value.code == "invalid_request"


def test_openai_compatible_blank_model_rejected() -> None:
    with pytest.raises(ByokError) as excinfo:
        parse_byok_credential(
            provider_header="openai-compatible",
            key_header=b"sk-fake",
            model_header="   ",
            base_url_header=None,
        )
    assert excinfo.value.code == "invalid_request"
