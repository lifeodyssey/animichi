import re
import unittest
from pathlib import Path


CONFIG = Path(__file__).parents[1] / "dependabot.yml"
# The root lock covers every pnpm workspace importer; infra owns the only
# independent pnpm lockfile.
PNPM_LOCKFILE_DOMAINS = ["/", "/infra"]


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


class DependabotConfigTest(unittest.TestCase):
    def test_npm_updates_cover_both_pnpm_lockfile_domains(self) -> None:
        npm_blocks = ecosystem_blocks("npm")
        self.assertEqual(len(npm_blocks), 1)
        self.assertEqual(configured_directories(npm_blocks[0]), PNPM_LOCKFILE_DOMAINS)


if __name__ == "__main__":
    unittest.main()
