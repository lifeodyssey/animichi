"""SQLModel table mappings for the Agent persistence seam (#994, #995).

Mapping-only: no schema creation, migration, or DDL APIs are ever invoked;
the Atlas chain under ``migrations/neon`` remains the only schema authority.
Column types mirror the Atlas migrations exactly so generated statements bind
correct types.
"""

from __future__ import annotations

from animichi.infrastructure.persistence.models.anon_quota import (
    AnonDailyMessageCountModel,
    anon_quota_table,
)
from animichi.infrastructure.persistence.models.bangumi import (
    BangumiModel,
    bangumi_table,
)
from animichi.infrastructure.persistence.models.feedback import (
    FeedbackModel,
    feedback_table,
)
from animichi.infrastructure.persistence.models.memory import (
    AgentMemoryModel,
    AgentMemoryOperationModel,
    memory_operations_table,
    memory_table,
)
from animichi.infrastructure.persistence.models.message import (
    MessageModel,
    message_table,
)
from animichi.infrastructure.persistence.models.points import (
    PointModel,
    points_table,
)
from animichi.infrastructure.persistence.models.request_log import (
    RequestLogModel,
    request_log_table,
)
from animichi.infrastructure.persistence.models.session import (
    SessionModel,
    session_table,
)
from animichi.infrastructure.persistence.models.turn_reservation import (
    TurnReservationModel,
    reservation_table,
)
from animichi.infrastructure.persistence.models.usage import (
    DailyUsageModel,
    daily_usage_table,
)

__all__ = [
    "AgentMemoryModel",
    "AgentMemoryOperationModel",
    "AnonDailyMessageCountModel",
    "BangumiModel",
    "DailyUsageModel",
    "FeedbackModel",
    "MessageModel",
    "PointModel",
    "RequestLogModel",
    "SessionModel",
    "TurnReservationModel",
    "anon_quota_table",
    "bangumi_table",
    "daily_usage_table",
    "feedback_table",
    "memory_operations_table",
    "memory_table",
    "message_table",
    "points_table",
    "request_log_table",
    "reservation_table",
    "session_table",
]
