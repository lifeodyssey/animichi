"""Shared Git fixture support for change-plan behavior tests."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import TypedDict, cast

ROOT = Path(__file__).resolve().parents[2]
PLANNER = ROOT / ".github/scripts/change-plan.py"
MANIFEST = ROOT / ".github/ci/components.json"


class ChangePlan(TypedDict):
    components: list[str]
    direct_components: list[str]
    source_components: list[str]
    test_trigger_components: list[str]
    lanes: list[str]
    fallback_all: bool


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def commit_file(root: Path, path: str, content: str) -> str:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    git(root, "add", ".")
    git(root, "commit", "-qm", path)
    return git(root, "rev-parse", "HEAD")


def planner_command(root: Path, base: str, head: str, mode: str, purpose: str, manifest: Path) -> list[str]:
    return [sys.executable, str(PLANNER), "--root", str(root), "--manifest", str(manifest),
            "--base", base, "--head", head, "--range", mode, "--purpose", purpose, "--format", "json"]


def run_plan(root: Path, base: str, head: str, mode: str = "pr", purpose: str = "ci", manifest: Path = MANIFEST) -> subprocess.CompletedProcess[str]:
    return subprocess.run(planner_command(root, base, head, mode, purpose, manifest), check=False,
                          capture_output=True, text=True)


def plan(root: Path, base: str, head: str, mode: str = "pr", purpose: str = "ci") -> ChangePlan:
    result = run_plan(root, base, head, mode, purpose)
    result.check_returncode()
    return cast(ChangePlan, json.loads(result.stdout))


def fixture() -> tuple[tempfile.TemporaryDirectory[str], Path, str]:
    temporary = tempfile.TemporaryDirectory()
    root = Path(temporary.name)
    git(root, "init", "-q")
    git(root, "config", "user.name", "test")
    git(root, "config", "user.email", "test@example.com")
    initial = commit_file(root, "seed.txt", "seed")
    return temporary, root, initial
