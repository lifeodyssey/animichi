"""Pin the Python adoption marker mirror to the edge protocol declaration."""

from __future__ import annotations

import re
from pathlib import Path

from animichi.application.turn_admission_port import ADOPT_TURN_KEY_PREFIX

_REPO_ROOT = Path(__file__).resolve().parents[6]
_EDGE_MARKER = (
    _REPO_ROOT / "workers" / "edge" / "src" / "identity" / "session-adoption-marker.ts"
)
_MARKER_DECLARATION = re.compile(r'export const ADOPT_TURN_KEY_PREFIX = "([^"]+)";')


def _edge_marker_prefix() -> str:
    source = _EDGE_MARKER.read_text(encoding="utf-8")
    match = _MARKER_DECLARATION.search(source)
    assert match is not None
    return match.group(1)


def test_python_marker_mirror_matches_edge_declaration() -> None:
    assert ADOPT_TURN_KEY_PREFIX == _edge_marker_prefix()
