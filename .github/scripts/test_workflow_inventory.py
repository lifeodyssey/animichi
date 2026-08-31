"""Keep the Actions sidebar limited to independent trigger domains."""

from pathlib import Path

ROOT = Path(__file__).parents[2]
WORKFLOWS = ROOT / ".github/workflows"
EXPECTED = {
    "agent-eval-nightly.yml",
    "cd.yml",
    "codeql.yml",
    "pr-verification.yml",
    "rollback.yml",
}


def main() -> None:
    actual = {path.name for path in WORKFLOWS.glob("*.yml")}
    missing = sorted(EXPECTED - actual)
    unexpected = sorted(actual - EXPECTED)
    if missing or unexpected:
        raise AssertionError(
            f"workflow inventory drift: missing={missing}, unexpected={unexpected}"
        )
    print("Workflow inventory: five independent trigger domains")


if __name__ == "__main__":
    main()
