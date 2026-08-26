"""Fresh-schema migrations may reference an object only after it exists.

Asserted over the whole chain in applied order, so the contract holds however
the baseline is split into files: a grant that moves ahead of its table breaks
this whether the move is within one file or across two.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
MIGRATIONS = ROOT / "migrations" / "neon"

CREATE_TABLE = re.compile(r"^CREATE TABLE public\.(\w+) \($", re.MULTILINE)
GRANT_ON_TABLE = re.compile(r"^GRANT .+ ON TABLE public\.(\w+) TO ", re.MULTILINE)


def _applied_chain() -> str:
    return "\n".join(path.read_text() for path in sorted(MIGRATIONS.glob("*.sql")))


def test_every_table_grant_follows_its_table_creation() -> None:
    chain = _applied_chain()
    created_at = {match[1]: match.start() for match in CREATE_TABLE.finditer(chain)}

    for grant in GRANT_ON_TABLE.finditer(chain):
        table = grant[1]
        assert table in created_at, f"grant on unknown table public.{table}"
        assert created_at[table] < grant.start(), (
            f"public.{table} granted before creation"
        )


def test_grants_cover_every_created_table() -> None:
    chain = _applied_chain()
    created = {match[1] for match in CREATE_TABLE.finditer(chain)}
    granted = {match[1] for match in GRANT_ON_TABLE.finditer(chain)}

    assert created - granted == set(), "tables created without any service grant"
