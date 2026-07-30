"""Regression coverage for the BYOK probe's whole-operation deadline."""

from __future__ import annotations

import asyncio
import socket
import threading
from collections.abc import Callable
from typing import TypeAlias

import httpx
import pytest

from agent.interfaces.routes import byok as byok_route
from agent.tests.integration._byok_probe_shared import (
    BYOK_HEADERS,
    HUMAN_HEADERS,
    app,
    post_probe,
)

pytestmark = pytest.mark.integration

_HOST = "byok.example.test"
_PUBLIC_IP = "8.8.8.8"
_CALLBACK_TIMEOUT_SECONDS = 1.0
_CLEANUP_TIMEOUT_SECONDS = 1.0
_UNREACHABLE_BODY = {
    "vision": False,
    "reachable": False,
    "error_code": "provider_unreachable",
}

_SocketAddress: TypeAlias = (
    tuple[str, int] | tuple[str, int, int, int] | tuple[int, bytes]
)
_GetAddrInfoResult: TypeAlias = list[
    tuple[socket.AddressFamily, socket.SocketKind, int, str, _SocketAddress]
]


class _ControlledAsyncio:
    """Expires the route's outer timeout at the selected DNS boundary."""

    CancelledError = asyncio.CancelledError

    def __init__(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._outer_timeout: asyncio.Timeout | None = None
        self._reschedule_finished = threading.Event()
        self._reschedule_error: RuntimeError | None = None

    def timeout(self, _delay: float | None) -> asyncio.Timeout:
        timeout = asyncio.timeout(None)
        if self._outer_timeout is None:
            self._outer_timeout = timeout
        return timeout

    @property
    def reschedule_succeeded(self) -> bool:
        return self._reschedule_finished.is_set() and self._reschedule_error is None

    def expire_outer_timeout(self) -> None:
        timeout = self._outer_timeout
        if timeout is None:
            raise RuntimeError("The shared probe timeout was not entered.")
        self._loop.call_soon_threadsafe(self._reschedule_now, timeout)
        if not self._reschedule_finished.wait(timeout=_CALLBACK_TIMEOUT_SECONDS):
            raise RuntimeError("The shared probe timeout callback did not finish.")
        if self._reschedule_error is not None:
            raise self._reschedule_error

    def _reschedule_now(self, timeout: asyncio.Timeout) -> None:
        try:
            timeout.reschedule(self._loop.time())
        except RuntimeError as exc:
            self._reschedule_error = exc
        finally:
            self._reschedule_finished.set()


class _BlockingGetAddrInfo:
    def __init__(
        self, blocked_resolution: int, expire_deadline: Callable[[], None]
    ) -> None:
        self._blocked_resolution = blocked_resolution
        self._expire_deadline = expire_deadline
        self._real_getaddrinfo = socket.getaddrinfo
        self.started = threading.Event()
        self.completed = threading.Event()
        self.release = threading.Event()
        self.call_count = 0

    def __call__(
        self,
        host: bytes | str | None,
        port: bytes | str | int | None,
        family: int = 0,
        type: int = 0,
        proto: int = 0,
        flags: int = 0,
    ) -> _GetAddrInfoResult:
        if host != _HOST or not isinstance(port, int):
            return self._real_getaddrinfo(host, port, family, type, proto, flags)
        self.call_count += 1
        if self.call_count == self._blocked_resolution:
            self.started.set()
            self._expire_deadline()
            self.release.wait()
            self.completed.set()
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (_PUBLIC_IP, port))]

    def cleanup(self) -> None:
        self.release.set()
        if self.started.is_set():
            self.completed.wait(timeout=_CLEANUP_TIMEOUT_SECONDS)


def _install_resolver(
    monkeypatch: pytest.MonkeyPatch, blocked_resolution: int
) -> tuple[_BlockingGetAddrInfo, _ControlledAsyncio]:
    controlled_asyncio = _ControlledAsyncio()
    resolver = _BlockingGetAddrInfo(
        blocked_resolution, controlled_asyncio.expire_outer_timeout
    )
    monkeypatch.setattr(socket, "getaddrinfo", resolver)
    monkeypatch.setattr(byok_route, "asyncio", controlled_asyncio)
    return resolver, controlled_asyncio


def _assert_deadline_result(
    response: httpx.Response,
    resolver: _BlockingGetAddrInfo,
    controlled_asyncio: _ControlledAsyncio,
    blocked_resolution: int,
) -> None:
    assert response.status_code == 200
    assert response.json() == _UNREACHABLE_BODY
    assert resolver.call_count == blocked_resolution
    assert resolver.started.is_set()
    assert not resolver.completed.is_set()
    assert controlled_asyncio.reschedule_succeeded


@pytest.mark.parametrize(
    "blocked_resolution",
    [1, 2, 3],
    ids=["route-preflight", "model-validation", "guarded-transport"],
)
async def test_shared_deadline_cancels_each_dns_resolution(
    monkeypatch: pytest.MonkeyPatch,
    blocked_resolution: int,
) -> None:
    """The route's one deadline causally cancels DNS calls one, two, and three."""
    resolver, controlled_asyncio = _install_resolver(monkeypatch, blocked_resolution)
    try:
        response = await post_probe(app(), HUMAN_HEADERS | BYOK_HEADERS)
        _assert_deadline_result(
            response, resolver, controlled_asyncio, blocked_resolution
        )
    finally:
        resolver.cleanup()
