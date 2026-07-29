"""P3-c (review follow-up on #477): `_require_nonblank_key` asserted directly.

`parse_byok_credential` already guarantees a non-blank key on every path
reachable from the route layer, so this belt-and-suspenders guard inside
`build_byok_model` was previously only exercised indirectly. Asserted here
on its own because a blank key reaching `GoogleProvider`/`AnthropicProvider`
falls back to a server-side environment credential — the exact silent
fallback this spec forbids — and a `ByokCredential` can in principle be
constructed directly, bypassing the parser.
"""

from __future__ import annotations

import pytest

from agent.agents.byok_models import ByokCredential, ByokError, _require_nonblank_key

pytestmark = pytest.mark.unit


def test_a_blank_key_is_rejected() -> None:
    credential = ByokCredential(provider="gemini", key="", model="gemini-test")
    with pytest.raises(ByokError) as excinfo:
        _require_nonblank_key(credential)
    assert excinfo.value.code == "invalid_request"


def test_a_nonblank_key_passes_through() -> None:
    credential = ByokCredential(
        provider="gemini", key="a-real-key", model="gemini-test"
    )
    _require_nonblank_key(credential)  # must not raise
