"""`POST /v1/byok/probe` core route behaviour (#284 Task 5).

Error taxonomy classification lives in `test_byok_probe_error_taxonomy.py`,
the containment constraints (response cap / timeout) in
`test_byok_probe_containment.py`, and per-family coverage in
`test_byok_probe_families.py` — split out to stay under the 200-line
test-file cap (mirrors `_byok_redaction_shared.py`'s split).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agent.agents.byok_models import ByokModel
from agent.tests.integration._byok_probe_shared import (
    ANON_HEADERS,
    BYOK_HEADERS,
    HUMAN_HEADERS,
    FixedResponseTransport,
    app,
    byok_model_with_transport,
    post_probe,
    stub_dns,
)

pytestmark = pytest.mark.integration

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


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_dns(monkeypatch)


def _patched_build(byok_model: ByokModel) -> object:
    return patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    )


async def test_successful_probe_reports_vision_and_reachable_with_one_upstream_call() -> (
    None
):
    transport = FixedResponseTransport(200, _OK_COMPLETION)
    byok_model = await byok_model_with_transport(transport)
    built = app()
    with _patched_build(byok_model):
        response = await post_probe(built, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    assert response.json() == {"vision": True, "reachable": True, "error_code": None}
    assert len(transport.requests) == 1


async def test_no_byok_headers_is_invalid_request_with_no_upstream_call() -> None:
    built = app()
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not be called")),
    ):
        response = await post_probe(built, HUMAN_HEADERS)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


async def test_ssrf_blocked_base_url_is_rejected_with_no_socket_opened() -> None:
    built = app()
    headers = HUMAN_HEADERS | (
        BYOK_HEADERS | {"X-BYOK-Base-Url": "https://127.0.0.1/v1"}
    )
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not open a socket")),
    ):
        response = await post_probe(built, headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "egress_blocked"


async def test_anonymous_caller_with_byok_headers_is_rejected() -> None:
    built = app()
    response = await post_probe(built, ANON_HEADERS | BYOK_HEADERS)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"


async def test_the_cap_transport_is_installed_at_construction_never_reassigned() -> (
    None
):
    """#479 P2 review follow-up: the production code path installs the
    response-size cap via `build_byok_model`'s `transport_wrapper` — proven
    by patching `build_byok_model` itself and asserting the route calls it
    with a `transport_wrapper` kwarg, rather than mutating `client._transport`
    after the fact."""
    transport = FixedResponseTransport(200, _OK_COMPLETION)
    byok_model = await byok_model_with_transport(transport)
    built = app()
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    ) as build_mock:
        await post_probe(built, HUMAN_HEADERS | BYOK_HEADERS)
    assert build_mock.await_args.kwargs["transport_wrapper"] is not None
