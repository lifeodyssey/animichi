"""Probe route boundary tests (AGENT-2 #953): generated response model + cleanup.

Split from ``test_byok_probe.py`` to keep each file under the 200-line cap.
"""

from __future__ import annotations

import pytest

from animichi.interfaces.boundary.agent_models import ByokProbeResponse
from animichi.interfaces.routes.byok import router as byok_router
from animichi.tests.integration._byok_probe_shared import (
    BYOK_HEADERS,
    HUMAN_HEADERS,
    FixedResponseTransport,
    app,
    byok_model_with_transport,
    post_probe,
    stub_dns,
)

_OK_COMPLETION = b"""{
  "id": "chatcmpl-probe",
  "choices": [{
    "finish_reason": "stop",
    "index": 0,
    "message": {"content": "OK", "role": "assistant"}
  }],
  "created": 0,
  "model": "byok-test-model",
  "object": "chat.completion"
}"""


def _patched_build(byok_model: object) -> object:
    from unittest.mock import AsyncMock, patch

    return patch(
        "animichi.interfaces.services.byok_probe.build_byok_model",
        AsyncMock(return_value=byok_model),
    )


async def test_route_binds_the_generated_probe_response_as_its_response_model() -> None:
    """AGENT-2 #953: the probe route returns exactly the generated boundary
    model — `response_model` is the emitted `ByokProbeResponse`, not a
    hand-built dict, so the OpenAPI surface and the wire shape share one
    source of truth."""
    probe_route = next(
        r for r in byok_router.routes if getattr(r, "path", None) == "/v1/byok/probe"
    )
    assert probe_route.response_model is ByokProbeResponse


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_dns(monkeypatch)


async def test_probe_success_closes_the_byok_client() -> None:
    """Cleanup AC (AGENT-2 #953): after a successful probe the per-request
    BYOK client is torn down — `ProbeModelCredential` closes it on every
    path, so a caller-supplied connection never outlives its one probe."""
    transport = FixedResponseTransport(200, _OK_COMPLETION)
    byok_model = await byok_model_with_transport(transport)
    built = app()
    with _patched_build(byok_model):
        response = await post_probe(built, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    assert transport.aclosed is True
