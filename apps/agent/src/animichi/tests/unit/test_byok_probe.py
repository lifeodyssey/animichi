"""Unit tests for the BYOK vision-capability probe (TURN-1 #939).

Covers the one-shot probe turn's error taxonomy: credential rejection,
vision-unsupported statuses, provider unreachability, and the success path.
No network and no real model calls — a TestModel subclass raises the target
exception from ``request``.
"""

from __future__ import annotations

import asyncio

import pytest
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelResponse,
)
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.test import TestModel
from pydantic_ai.settings import ModelSettings
from structlog import testing

from animichi.agents.byok_probe import (
    ProbeResult,
    _classify_model_http_error,
    _probe_message,
    _unreachable_result,
    probe_byok_model,
)


class _RaisingModel(TestModel):
    """TestModel that raises a fixed exception from its single request."""

    def __init__(self, exc: Exception) -> None:
        super().__init__(model_name="raising")
        self._exc = exc

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        raise self._exc


class _HangingModel(TestModel):
    """TestModel that never returns, for the external-cancel path."""

    def __init__(self) -> None:
        super().__init__(model_name="hanging")
        self.started = asyncio.Event()

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        del messages, model_settings, model_request_parameters
        self.started.set()
        await asyncio.Event().wait()


def _http_error(status_code: int) -> ModelHTTPError:
    return ModelHTTPError(status_code, "raising")


def test_probe_message_is_prompt_plus_png() -> None:
    parts = _probe_message()
    assert parts[0] == "reply with the single word OK"
    binary = parts[1]
    assert isinstance(binary, BinaryContent)
    assert binary.media_type == "image/png"
    assert binary.data[:8] == b"\x89PNG\r\n\x1a\n"


async def test_probe_success_reports_vision() -> None:
    model = TestModel(custom_output_text="OK", call_tools=[])

    result = await probe_byok_model(model)

    assert result == ProbeResult(has_vision=True, reachable=True, error_code=None)


@pytest.mark.parametrize("status", [401, 403])
async def test_probe_classifies_credential_rejection(status: int) -> None:
    result = await probe_byok_model(_RaisingModel(_http_error(status)))

    assert result == ProbeResult(
        has_vision=False, reachable=False, error_code="byok_credential_rejected"
    )


@pytest.mark.parametrize("status", [400, 422])
async def test_probe_classifies_vision_unsupported_status(status: int) -> None:
    result = await probe_byok_model(_RaisingModel(_http_error(status)))

    assert result == ProbeResult(has_vision=False, reachable=True, error_code=None)


async def test_probe_other_http_status_is_unreachable() -> None:
    result = await probe_byok_model(_RaisingModel(_http_error(500)))

    assert result == ProbeResult(
        has_vision=False, reachable=False, error_code="provider_unreachable"
    )


async def test_probe_generic_exception_is_unreachable_and_logged() -> None:
    with testing.capture_logs() as captured:
        result = await probe_byok_model(_RaisingModel(RuntimeError("boom")))

    assert result == ProbeResult(
        has_vision=False, reachable=False, error_code="provider_unreachable"
    )
    assert any(event.get("event") == "byok_probe_unreachable" for event in captured)


def test_classify_credential_rejected_statuses() -> None:
    assert _classify_model_http_error(_http_error(401)).error_code == (
        "byok_credential_rejected"
    )
    assert _classify_model_http_error(_http_error(403)).error_code == (
        "byok_credential_rejected"
    )


def test_classify_vision_unsupported_statuses() -> None:
    assert _classify_model_http_error(_http_error(400)).reachable is True
    assert _classify_model_http_error(_http_error(422)).reachable is True
    assert _classify_model_http_error(_http_error(400)).error_code is None


def test_classify_unreachable_status() -> None:
    result = _classify_model_http_error(_http_error(500))
    assert result == _unreachable_result()
    assert result.error_code == "provider_unreachable"


async def test_probe_reraises_external_cancellation() -> None:
    model = _HangingModel()
    task = asyncio.create_task(probe_byok_model(model))
    await model.started.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
