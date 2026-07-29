"""Unit tests for `egress_guard.default_resolve`'s DNS behaviour (#284 T1).

Split out from `test_egress_guard_classification.py` to keep each file under
the 200-line test-file cap.
"""

from __future__ import annotations

import socket
import time

import pytest

from agent.infrastructure import egress_guard
from agent.infrastructure.egress_guard import EgressBlocked, EgressBlockReason

pytestmark = pytest.mark.unit


# ── P1-A: DNS resolution timeout must actually bound wall-clock time ───────


async def test_default_resolve_dns_timeout_is_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`abandon_on_cancel=True` is what makes this pass: without it,
    `anyio.fail_after` cannot interrupt a thread blocked in `getaddrinfo`
    (no cancellation hook in a blocking libc call), so the timeout would be
    cosmetic and this test would hang for the full blocking duration."""
    monkeypatch.setattr(egress_guard, "RESOLUTION_TIMEOUT_SECONDS", 0.15)

    def _blocking_getaddrinfo(
        *_args: object, **_kwargs: object
    ) -> list[tuple[object, ...]]:
        time.sleep(2.0)
        return []

    monkeypatch.setattr(socket, "getaddrinfo", _blocking_getaddrinfo)

    start = time.monotonic()
    with pytest.raises(EgressBlocked) as exc_info:
        await egress_guard.default_resolve("blackhole.example", 443)
    elapsed = time.monotonic() - start

    assert elapsed < 1.0, (
        "resolution must be bounded by the timeout, not the blocking call"
    )
    assert exc_info.value.reason is EgressBlockReason.RESOLUTION_TIMEOUT


# ── P1-B: a real DNS failure (NXDOMAIN etc.) is wrapped, not left as OSError ─


async def test_default_resolve_dns_failure_is_wrapped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _failing_getaddrinfo(
        *_args: object, **_kwargs: object
    ) -> list[tuple[object, ...]]:
        raise socket.gaierror("nodename nor servname provided, or not known")

    monkeypatch.setattr(socket, "getaddrinfo", _failing_getaddrinfo)

    with pytest.raises(EgressBlocked) as exc_info:
        await egress_guard.default_resolve("nx-domain.invalid", 443)
    assert exc_info.value.reason is EgressBlockReason.RESOLUTION_FAILED
