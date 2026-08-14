"""SQLModel/SQLAlchemy persistence seam (SESSION-4 #994).

``infrastructure/persistence`` owns the Agent's database lifecycle, the
SQLModel table mappings, and the repository adapters. Atlas remains the sole
DDL authority — nothing here creates, alters, or migrates schema.
"""

from __future__ import annotations
