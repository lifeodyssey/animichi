from sqlalchemy import text


def q() -> None:
    # ruleid: py-no-sqlalchemy-text-literal
    text("SELECT * FROM anime WHERE id = :id")
