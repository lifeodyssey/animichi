"""UUIDv7 ownership contract of the fresh-schema migration chain (#992 #993).

Animichi-owned persistent entity primary keys are PostgreSQL UUID with a
native uuidv7() default. External provider ids and semantic keys (sessions.id,
bangumi/points/ingest/raw ids, gazetteer keys) stay text and are documented by
ownership in the table-mapping section of each migration.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
MIGRATIONS = ROOT / "migrations" / "neon"

#: (migration file, Animichi-owned table) → its `id` column declaration.
ANIMICHI_OWNED_IDS: dict[str, str] = {
    "20260809000007_table_aliases.sql": "aliases",
    "20260809000011_table_cluster_version.sql": "cluster_version",
    "20260809000015_table_feedback.sql": "feedback",
    "20260809000017_table_itinerary_snapshots.sql": "itinerary_snapshots",
    "20260809000025_table_request_log.sql": "request_log",
    "20260809000026_table_saved_routes.sql": "saved_routes",
    "20260811000000_table_turn_reservations.sql": "turn_reservations",
    "20260811000002_table_messages.sql": "messages",
}

#: (migration file, table, column) → semantic/provider-owned key kept as text.
EXTERNAL_SEMANTIC_KEYS: dict[str, tuple[str, str]] = {
    "20260809000010_table_bangumi.sql": ("bangumi", "id"),
    "20260809000016_table_ingest_jobs.sql": ("ingest_jobs", "work_id"),
    "20260809000019_table_locations.sql": ("locations", "id"),
    "20260809000022_table_points.sql": ("points", "id"),
    "20260809000023_table_raw_anitabi.sql": ("raw_anitabi", "work_id"),
    "20260809000024_table_raw_bangumi.sql": ("raw_bangumi", "work_id"),
    "20260809000029_table_sessions.sql": ("sessions", "id"),
}


def _id_column_sql(file_name: str, table: str) -> str:
    lines = (MIGRATIONS / file_name).read_text().splitlines()
    header = f"CREATE TABLE public.{table} ("
    start = next(i for i, line in enumerate(lines) if line.strip() == header)
    body = lines[start + 1 :]
    id_line = next(line for line in body if line.strip().startswith("id "))
    return id_line.strip()


def test_animichi_owned_primary_keys_use_uuidv7() -> None:
    for file_name, table in ANIMICHI_OWNED_IDS.items():
        declaration = _id_column_sql(file_name, table)
        assert declaration.startswith("id uuid"), f"{table}: {declaration}"
        assert "DEFAULT uuidv7()" in declaration, f"{table}: {declaration}"


def test_external_and_semantic_keys_remain_text() -> None:
    for file_name, (table, column) in EXTERNAL_SEMANTIC_KEYS.items():
        lines = (MIGRATIONS / file_name).read_text().splitlines()
        header = f"CREATE TABLE public.{table} ("
        start = next(i for i, line in enumerate(lines) if line.strip() == header)
        body = lines[start + 1 :]
        declaration = next(
            line for line in body if line.strip().startswith(f"{column} ")
        ).strip()
        assert declaration.startswith(f"{column} text"), f"{table}: {declaration}"


def test_no_application_uuid_defaults_remain() -> None:
    chain = "\n".join(
        (MIGRATIONS / name).read_text()
        for name in sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    )
    assert "gen_random_uuid()" not in chain


def test_retired_serial_sequences_are_absent() -> None:
    chain = "\n".join(
        (MIGRATIONS / name).read_text()
        for name in sorted(p.name for p in MIGRATIONS.glob("*.sql"))
    )
    for retired in (
        "aliases_id_seq",
        "cluster_version_id_seq",
        "itinerary_snapshots_id_seq",
    ):
        assert retired not in chain
