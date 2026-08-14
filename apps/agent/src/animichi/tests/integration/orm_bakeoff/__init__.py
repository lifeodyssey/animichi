"""ORM bake-off: SQLModel against the migrated turn_reservations contract.

Test-only package. The SQLModel candidate is the production implementation
(``infrastructure.persistence.repositories.turn_reservation``, #994). The
Atlas migrations under ``migrations/neon`` remain the only schema authority
and the store never emits schema DDL.
"""
