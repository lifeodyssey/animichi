"""Status mapping and state digest helpers for the turn lifecycle (#994).

Shared by the turn reservation store and its tests: the stored row status
is mapped back to the port vocabulary, and a session state envelope is
digested to a canonical sha256 hex string for the CAS guard. Split out of
``turn_reservation.py`` (1-10-50).
"""

from __future__ import annotations

import hashlib
import json

from animichi.application.turn_admission_port import AdmissionStatus

_RESERVED = "reserved"
_RUNNING = "running"
_FAILED = "failed"
_SWEEP_STATUSES = ("reserved", "running")

#: Per-session reservation history retained for replay (recent turns only).
_KEEP_REVISIONS = 16


def _port_status(stored: str) -> AdmissionStatus:
    """Map a stored row status to the port vocabulary (failed never replays)."""
    if stored == "completed":
        return "replay_completed"
    if stored == "failed":
        return "turn_failed"
    return "in_flight"


def state_digest(state: object) -> str:
    """Canonical sha256 hex digest of a stored session state envelope."""
    if isinstance(state, str):
        try:
            state = json.loads(state)
        except json.JSONDecodeError:
            state = {}
    if not isinstance(state, dict):
        state = {}
    payload = json.dumps(state, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


__all__ = ["state_digest"]
