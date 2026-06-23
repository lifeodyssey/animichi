"""Unit tests for the testcontainer migration helpers in conftest_db.

Regression guard: filtering pgvector columns must not corrupt SQL statement
boundaries (a vector column that is the LAST column in an ALTER/CREATE carries
the terminating semicolon; dropping the whole line merges it with the next
statement and yields "syntax error at or near TABLE").
"""

from agent.tests.conftest_db import _filter_migration_lines, _split_sql_statements


def test_vector_column_last_in_alter_keeps_statement_boundary() -> None:
    sql = (
        "ALTER TABLE points\n"
        "    ADD COLUMN IF NOT EXISTS name_cn TEXT,\n"
        "    ADD COLUMN IF NOT EXISTS embedding vector(1024);\n"
        "\n"
        "ALTER TABLE points\n"
        "    ALTER COLUMN latitude SET NOT NULL;\n"
    )

    stmts = _split_sql_statements(_filter_migration_lines(sql))

    merged = [s for s in stmts if s.upper().count("ALTER TABLE") > 1]
    assert merged == [], f"statements merged across terminator: {merged}"


def test_vector_column_filtered_to_non_vector_type() -> None:
    sql = "ALTER TABLE points ADD COLUMN IF NOT EXISTS embedding vector(1024);\n"

    result = _filter_migration_lines(sql)

    assert "vector(" not in result.lower(), f"vector type survived: {result!r}"
