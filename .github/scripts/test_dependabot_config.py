import re
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).parents[2]
CONFIG = REPO_ROOT / ".github/dependabot.yml"
WORKFLOW = REPO_ROOT / ".github/workflows/dependabot-agent.yml"
GATE_STEP_ORDER = (
    "- uses: pnpm/action-setup@",
    "- uses: actions/setup-node@",
    "- run: pnpm install --frozen-lockfile --ignore-scripts",
    "- name: Backend quality + tests",
    "- name: Web + worker quality",
)
SETUP_UV_RE = re.compile(r"^\s*(?:-\s+)?uses:\s*astral-sh/setup-uv@")
SETUP_UV_PIN_RE = re.compile(
    r"^\s*(?:-\s+)?uses:\s*astral-sh/setup-uv@([0-9a-f]{40})\s+#\s+(v\d+\.\d+\.\d+)\s*$"
)
PRUNE_CACHE_RE = re.compile(
    r'^\s*prune-cache:\s*["\']?(true|false)["\']?\s*(?:#.*)?$'
)
SETUP_UV_SHA = "c771a70e6277c0a99b617c7a806ffedaca235ff9"
SETUP_UV_VERSION = "v9.0.0"


def ecosystem_blocks(name: str) -> list[str]:
    pattern = (
        rf'(?ms)^  - package-ecosystem: "{re.escape(name)}"$'
        r".*?(?=^  - package-ecosystem:|\Z)"
    )
    return re.findall(pattern, CONFIG.read_text(encoding="utf-8"))


def configured_directories(block: str) -> list[str]:
    pattern = r'(?ms)^    directories:$\n((?:^      - "[^"]+"$\n?)+)'
    section = re.findall(pattern, block)
    return re.findall(r'(?m)^      - "([^"]+)"$', section[0])


def tracked_pnpm_lockfiles() -> list[str]:
    output = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "*pnpm-lock.yaml"],
        cwd=REPO_ROOT,
    )
    return [name for name in output.decode("utf-8").split("\0") if name]


def pnpm_lockfile_domains() -> list[str]:
    parents = (Path(name).parent.as_posix() for name in tracked_pnpm_lockfiles())
    return sorted("/" if parent == "." else f"/{parent}" for parent in parents)


def gate_step_positions() -> list[int]:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    return [workflow.index(marker) for marker in GATE_STEP_ORDER]


def tracked_yaml_paths() -> list[Path]:
    output = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "*.yml", "*.yaml"], cwd=REPO_ROOT
    )
    names = (name for name in output.decode("utf-8").split("\0") if name)
    return [REPO_ROOT / name for name in names]


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip())


def step_indent(lines: list[str], index: int) -> int:
    if lines[index].lstrip().startswith("- "):
        return indent_of(lines[index])
    for previous in reversed(lines[:index]):
        if previous.lstrip().startswith("- "):
            return indent_of(previous)
    raise AssertionError("setup-uv call is not inside a YAML step")


def setup_uv_block(lines: list[str], index: int) -> list[str]:
    parent_indent = step_indent(lines, index)
    for end, line in enumerate(lines[index + 1 :], index + 1):
        is_next_step = line.lstrip().startswith("- ")
        if line.strip() and indent_of(line) <= parent_indent and is_next_step:
            return lines[index:end]
    return lines[index:]


def prune_cache_values(block: list[str]) -> list[str]:
    values: list[str] = []
    for index, line in enumerate(block):
        if line.strip() != "with:":
            continue
        with_indent = indent_of(line)
        for candidate in block[index + 1 :]:
            if candidate.strip() and indent_of(candidate) <= with_indent:
                break
            match = PRUNE_CACHE_RE.match(candidate)
            if match:
                values.append(match.group(1))
    return values


def setup_uv_pin_failure(line: str, location: str) -> str | None:
    pin = SETUP_UV_PIN_RE.match(line)
    if pin is None or pin.groups() != (SETUP_UV_SHA, SETUP_UV_VERSION):
        return f"{location}: pin must be {SETUP_UV_SHA} ({SETUP_UV_VERSION})"
    return None


def setup_uv_call_failures(path: Path, lines: list[str], index: int) -> list[str]:
    location = f"{path.relative_to(REPO_ROOT)}:{index + 1}"
    pin_failure = setup_uv_pin_failure(lines[index], location)
    failures = [pin_failure] if pin_failure else []
    if prune_cache_values(setup_uv_block(lines, index)) != ["true"]:
        failures.append(f"{location}: prune-cache must be true")
    return failures


def setup_uv_config_failures() -> list[str]:
    failures: list[str] = []
    for path in tracked_yaml_paths():
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if SETUP_UV_RE.match(line):
                failures.extend(setup_uv_call_failures(path, lines, index))
    return failures


class DependabotConfigTest(unittest.TestCase):
    def test_npm_updates_cover_all_pnpm_lockfile_domains(self) -> None:
        npm_blocks = ecosystem_blocks("npm")
        self.assertEqual(len(npm_blocks), 1)
        self.assertEqual(
            sorted(configured_directories(npm_blocks[0])), pnpm_lockfile_domains()
        )


class DependabotWorkflowTest(unittest.TestCase):
    def test_node_dependencies_precede_cross_language_backend_tests(self) -> None:
        positions = gate_step_positions()
        self.assertEqual(positions, sorted(positions))

    def test_every_setup_uv_call_explicitly_prunes_cache(self) -> None:
        self.assertEqual(setup_uv_config_failures(), [])


if __name__ == "__main__":
    unittest.main()
