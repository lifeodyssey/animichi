"""BYOK probe HTTP-status taxonomy (#284 Task 5, #479 P1-2/P2-1 review).

Only 401/403 are `byok_credential_rejected`; only 400/422 mean "reachable,
model rejects the image part"; every OTHER status (404/429/5xx) collapses to
`provider_unreachable` — a caller must not be able to fingerprint a public
non-LLM service by the exact status code it answers with. Each status is
asserted individually, mirroring the egress guard's own boundary-table
discipline (T1-AC2): a single "all reject" assertion would pass even if the
classifier picked the wrong bucket for each one.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agent.agents.byok_models import ByokModel
from agent.tests.integration._byok_probe_shared import (
    BYOK_HEADERS,
    HUMAN_HEADERS,
    FixedResponseTransport,
    app,
    byok_model_with_transport,
    error_body,
    post_probe,
    stub_dns,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_dns(monkeypatch)


def _patched_build(byok_model: ByokModel) -> object:
    return patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    )


async def _probe_with_status(status_code: int, message: str) -> dict[str, object]:
    transport = FixedResponseTransport(status_code, error_body(message))
    byok_model = await byok_model_with_transport(transport)
    built = app()
    with _patched_build(byok_model):
        response = await post_probe(built, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    return dict(response.json())


async def test_401_reports_unreachable_credential_rejected_with_no_key_echo() -> None:
    body = await _probe_with_status(401, "invalid api key sk-fake-secret-value")
    assert body == {
        "vision": False,
        "reachable": False,
        "error_code": "byok_credential_rejected",
    }


async def test_403_also_reports_credential_rejected() -> None:
    """403 is the other auth-distinguishable outcome (401/403), never
    collapsed into `provider_unreachable` alongside connectivity failures."""
    body = await _probe_with_status(403, "forbidden")
    assert body["error_code"] == "byok_credential_rejected"


async def test_400_reports_vision_false_reachable_true() -> None:
    """The provider answered but rejected the image part itself."""
    body = await _probe_with_status(400, "image content not supported")
    assert body == {"vision": False, "reachable": True, "error_code": None}


async def test_422_also_reports_vision_false_reachable_true() -> None:
    body = await _probe_with_status(422, "unprocessable content part")
    assert body == {"vision": False, "reachable": True, "error_code": None}


@pytest.mark.parametrize("status_code", [404, 429, 500, 502, 503])
async def test_every_other_status_collapses_to_provider_unreachable(
    status_code: int,
) -> None:
    """#479 P2-1: a 404/429/5xx must NOT read as a legitimate "no vision"
    answer (vision:false, reachable:true) — that would let a caller
    distinguish "a real LLM API that doesn't do images" from "some other
    public HTTP service entirely". Both must look identical from outside."""
    body = await _probe_with_status(status_code, "unexpected status")
    assert body == {
        "vision": False,
        "reachable": False,
        "error_code": "provider_unreachable",
    }
