"""ORM bake-off fixtures.

The SQLModel candidate is the production implementation
(``infrastructure.persistence.repositories.turn_reservation``, #994); the
bake-off proved the pattern and the long-lived contract suite no longer needs
a DB-backed dual-candidate fixture. The remaining static AST guard in this
package scans that production store for raw-SQL escape hatches.
"""

from __future__ import annotations
