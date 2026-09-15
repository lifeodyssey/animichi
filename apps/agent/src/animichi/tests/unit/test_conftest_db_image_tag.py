"""The Python consumer resolves the offline image tag, it does not write one (#1326).

`packages/test-postgres/postgres-image.env` is the ONE place the tag is written.
`src/postgres-image.ts` reads it for the TypeScript fixtures,
`scripts/local-gates/db-fresh-schema.sh` sources it as bash, and
`apps/agent/src/animichi/tests/conftest_db.py` reads it for the Python offline
arm. This contract resolves the declaration a second way — it parses the file
itself — so a fixture that keeps its own copy of the tag (and silently boots a
different or missing image) fails here, the same way
`packages/test-postgres/test/image-tag-contract.test.ts` fails for the other two
languages.

test-type: unit (reads checked-in files; no Docker, no database).
"""

from __future__ import annotations

import re
from pathlib import Path

from animichi.tests import conftest_db

ROOT = Path(__file__).resolve().parents[6]
DECLARATION = ROOT / "packages" / "test-postgres" / "postgres-image.env"
TEST_SUPPORT = Path(__file__).resolve().parents[1]
FIXTURE_MODULE = TEST_SUPPORT / "conftest_db.py"
CONTRACT_FILE = Path(__file__).resolve()
ASSIGNMENT = "TEST_POSTGRES_IMAGE="
# The repository's image family: a consumer that names one names its own tag.
IMAGE_LITERAL = re.compile(r"animichi-test-postgres:")


def declared_image() -> str:
    """Resolve the tag the way the bash consumer does: read the assignment line."""
    for line in DECLARATION.read_text(encoding="utf-8").splitlines():
        if line.startswith(ASSIGNMENT):
            return line.removeprefix(ASSIGNMENT).strip()
    raise AssertionError(f"{DECLARATION} declares no TEST_POSTGRES_IMAGE")


def python_consumers() -> list[Path]:
    """Every test-support module under the fixture package, minus this contract."""
    return sorted(
        path for path in TEST_SUPPORT.rglob("*.py") if path.resolve() != CONTRACT_FILE
    )


def test_fixture_module_resolves_the_tag_from_the_one_declaration() -> None:
    assert conftest_db.OFFLINE_IMAGE_DECLARATION == DECLARATION
    assert conftest_db.OFFLINE_IMAGE == declared_image()
    assert IMAGE_LITERAL.search(conftest_db.OFFLINE_IMAGE) is not None


def test_no_python_consumer_writes_the_tag_itself() -> None:
    consumers = python_consumers()
    assert FIXTURE_MODULE in consumers
    offenders = [
        path.relative_to(ROOT).as_posix()
        for path in consumers
        if IMAGE_LITERAL.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []
