"""Bounded BYOK credential probe through guarded egress (#953).

``ProbeModelCredential`` owns the one-shot vision-capability probe that the
route previously orchestrated by hand: it pre-validates a caller-chosen
``base_url`` (surfacing the dedicated ``egress_blocked`` code), builds the
per-request guarded model with the ≤64 KiB response cap installed at
construction, runs the bounded probe turn (``agents/byok_probe.py``), always
closes the per-request client, and maps the neutral ``ProbeResult`` onto the
generated boundary model ``ByokProbeResponse`` — the only wire shape the
route now returns (``response_model`` binding).

The route keeps only the auth gate, header parsing, and rejection mapping;
everything probe-shaped lives here. ``_PROBE_TIMEOUT_SECONDS`` is imported
from the probe adapter rather than re-declared, so the single constant can
never drift between the two nested timeouts (the adapter's own inner bound
and this capability's whole-operation bound).
"""

from __future__ import annotations

import asyncio

import structlog

from animichi.agents.byok_models import (
    ByokCredential,
    ByokError,
    build_byok_model,
)
from animichi.agents.byok_probe import (
    _PROBE_TIMEOUT_SECONDS,
    ProbeResult,
    probe_byok_model,
)
from animichi.infrastructure.egress_errors import EgressBlocked
from animichi.infrastructure.egress_guard import validate_base_url
from animichi.infrastructure.egress_transport import CappedResponseTransport
from animichi.interfaces.boundary.agent_models import ByokProbeResponse

logger = structlog.get_logger(__name__)


class ProbeRejection(Exception):
    """A typed BYOK probe rejection the route maps to its error envelope.

    ``code`` is the machine-readable member (``egress_blocked`` /
    ``invalid_request``); ``message`` is safe to surface — it never embeds
    the submitted key or ``base_url``.
    """

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _unreachable_response() -> ByokProbeResponse:
    return ByokProbeResponse(
        vision=False, reachable=False, error_code="provider_unreachable"
    )


async def _validate_egress_for_probe(credential: ByokCredential) -> None:
    """Pre-validate a caller-chosen `base_url` before spending a probe call.

    Only the `openai-compatible` family carries a caller-chosen `base_url`
    at all (`parse_byok_credential` enforces `None` for the other two
    families, so this branch is never reached for them — no dead
    `None`-check here). `build_byok_model` re-validates internally (T1/T3) —
    this earlier, separately-coded check exists only so the route can answer
    with the dedicated `egress_blocked` code instead of `build_byok_model`'s
    generic `invalid_request`.
    """
    if credential.provider != "openai-compatible":
        return
    if credential.base_url is None:
        # Structurally unreachable — `parse_byok_credential` requires a
        # `base_url` for this family — but this is a security-relevant
        # boundary, so it fails loudly rather than passing `None` into
        # `validate_base_url` and silently short-circuiting.
        raise RuntimeError(
            "openai-compatible credential is missing its required base_url."
        )
    await validate_base_url(credential.base_url)


class ProbeModelCredential:
    """One bounded vision probe for a caller-supplied credential."""

    async def probe(self, credential: ByokCredential) -> ByokProbeResponse:
        byok_model = None
        probe_task: asyncio.Task[ProbeResult] | None = None
        try:
            async with asyncio.timeout(_PROBE_TIMEOUT_SECONDS):
                await _validate_egress_for_probe(credential)
                byok_model = await build_byok_model(
                    credential, transport_wrapper=CappedResponseTransport
                )
                probe_task = asyncio.create_task(probe_byok_model(byok_model.model))
                result = await probe_task
        except EgressBlocked as exc:
            raise ProbeRejection(
                "egress_blocked", "base_url failed egress validation."
            ) from exc
        except ByokError as exc:
            raise ProbeRejection("invalid_request", exc.message) from exc
        except TimeoutError:
            if probe_task is not None:
                await _cancel_probe_task(probe_task)
            return _unreachable_response()
        finally:
            if byok_model is not None:
                await byok_model.client.aclose()
        logger.info(
            "byok_probe_completed",
            vision=result.has_vision,
            reachable=result.reachable,
            error_code=result.error_code,
        )
        return ByokProbeResponse(
            vision=result.has_vision,
            reachable=result.reachable,
            error_code=result.error_code,
        )


async def _cancel_probe_task(task: asyncio.Task[ProbeResult]) -> None:
    """Cancel a probe still in flight and wait for its teardown, mirroring
    ``byok_probe._cancel_and_await``: the probe's own timeout would otherwise
    keep the user-supplied provider connection open for another full window."""
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
