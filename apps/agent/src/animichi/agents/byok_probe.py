"""BYOK vision-capability probe — domain adapter owning the PydanticAI run.

TURN-1 (#939): the route layer must not depend on PydanticAI result/callback
types; the one-shot probe turn (Agent construction, model call, error
taxonomy) lives here and the route consumes the neutral ``ProbeResult``.
"""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from typing import Final, Literal

import structlog
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import BinaryContent, UserContent
from pydantic_ai.models import Model

logger = structlog.get_logger(__name__)

_PROBE_TIMEOUT_SECONDS: Final[float] = 5.0
_PROBE_PROMPT = "reply with the single word OK"
_PROBE_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA"
    "60e6kgAAAABJRU5ErkJggg=="
)
_CREDENTIAL_REJECTED_STATUSES: Final[frozenset[int]] = frozenset({401, 403})
_VISION_UNSUPPORTED_STATUSES: Final[frozenset[int]] = frozenset({400, 422})

ProbeErrorCode = Literal["byok_credential_rejected", "provider_unreachable"]


@dataclass(frozen=True, slots=True)
class ProbeResult:
    has_vision: bool
    reachable: bool
    error_code: ProbeErrorCode | None


def _probe_message() -> list[UserContent]:
    png = base64.b64decode(_PROBE_PNG_B64)
    return [_PROBE_PROMPT, BinaryContent(data=png, media_type="image/png")]


def _unreachable_result() -> ProbeResult:
    return ProbeResult(
        has_vision=False, reachable=False, error_code="provider_unreachable"
    )


def _classify_model_http_error(exc: ModelHTTPError) -> ProbeResult:
    if exc.status_code in _CREDENTIAL_REJECTED_STATUSES:
        return ProbeResult(
            has_vision=False, reachable=False, error_code="byok_credential_rejected"
        )
    if exc.status_code in _VISION_UNSUPPORTED_STATUSES:
        return ProbeResult(has_vision=False, reachable=True, error_code=None)
    return _unreachable_result()


async def probe_byok_model(model: Model) -> ProbeResult:
    """Run the one-shot probe turn; never lets an exception escape."""
    probe_agent: Agent[None, str] = Agent(
        model, output_type=str, name="byok_vision_probe"
    )
    try:
        async with asyncio.timeout(_PROBE_TIMEOUT_SECONDS):
            await probe_agent.run(_probe_message())
    except ModelHTTPError as exc:
        return _classify_model_http_error(exc)
    except asyncio.CancelledError:
        raise
    except Exception:
        return _probe_unreachable()
    return ProbeResult(has_vision=True, reachable=True, error_code=None)


def _probe_unreachable() -> ProbeResult:
    logger.info("byok_probe_unreachable", exc_info=True)
    return _unreachable_result()
