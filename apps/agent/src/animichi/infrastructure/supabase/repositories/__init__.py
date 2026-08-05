"""Domain repository modules for Supabase data access."""

from animichi.infrastructure.supabase.repositories.bangumi import BangumiRepository
from animichi.infrastructure.supabase.repositories.feedback import FeedbackRepository
from animichi.infrastructure.supabase.repositories.messages import MessagesRepository
from animichi.infrastructure.supabase.repositories.points import PointsRepository
from animichi.infrastructure.supabase.repositories.routes import RoutesRepository
from animichi.infrastructure.supabase.repositories.session import SessionRepository

__all__ = [
    "BangumiRepository",
    "FeedbackRepository",
    "MessagesRepository",
    "PointsRepository",
    "RoutesRepository",
    "SessionRepository",
]
