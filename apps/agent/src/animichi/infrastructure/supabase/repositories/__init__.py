"""Domain repository modules for Supabase data access."""

from animichi.infrastructure.supabase.repositories.bangumi import BangumiRepository
from animichi.infrastructure.supabase.repositories.feedback import FeedbackRepository
from animichi.infrastructure.supabase.repositories.points import PointsRepository
from animichi.infrastructure.supabase.repositories.session import FinalSessionRepository

__all__ = [
    "BangumiRepository",
    "FeedbackRepository",
    "PointsRepository",
    "FinalSessionRepository",
]
