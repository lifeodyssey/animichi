"""Cross-language deployment invariants for the agent image."""

from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[6]
_DOCKERFILE = _ROOT / "apps/agent/Dockerfile"


def test_dockerfile_does_not_hardcode_a_privileged_app_env() -> None:
    assert "APP_ENV=" not in _DOCKERFILE.read_text()
