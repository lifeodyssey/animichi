"""Shared asyncpg type aliases, backed by asyncpg-stubs.

Previously this module hand-wrote Protocol shims for asyncpg (which ships
untyped at runtime). With `asyncpg-stubs` installed as a dev dependency,
`asyncpg.Pool`/`asyncpg.Record` are fully typed, so this module now just
aliases the real types under the names the rest of the codebase already
imports (`AsyncPGPool`, `Row`) — kept as a single import point instead of
touching every repository module.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypeAlias

import asyncpg

Row: TypeAlias = asyncpg.Record

# asyncpg.Pool is declared Generic in the stubs but isn't subscriptable at
# runtime (no __class_getitem__), so the subscripted alias only exists for
# static type checking; at runtime it's just the plain class.
if TYPE_CHECKING:
    AsyncPGPool: TypeAlias = asyncpg.Pool[asyncpg.Record]
else:
    AsyncPGPool = asyncpg.Pool
