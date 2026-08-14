from typing import Any


def run(cursor: Any) -> None:
    # ruleid: py-no-inline-sql-execute
    cursor.execute("SELECT * FROM anime WHERE id = %s", (1,))
