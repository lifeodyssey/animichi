"""Credential behavior at the OpenAI-compatible model construction seam."""

from unittest.mock import patch

import httpx
import pytest
from openai import OpenAIError
from pydantic_ai.models.openai import OpenAIChatModel

from agent.agents.base import get_default_model
from agent.config.settings import Settings


async def test_keyless_localhost_model_builds_but_remote_model_fails() -> None:
    settings = Settings(
        _env_file=None,
        default_agent_model="openai:local@http://localhost:1234/v1",
        fallback_agent_model=None,
        openai_compat_api_key="",
        supabase_db_url="postgresql://local/test",
    )
    client = httpx.AsyncClient()
    try:
        with patch("agent.config.get_settings", return_value=settings):
            model = get_default_model(http_client=client)
        assert isinstance(model, OpenAIChatModel)
        assert model.client.api_key == "local-dev-placeholder"

        remote = settings.model_copy(
            update={"default_agent_model": "openai:remote@https://models.example/v1"}
        )
        with (
            patch("agent.config.get_settings", return_value=remote),
            pytest.raises(OpenAIError, match="Missing credentials"),
        ):
            get_default_model(http_client=client)
    finally:
        await client.aclose()
