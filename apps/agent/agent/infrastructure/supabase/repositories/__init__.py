"""Domain repository modules for Supabase data access."""

from agent.infrastructure.supabase.repositories.bangumi import BangumiRepository
from agent.infrastructure.supabase.repositories.feedback import FeedbackRepository
from agent.infrastructure.supabase.repositories.messages import MessagesRepository
from agent.infrastructure.supabase.repositories.points import PointsRepository
from agent.infrastructure.supabase.repositories.routes import RoutesRepository
from agent.infrastructure.supabase.repositories.session import SessionRepository

__all__ = [
    "BangumiRepository",
    "FeedbackRepository",
    "MessagesRepository",
    "PointsRepository",
    "RoutesRepository",
    "SessionRepository",
]
