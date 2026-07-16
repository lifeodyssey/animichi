"""Wave 2 ManagedPrompt authority and failure-contract tests."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from concurrent.futures import Future
from threading import Event
from unittest.mock import MagicMock

import pytest
from logfire.variables import ResolutionReason, ResolvedVariable, Variable
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.animichi_agent import (
    _INSTRUCTIONS,
    _LOCAL_PROMPT_VERSION,
    MANAGED_PROMPT_LABEL,
    MANAGED_PROMPT_NAME,
    _AnimichiManagedPrompt,
    _resolve_prompt,
    build_animichi_agent,
)
from agent.agents.runtime_deps import RuntimeDeps
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_QA_OUTPUT = {"message": "ok"}


@pytest.fixture(autouse=True)
def _managed_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOGFIRE_TOKEN", "token")
    monkeypatch.setenv("LOGFIRE_API_KEY", "api-key")


def _deps() -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(), locale="zh", query="hello", catalog=MockCatalogClient()
    )


async def _run_and_capture_instructions() -> str:
    observed = ""

    def respond(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal observed
        observed = info.instructions or ""
        return ModelResponse(parts=[ToolCallPart("qa_response", _QA_OUTPUT)])

    agent = build_animichi_agent(modern_composition=True)
    await agent.run("hello", deps=_deps(), model=FunctionModel(respond))
    return observed


def _patch_resolution(
    monkeypatch: pytest.MonkeyPatch,
    *,
    value: str,
    reason: ResolutionReason = "resolved",
    label: str | None = MANAGED_PROMPT_LABEL,
    exception: Exception | None = None,
) -> None:
    resolved_label = label

    def resolve(
        self: Variable[str],
        targeting_key: str | None = None,
        attributes: Mapping[str, object] | None = None,
        *,
        label: str | None = None,
    ) -> ResolvedVariable[str]:
        del self, targeting_key, attributes, label
        return ResolvedVariable(
            name="prompt__animichi_instructions",
            value=value,
            exception=exception,
            reason=reason,
            label=resolved_label,
            version=7 if resolved_label else None,
        )

    monkeypatch.setattr(Variable, "get", resolve)


def _capture_records(
    monkeypatch: pytest.MonkeyPatch,
) -> list[dict[str, str | None]]:
    records: list[dict[str, str | None]] = []

    def record(
        *, source: str, version: str, label: str, failure: str | None = None
    ) -> None:
        records.append(
            {"source": source, "version": version, "label": label, "failure": failure}
        )

    monkeypatch.setattr(
        "agent.agents.animichi_agent.record_managed_prompt_resolution", record
    )
    return records


@pytest.mark.parametrize("reason", ["code_default", "missing_config", "no_provider"])
async def test_provider_unavailability_falls_back_once(
    monkeypatch: pytest.MonkeyPatch, reason: ResolutionReason
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    _patch_resolution(monkeypatch, value=_INSTRUCTIONS, reason=reason, label=None)
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS.rstrip())
    assert len(records) == 1
    assert records[0]["source"] == "local"
    assert records[0]["failure"] == "remote_unavailable"


async def test_blank_remote_value_falls_back_byte_identically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    _patch_resolution(monkeypatch, value=" \n")
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS.rstrip())
    assert records[0]["failure"] == "blank_remote_value"


def test_checked_in_default_is_the_managed_prompt_fallback() -> None:
    prompt = _AnimichiManagedPrompt(
        MANAGED_PROMPT_NAME, default=_INSTRUCTIONS, label=MANAGED_PROMPT_LABEL
    )
    assert prompt.default == _INSTRUCTIONS


def test_production_prompt_drift_pin_matches_checked_in_payload() -> None:
    digest = hashlib.sha256(_INSTRUCTIONS.encode()).hexdigest()
    assert _LOCAL_PROMPT_VERSION == f"sha256:{digest}"


async def test_remote_source_and_version_are_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    _patch_resolution(monkeypatch, value=_INSTRUCTIONS)
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS.rstrip())
    assert records == [
        {"source": "remote", "version": "7", "label": "production", "failure": None}
    ]


async def test_remote_content_drift_falls_back_to_checked_in_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    _patch_resolution(monkeypatch, value="stale production instructions")
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS.rstrip())
    assert records[0]["failure"] == "content_mismatch"


async def test_mismatched_label_falls_back_to_checked_in_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    _patch_resolution(
        monkeypatch,
        value="staging instructions",
        label="staging",
    )
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS.rstrip())
    assert records[0]["failure"] == "label_mismatch"
    assert records[0]["source"] == "local"


async def test_wall_deadline_falls_back_while_resolution_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    started, release = Event(), Event()

    def blocked_get(
        self: Variable[str],
        targeting_key: str | None = None,
        attributes: Mapping[str, object] | None = None,
        *,
        label: str | None = None,
    ) -> ResolvedVariable[str]:
        del self, targeting_key, attributes, label
        started.set()
        release.wait()
        return ResolvedVariable(
            name="prompt__animichi_instructions",
            value="late instructions",
            reason="resolved",
            label=MANAGED_PROMPT_LABEL,
            version=7,
        )

    monkeypatch.setattr(Variable, "get", blocked_get)
    monkeypatch.setattr(
        "agent.agents.animichi_agent._PROMPT_RESOLUTION_DEADLINE_SECONDS", 0.01
    )
    records = _capture_records(monkeypatch)
    try:
        assert (await _run_and_capture_instructions()).startswith(
            _INSTRUCTIONS.rstrip()
        )
    finally:
        release.set()
    assert records[0]["failure"] == "timeout"


async def test_async_resolution_awaits_completed_future_without_blocking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolved = ResolvedVariable(
        name="prompt__animichi_instructions",
        value="remote",
        reason="resolved",
        label=MANAGED_PROMPT_LABEL,
    )
    future: Future[ResolvedVariable[str]] = Future()
    future.set_result(resolved)
    prompt = _AnimichiManagedPrompt(
        MANAGED_PROMPT_NAME, default=_INSTRUCTIONS, label=MANAGED_PROMPT_LABEL
    )
    monkeypatch.setattr(
        "agent.agents.animichi_agent._submit_prompt_resolution",
        lambda _prompt, _ctx: future,
    )
    assert await _resolve_prompt(prompt, MagicMock()) is resolved


async def test_unexpected_resolution_exception_falls_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")

    def explode(*_args: object, **_kwargs: object) -> ResolvedVariable[str]:
        raise RuntimeError("unexpected resolver failure")

    monkeypatch.setattr(Variable, "get", explode)
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS.rstrip())
    assert records[0]["failure"] == "RuntimeError"


@pytest.mark.parametrize(
    ("credential", "failure"),
    [
        ("LOGFIRE_TOKEN", "missing_logfire_token"),
        ("LOGFIRE_API_KEY", "missing_logfire_api_key"),
    ],
)
async def test_missing_credential_warns_without_remote_resolution(
    monkeypatch: pytest.MonkeyPatch, credential: str, failure: str
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    monkeypatch.delenv(credential, raising=False)
    remote = MagicMock()
    monkeypatch.setattr(Variable, "get", remote)
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS.rstrip())
    remote.assert_not_called()
    assert [record["failure"] for record in records] == [failure]
