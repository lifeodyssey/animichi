"""Shared CLI-arg path validation (CWE-22 / SonarCloud pythonsecurity:S8707).

These dev/ops scripts accept a `--output` path from the CLI and write to it.
An LLM-driven invocation (Codex/Claude tool call) can pass an attacker- or
mistake-influenced path; resolve it and reject anything that escapes the
expected working directory before it ever reaches `open()`.
"""

from __future__ import annotations

from pathlib import Path


def resolve_output_path(output: str, base_dir: Path | None = None) -> Path:
    """Resolve `output` and reject any path that escapes `base_dir` (cwd by default)."""
    base = (base_dir or Path.cwd()).resolve()
    resolved = (base / output).resolve()
    if resolved != base and base not in resolved.parents:
        raise ValueError(f"--output path escapes the working directory: {output!r}")
    return resolved
