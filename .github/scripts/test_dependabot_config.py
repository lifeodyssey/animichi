import re
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).parents[2]
CONFIG = REPO_ROOT / ".github/dependabot.yml"


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


class DependabotConfigTest(unittest.TestCase):
    def test_npm_updates_cover_all_pnpm_lockfile_domains(self) -> None:
        npm_blocks = ecosystem_blocks("npm")
        self.assertEqual(len(npm_blocks), 1)
        self.assertEqual(
            sorted(configured_directories(npm_blocks[0])), pnpm_lockfile_domains()
        )


if __name__ == "__main__":
    unittest.main()
