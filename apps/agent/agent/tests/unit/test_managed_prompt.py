"""Wave 2 ManagedPrompt authority and failure-contract tests."""

from __future__ import annotations

import socket
from collections.abc import Mapping
from unittest.mock import MagicMock

import httpx
import pytest
from logfire.variables import ResolvedVariable, Variable
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.animichi_agent import (
    _INSTRUCTIONS,
    MANAGED_PROMPT_LABEL,
    MANAGED_PROMPT_NAME,
    _AnimichiManagedPrompt,
    build_animichi_agent,
)
from agent.agents.runtime_deps import RuntimeDeps
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_QA_OUTPUT = {
    "intent": "general_qa",
    "message": "ok",
    "data": {"status": "info", "message": "ok"},
    "ui": {},
}


class _FakeRemoteError(RuntimeError):
    """Concrete failure used by the managed-prompt test double."""


_RemoteFailure = (
    socket.gaierror | httpx.TimeoutException | httpx.HTTPStatusError | _FakeRemoteError
)


@pytest.fixture(autouse=True)
def _managed_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOGFIRE_TOKEN", "token")
    monkeypatch.setenv("LOGFIRE_API_KEY", "api-key")


def _deps() -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(), locale="zh", query="hello", catalog=MockCatalogClient()
    )


def _failure(kind: str) -> _RemoteFailure:
    if kind == "dns":
        return socket.gaierror("dns failed")
    if kind == "timeout":
        return httpx.TimeoutException("timed out")
    request = httpx.Request("GET", "https://logfire.example/variables")
    response = httpx.Response(int(kind), request=request)
    if response.is_server_error:
        return _FakeRemoteError("remote failed")
    return httpx.HTTPStatusError("remote failed", request=request, response=response)


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
    exception: _RemoteFailure | None,
    fake_clock: list[float] | None = None,
) -> None:
    def resolve(
        self: Variable[str],
        targeting_key: str | None = None,
        attributes: Mapping[str, object] | None = None,
        *,
        label: str | None = None,
    ) -> ResolvedVariable[str]:
        del self, targeting_key, attributes, label
        if fake_clock is not None:
            fake_clock[0] += 2.0
        return ResolvedVariable(
            name="prompt__animichi_instructions",
            value=value,
            exception=exception,
            reason="code_default" if exception else "resolved",
            label=None if exception else MANAGED_PROMPT_LABEL,
            version=None if exception else 7,
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


@pytest.mark.parametrize("kind", ["dns", "timeout", "401", "403", "500"])
async def test_remote_failures_fall_back_once(
    monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    failure = _failure(kind)
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    _patch_resolution(monkeypatch, value=_INSTRUCTIONS, exception=failure)
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS)
    assert len(records) == 1
    assert records[0]["source"] == "local"
    assert records[0]["failure"] == type(failure).__name__


async def test_blank_remote_value_falls_back_byte_identically(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    _patch_resolution(monkeypatch, value=" \n", exception=None)
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS)
    assert records[0]["failure"] == "blank_remote_value"


def test_checked_in_default_is_the_managed_prompt_fallback() -> None:
    prompt = _AnimichiManagedPrompt(
        MANAGED_PROMPT_NAME, default=_INSTRUCTIONS, label=MANAGED_PROMPT_LABEL
    )
    assert prompt.default == _INSTRUCTIONS


async def test_remote_source_and_version_are_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    _patch_resolution(monkeypatch, value="remote instructions", exception=None)
    records = _capture_records(monkeypatch)

    assert (await _run_and_capture_instructions()).startswith("remote instructions")
    assert records == [
        {"source": "remote", "version": "7", "label": "production", "failure": None}
    ]


async def test_fake_clock_pins_total_timeout_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    fake_clock = [0.0]
    _patch_resolution(
        monkeypatch,
        value=_INSTRUCTIONS,
        exception=httpx.TimeoutException("timed out"),
        fake_clock=fake_clock,
    )
    _capture_records(monkeypatch)

    started = fake_clock[0]
    await _run_and_capture_instructions()
    assert fake_clock[0] - started <= 2.0


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

    assert (await _run_and_capture_instructions()).startswith(_INSTRUCTIONS)
    remote.assert_not_called()
    assert [record["failure"] for record in records] == [failure]
