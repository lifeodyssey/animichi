"""HTTP status pins for typed runtime terminals (TURN-4 #955).

The legacy /v1/runtime JSON route is gone; the terminal-status taxonomy is
pinned through the pure ``_http_status_for_response`` mapping the remaining
JSON surfaces (admission rejections, error envelopes) share with it.
"""

from __future__ import annotations

import pytest

from animichi.interfaces.public_api import _invalid_selection_response
from animichi.interfaces.routes._deps import _http_status_for_response
from animichi.interfaces.schemas import PublicAPIResponse


def _terminal(status: str, intent: str) -> PublicAPIResponse:
    return PublicAPIResponse(
        success=False, status=status, intent=intent, message="Renderable terminal."
    )


async def test_place_ambiguity_clarify_returns_200() -> None:
    response = _terminal("needs_clarification", "clarify")
    response.data = {"reason": "place_ambiguity"}

    assert _http_status_for_response(response) == 200
    assert response.data["reason"] == "place_ambiguity"


@pytest.mark.parametrize(
    ("status", "intent"),
    [
        ("partial", "partial"),
        ("blocked", "blocked"),
        ("empty", "plan_multi"),
        ("too_large", "plan_multi"),
    ],
)
async def test_renderable_terminal_returns_200(status: str, intent: str) -> None:
    response = _terminal(status, intent)

    assert _http_status_for_response(response) == 200
    assert response.status == status


async def test_stale_invalid_selection_returns_400() -> None:
    response = _invalid_selection_response("This choice expired; please try again.")

    assert _http_status_for_response(response) == 400
    assert response.errors[0].code == "invalid_selection"
