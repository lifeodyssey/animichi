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


if __name__ == "__main__":
    unittest.main()
