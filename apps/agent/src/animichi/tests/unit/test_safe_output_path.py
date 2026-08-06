"""Unit tests for animichi.infrastructure.safe_output_path (SonarCloud pythonsecurity:S8707)."""

from pathlib import Path

import pytest

from animichi.infrastructure.safe_output_path import resolve_output_path


def test_resolves_relative_path_under_base(tmp_path: Path) -> None:
    resolved = resolve_output_path("out/report.json", base_dir=tmp_path)
    assert resolved == (tmp_path / "out" / "report.json").resolve()


def test_resolves_bare_filename_to_base(tmp_path: Path) -> None:
    resolved = resolve_output_path("report.json", base_dir=tmp_path)
    assert resolved == (tmp_path / "report.json").resolve()


def test_rejects_parent_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes the working directory"):
        resolve_output_path("../../etc/passwd", base_dir=tmp_path)


def test_rejects_absolute_path_outside_base(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes the working directory"):
        resolve_output_path("/etc/passwd", base_dir=tmp_path)
