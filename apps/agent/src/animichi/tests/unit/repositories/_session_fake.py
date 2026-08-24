"""Recording async-session fake for SQLModel repository unit tests (#995).

Lets unit tests assert *behavior* of the SQLModel repositories — which typed
statements they build and with which bound parameters — without executing
SQL against a database (raw-SQL policy, #999): no SQL string is ever
compared; assertions inspect the constructed SQLAlchemy expression objects.
"""

from __future__ import annotations

from typing import TypeVar

from sqlalchemy.sql.elements import ClauseElement

T = TypeVar("T")


class _Row(dict):
    """A scripted row answering the ``dict(row._mapping)`` accessor the
    catalog read repositories use to project their selected columns."""

    @property
    def _mapping(self) -> dict:
        return self


class _ScalarResult:
    """A scripted statement result answering the scalar/cursor accessors."""

    def __init__(
        self, value: object | None = None, error: type[Exception] | None = None
    ) -> None:
        self._value = value
        self._error = error

    def _maybe_raise(self) -> None:
        if self._error is not None:
            raise self._error()

    def scalar_one_or_none(self) -> object | None:
        self._maybe_raise()
        return self._value

    def scalar(self) -> object | None:
        self._maybe_raise()
        return self._value

    def scalar_one(self) -> object | None:
        self._maybe_raise()
        return self._value

    def scalars(self) -> _ScalarSequence:
        self._maybe_raise()
        values = self._value if isinstance(self._value, list) else []
        return _ScalarSequence(values)

    def first(self) -> object | None:
        self._maybe_raise()
        if isinstance(self._value, list):
            row = self._value[0] if self._value else None
        else:
            row = self._value
        return _as_row(row)

    def all(self) -> list[object]:
        self._maybe_raise()
        if isinstance(self._value, list):
            return [_as_row(row) for row in self._value]
        return [] if self._value is None else [_as_row(self._value)]


def _as_row(value: object) -> object:
    return _Row(value) if isinstance(value, dict) else value


class _ScalarSequence:
    def __init__(self, values: list[object]) -> None:
        self._values = values

    def all(self) -> list[object]:
        return list(self._values)

    def __iter__(self):
        return iter(self._values)


class RecordingSession:
    """A session that records every executed statement and returns scripted
    results per statement type. Use ``result_for`` to queue results; unconsumed
    statements answer ``None``."""

    def __init__(self) -> None:
        self.executed: list[ClauseElement] = []
        self.execution_options: list[dict[str, str]] = []
        self._results: list[_ScalarResult] = []

    def result_for(
        self, result: object | None = None, *, error: type[Exception] | None = None
    ) -> None:
        self._results.append(_ScalarResult(result, error))

    def begin(self) -> _RecordingTransaction:
        return _RecordingTransaction()

    async def connection(
        self, *, execution_options: dict[str, str]
    ) -> RecordingSession:
        """Mirror ``AsyncSession.connection``, which ``read_only`` calls to put
        a read on AUTOCOMMIT. Recorded so tests can assert the isolation level
        a read actually asked for."""
        self.execution_options.append(execution_options)
        return self

    async def execute(self, statement: ClauseElement) -> _ScalarResult:
        self.executed.append(statement)
        if self._results:
            return self._results.pop(0)
        return _ScalarResult()

    async def __aenter__(self) -> RecordingSession:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _RecordingTransaction:
    async def __aenter__(self) -> _RecordingTransaction:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class RecordingSessionFactory:
    """An ``AsyncSessionFactory``-shaped double yielding one shared session."""

    def __init__(self) -> None:
        self.session = RecordingSession()

    def __call__(self) -> RecordingSession:
        return self.session
