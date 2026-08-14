"""Shared data builders and SQL fixtures for the ORM bake-off contract suite.

Fixture SQL is allowed by the bake-off rules; the candidate implementation
modules themselves carry zero raw SQL.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

import asyncpg

from animichi.application.turn_admission_port import ReserveRequest

ANON_ID = "anon_0123456789abcdef0123456789abcdef"


def turn_key(prefix: str = "turn") -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


def session_id(prefix: str = "sess") -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


def reserve_request(
    *,
    session_id: str | None,
    turn_key: str,
    identity_id: str | None = ANON_ID,
    expected_revision: int | None = None,
    session_digest: str | None = None,
    owner: str | None = None,
    lease_expires_at: datetime | None = None,
) -> ReserveRequest:
    return ReserveRequest(
        session_id=session_id,
        turn_key=turn_key,
        identity_id=identity_id,
        payer="anon",
        expected_revision=expected_revision,
        session_digest=session_digest,
        owner=owner or uuid.uuid4().hex,
        lease_expires_at=lease_expires_at or datetime.now(UTC) + timedelta(seconds=60),
    )


async def insert_row(
    pool: asyncpg.Pool,
    *,
    session_id: str | None,
    turn_key: str,
    revision: int,
    status: str,
    owner: str = "seed-owner",
    lease_expires_at: datetime | None = None,
    identity_id: str | None = None,
) -> None:
    """Seed one turn_reservations row directly (fixture SQL)."""
    async with pool.acquire() as connection:
        await connection.execute(
            "INSERT INTO turn_reservations "
            "(session_id, turn_key, payer, identity_id, revision, digest, status, "
            "lease_owner, lease_expires_at) "
            "VALUES ($1, $2, 'anon', $3, $4, NULL, $5, $6, $7)",
            session_id,
            turn_key,
            identity_id,
            revision,
            status,
            owner,
            lease_expires_at or datetime.now(UTC) + timedelta(seconds=60),
        )


async def count_rows(
    pool: asyncpg.Pool, *, session_id: str | None, turn_key: str | None = None
) -> int:
    async with pool.acquire() as connection:
        if turn_key is None:
            return int(
                await connection.fetchval(
                    "SELECT count(*) FROM turn_reservations "
                    "WHERE session_id IS NOT DISTINCT FROM $1",
                    session_id,
                )
            )
        return int(
            await connection.fetchval(
                "SELECT count(*) FROM turn_reservations "
                "WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2",
                session_id,
                turn_key,
            )
        )


async def fetch_status(
    pool: asyncpg.Pool, *, session_id: str | None, turn_key: str
) -> str | None:
    async with pool.acquire() as connection:
        value = await connection.fetchval(
            "SELECT status FROM turn_reservations "
            "WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2",
            session_id,
            turn_key,
        )
        return value if value is None else str(value)


async def count_active_rows(pool: asyncpg.Pool, session_ids: list[str]) -> int:
    async with pool.acquire() as connection:
        return int(
            await connection.fetchval(
                "SELECT count(*) FROM turn_reservations "
                "WHERE session_id = ANY($1::text[]) "
                "AND status = ANY($2::text[])",
                session_ids,
                ["reserved", "running"],
            )
        )


async def insert_session(
    pool: asyncpg.Pool, *, session_id: str, user_id: str | None, state: object
) -> None:
    async with pool.acquire() as connection:
        await connection.execute(
            "INSERT INTO sessions (id, user_id, state) VALUES ($1, $2, $3::jsonb)",
            session_id,
            user_id,
            json.dumps(state),
        )


async def cleanup(
    pool: asyncpg.Pool,
    session_ids: Iterable[str | None],
    *,
    turn_keys: Iterable[str] = (),
) -> None:
    """Remove rows created by one test (fixture SQL)."""
    non_null = [sid for sid in session_ids if sid is not None]
    keys = list(turn_keys)
    if not non_null and not keys:
        return
    async with pool.acquire() as connection:
        if non_null:
            await connection.execute(
                "DELETE FROM turn_reservations WHERE session_id = ANY($1::text[])",
                non_null,
            )
            await connection.execute(
                "DELETE FROM sessions WHERE id = ANY($1::text[])", non_null
            )
        if keys:
            await connection.execute(
                "DELETE FROM turn_reservations WHERE turn_key = ANY($1::text[])", keys
            )
