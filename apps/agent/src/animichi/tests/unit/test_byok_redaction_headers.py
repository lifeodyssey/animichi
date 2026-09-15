"""The BYOK credential-stripping middleware's header handling (X3, Task 2).

Spec: docs/specs/2026-07-28-284-byok-design.md — Task 2.

``_split_sensitive_headers`` is the one place a sensitive request header is
replaced by ``[redacted]`` and stashed for the handler that needs it, so this
file pins the null/empty cases (AC-3) and the header-name set. How the
middleware is *registered* around other layers is pinned separately in
``test_byok_redaction_ordering.py``.
"""

from __future__ import annotations

from animichi.interfaces.routes._middleware import (
    SENSITIVE_HEADERS,
    _split_sensitive_headers,
)

FAKE_KEY = b"sk-test-0000000000000000000000000000"


class TestAC3NullAndEmptyHeaders:
    def test_no_byok_headers_leaves_headers_unchanged(self) -> None:
        headers = [(b"host", b"example.com"), (b"accept", b"*/*")]

        raw_values, scrubbed = _split_sensitive_headers(headers)

        assert raw_values == {}
        assert scrubbed == headers

    def test_empty_sensitive_header_value_is_not_redacted_or_stashed(self) -> None:
        headers = [(b"x-byok-key", b""), (b"host", b"example.com")]

        raw_values, scrubbed = _split_sensitive_headers(headers)

        assert raw_values == {}
        assert scrubbed == headers
        assert b"[redacted]" not in [value for _, value in scrubbed]

    def test_present_sensitive_header_is_redacted_and_stashed(self) -> None:
        headers = [(b"x-byok-key", FAKE_KEY)]

        raw_values, scrubbed = _split_sensitive_headers(headers)

        assert raw_values == {b"x-byok-key": FAKE_KEY}
        assert scrubbed == [(b"x-byok-key", b"[redacted]")]

    def test_header_name_set_is_unchanged_by_redaction(self) -> None:
        headers = [(b"x-byok-key", FAKE_KEY), (b"host", b"example.com")]

        _, scrubbed = _split_sensitive_headers(headers)

        assert [name for name, _ in scrubbed] == [name for name, _ in headers]

    def test_sensitive_headers_set_covers_byok_and_auth(self) -> None:
        assert SENSITIVE_HEADERS == frozenset(
            {"x-byok-key", "x-byok-base-url", "authorization", "cf-turnstile-response"}
        )

    def test_authorization_header_is_redacted_not_dropped(self) -> None:
        """Regression pin (#441's expired/invalid-JWT guard runs at the edge
        worker, not this container, but a future change here that *drops*
        Authorization instead of redacting it would silently change what any
        container-side consumer of this header set observes)."""
        headers = [(b"authorization", b"Bearer eyJ.fake.jwt")]

        raw_values, scrubbed = _split_sensitive_headers(headers)

        assert scrubbed == [(b"authorization", b"[redacted]")]
        assert raw_values == {b"authorization": b"Bearer eyJ.fake.jwt"}
