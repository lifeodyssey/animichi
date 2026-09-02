"""UUIDv7 ownership contract of the fresh-schema migration chain (#992 #993).

Animichi-owned persistent entity primary keys are PostgreSQL UUID with a
native uuidv7() default. External provider ids and semantic keys (sessions.id,
bangumi/points/ingest/raw ids, gazetteer keys) stay text and are documented by
ownership in the table-mapping section of each migration.

Tables are located by name across the whole chain rather than by migration
file: which file holds a table is a layout decision the baseline is free to
change, while the ownership of its key is the contract being asserted.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
MIGRATIONS = ROOT / "migrations" / "neon"

#: Animichi-owned tables whose `id` must be a uuidv7 primary key.
ANIMICHI_OWNED_IDS: tuple[str, ...] = (
    "aliases",
    "cluster_version",
    "feedback",
    "itinerary_snapshots",
    "request_log",
    "saved_routes",
    "turn_reservations",
    "messages",
    "runs",
)

#: Table → the semantic/provider-owned key that stays text.
EXTERNAL_SEMANTIC_KEYS: dict[str, str] = {
    "bangumi": "id",
    "ingest_jobs": "work_id",
    "locations": "id",
    "points": "id",
    "raw_anitabi": "work_id",
    "raw_bangumi": "work_id",
    "sessions": "id",
}


def _migration_files() -> list[Path]:
    return sorted(MIGRATIONS.glob("*.sql"))


def _migration_chain() -> str:
    return "\n".join(path.read_text() for path in _migration_files())


def _create_table_body(table: str) -> list[str]:
    header = f"CREATE TABLE public.{table} ("
    for path in _migration_files():
        lines = path.read_text().splitlines()
        start = next(
            (i for i, line in enumerate(lines) if line.strip() == header), None
        )
        if start is not None:
            return lines[start + 1 :]
    raise AssertionError(f"{table}: no CREATE TABLE in {MIGRATIONS}")


def _column_sql(table: str, column: str) -> str:
    body = _create_table_body(table)
    return next(line for line in body if line.strip().startswith(f"{column} ")).strip()


def test_animichi_owned_primary_keys_use_uuidv7() -> None:
    for table in ANIMICHI_OWNED_IDS:
        declaration = _column_sql(table, "id")
        assert declaration.startswith("id uuid"), f"{table}: {declaration}"
        assert "DEFAULT uuidv7()" in declaration, f"{table}: {declaration}"


def test_external_and_semantic_keys_remain_text() -> None:
    for table, column in EXTERNAL_SEMANTIC_KEYS.items():
        declaration = _column_sql(table, column)
        assert declaration.startswith(f"{column} text"), f"{table}: {declaration}"


def test_no_application_uuid_defaults_remain() -> None:
    assert "gen_random_uuid()" not in _migration_chain()


def test_retired_serial_sequences_are_absent() -> None:
    chain = _migration_chain()
    for retired in (
        "aliases_id_seq",
        "cluster_version_id_seq",
        "itinerary_snapshots_id_seq",
    ):
        assert retired not in chain
