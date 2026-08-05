"""PATH contract for apply_migrations() (#730, #737 review item 5).

The behavior this card actually promises — apply_migrations() only prepends
the resolved Atlas cache directory to PATH for its own subprocess call, and
never touches the caller's own PATH — had no direct test before this file;
ensure_pinned_atlas() alone doesn't exercise it.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from agent.tests import atlas_helper
from agent.tests.atlas_helper import apply_migrations


def _capture_run(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    captured: dict[str, object] = {}

    def _fake_run(
        argv: list[str], **kwargs: object
    ) -> subprocess.CompletedProcess[str]:
        captured["argv"] = argv
        captured["env"] = kwargs["env"]
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    monkeypatch.setattr(atlas_helper.subprocess, "run", _fake_run)
    return captured


def test_apply_migrations_prepends_only_the_resolved_atlas_directory_to_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        atlas_helper, "ensure_pinned_atlas", lambda: Path("/fake/atlas/bin")
    )
    captured = _capture_run(monkeypatch)
    original_path = os.environ.get("PATH", "")

    apply_migrations("postgresql://example/test")

    expected = list(atlas_helper.atlas_apply_command("postgresql://example/test"))
    assert captured["argv"] == expected
    env = captured["env"]
    assert isinstance(env, dict)
    assert env["PATH"] == f"/fake/atlas/bin{os.pathsep}{original_path}"
    assert os.environ.get("PATH") == original_path  # caller's own PATH untouched


def test_apply_migrations_leaves_path_untouched_when_global_atlas_matches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(atlas_helper, "ensure_pinned_atlas", lambda: None)
    captured = _capture_run(monkeypatch)

    apply_migrations("postgresql://example/test")

    env = captured["env"]
    assert isinstance(env, dict)
    assert env["PATH"] == os.environ.get("PATH", "")
