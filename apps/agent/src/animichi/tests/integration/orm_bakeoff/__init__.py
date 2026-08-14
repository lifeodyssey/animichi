"""ORM bake-off: SQLModel vs Tortoise ORM against the migrated turn_reservations contract.

Test-only comparison package. Neither candidate is imported from production
code; the Atlas migrations under ``migrations/neon`` remain the only schema
authority and neither ORM ever emits schema DDL here.
"""
