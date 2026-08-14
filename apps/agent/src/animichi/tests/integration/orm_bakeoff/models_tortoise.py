"""Tortoise ORM mapping of the migrated ``public.turn_reservations`` table.

Mapping-only: no schema generation, migration, or DDL APIs are ever invoked;
the Atlas chain under ``migrations/neon`` remains the only schema authority.
Column types mirror the Atlas migration exactly so generated statements bind
correct types.
"""

from __future__ import annotations

from tortoise import fields, models


class TurnReservationTortoise(models.Model):
    """Row of ``turn_reservations`` (TURN-2 #949, TURN-3 #951)."""

    id = fields.UUIDField(primary_key=True)
    session_id = fields.TextField(null=True)
    turn_key = fields.TextField()
    payer = fields.TextField()
    identity_id = fields.TextField(null=True)
    revision = fields.IntField()
    digest = fields.TextField(null=True)
    status = fields.TextField(default="reserved")
    created_at = fields.DatetimeField(auto_now_add=True)
    updated_at = fields.DatetimeField(auto_now_add=True)
    lease_owner = fields.TextField(default="")
    lease_expires_at = fields.DatetimeField()

    class Meta:
        table = "turn_reservations"


class SessionTortoise(models.Model):
    """Guard-relevant projection of the existing ``sessions`` table."""

    id = fields.CharField(max_length=255, primary_key=True)
    user_id = fields.TextField(null=True)
    state: fields.JSONField[object] = fields.JSONField()

    class Meta:
        table = "sessions"
