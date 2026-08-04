"""Download-step edge cases for the pinned Atlas cache (#737 review items 1 & 3).

Split out of test_atlas_self_heal.py to keep files under the 200-line ceiling;
reuses that file's fixture helpers rather than duplicating them.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest

from agent.tests import atlas_helper
from agent.tests.atlas_helper import ensure_pinned_atlas
from agent.tests.unit.test_atlas_self_heal import (
    _fixture_cache,
    _forbidden_get,
    _pin_current_platform,
)


def test_download_pinned_atlas_follows_redirects(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mutation guard: a 301 must be followed, not misread as a bad checksum."""
    payload = b"redirected Atlas payload"
    digest = hashlib.sha256(payload).hexdigest()
    _fixture_cache(monkeypatch, tmp_path)
    _pin_current_platform(monkeypatch, digest)

    def _handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/redirect-me"):
            return httpx.Response(301, headers={"location": "/final"})
        return httpx.Response(200, content=payload)

    transport = httpx.MockTransport(_handler)

    def _get(url: str, *, timeout: float, follow_redirects: bool) -> httpx.Response:
        with httpx.Client(
            transport=transport, follow_redirects=follow_redirects
        ) as client:
            return client.get("http://release.test/redirect-me", timeout=timeout)

    monkeypatch.setattr(atlas_helper.httpx, "get", _get)

    bin_dir = ensure_pinned_atlas()

    assert bin_dir is not None
    assert (bin_dir / "atlas").read_bytes() == payload


def test_download_pinned_atlas_mkdir_failure_says_arm_did_not_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mutation guard: mkdir failing must not surface as a bare OSError."""
    blocker = tmp_path / "blocker"
    blocker.write_text("occupies the path a cache directory would need")
    _fixture_cache(monkeypatch, tmp_path)
    monkeypatch.setattr(atlas_helper, "ATLAS_CACHE_DIR", blocker / "nested")
    _pin_current_platform(monkeypatch, "0" * 64)
    monkeypatch.setattr(atlas_helper.httpx, "get", _forbidden_get)

    with pytest.raises(RuntimeError, match="did NOT run.*could not prepare"):
        ensure_pinned_atlas()
