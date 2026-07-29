"""Shared sanitize/truncate helpers for untrusted text entering trusted state.

Both `fact_ledger.py` and `compaction_retention.py` replay externally-sourced
strings (point names, place names, anime titles) into session state that is
later injected into the trusted prompt context. The OQ-8 ruling decoupled
those two ledgers' *models* from each other; it did not ask for two copies of
the same string-hygiene routine, so this module is the one shared home for it.
"""

from __future__ import annotations

import re

_ELLIPSIS = "…"
_ELLIPSIS_BYTES = len(_ELLIPSIS.encode("utf-8"))

# Control/format characters and every line/paragraph separator a JSON string
# can carry (\x00-\x1f, DEL, NEL U+0085, LINE/PARAGRAPH SEPARATOR U+2028/29) —
# anything that could forge extra structured lines once replayed verbatim
# into the trusted prompt context.
_CONTROL_OR_NEWLINE = re.compile(r"[\x00-\x1f\x7f  ]")


def sanitize_text(value: str) -> str:
    """Strip control/newline-like characters and collapse whitespace."""
    collapsed = _CONTROL_OR_NEWLINE.sub(" ", value)
    return " ".join(collapsed.split())


def truncate_text(value: str, *, max_bytes: int) -> str:
    """Sanitize, then truncate to at most `max_bytes` encoded UTF-8 bytes.

    The `…` suffix's own encoded length is reserved out of the budget up
    front, so the result never exceeds `max_bytes` (CJK-safe: sliced by byte
    length, not character count).
    """
    sanitized = sanitize_text(value)
    encoded = sanitized.encode("utf-8")
    if len(encoded) <= max_bytes:
        return sanitized
    kept = encoded[: max_bytes - _ELLIPSIS_BYTES].decode("utf-8", errors="ignore")
    return kept + _ELLIPSIS
