"""Regression coverage for the BYOK probe's whole-operation deadline."""

from __future__ import annotations

import socket
import threading

import pytest

from agent.interfaces.routes import byok as byok_route
from agent.tests.integration._byok_probe_shared import (
    BYOK_HEADERS,
    HUMAN_HEADERS,
    app,
    post_probe,
)

pytestmark = pytest.mark.integration


async def test_dns_resolution_cannot_extend_the_probe_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The route deadline covers preflight DNS, not only the model request."""
    started = threading.Event()
    completed = threading.Event()
    release = threading.Event()
    real_getaddrinfo = socket.getaddrinfo

    def slow_getaddrinfo(
        host: str, port: int, *args: object, **kwargs: object
    ) -> list[tuple[object, ...]]:
        if host != "byok.example.test":
            return real_getaddrinfo(host, port, *args, **kwargs)
        started.set()
        release.wait()
        completed.set()
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", port))]

    monkeypatch.setattr(socket, "getaddrinfo", slow_getaddrinfo)
    monkeypatch.setattr(byok_route, "_PROBE_TIMEOUT_SECONDS", 0.05)

    response = await post_probe(app(), HUMAN_HEADERS | BYOK_HEADERS)

    assert response.status_code == 200
    assert response.json() == {
        "vision": False,
        "reachable": False,
        "error_code": "provider_unreachable",
    }
    assert started.is_set()
    assert not completed.is_set()
    release.set()
    completed.wait()
