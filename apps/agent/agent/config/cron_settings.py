"""Settings for DB-only retention cron scripts (issue #508).

The anonymous-session (`scripts/purge_anonymous_sessions.py`) and
anon-quota-count (`scripts/purge_anon_quota_counts.py`) purge crons only ever
read a database DSN and their own retention window — never a model. This is
a separate, minimal class rather than a bypass flag on
`agent.config.settings.Settings`: see `test_cron_settings.py` for the
regression this is protecting (a model-credential bypass on `Settings`
proved able to leak into `get_settings()`'s cached singleton).
"""

from __future__ import annotations

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class PurgeCronSettings(BaseSettings):
    """Configuration for the DB-only retention cron scripts.

    Deliberately independent of `agent.config.settings.Settings`. Add a
    field here only if a DB-only cron script reads it; anything else (model
    credentials, service config, ...) belongs on the main `Settings` class.
    """

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    supabase_db_url: str = Field(
        default="", description="Direct Postgres DSN for asyncpg"
    )
    # Anonymous-session retention sweep (issue #273 Task 3). A session with no
    # route output is purged once its conversation has gone this many days
    # without an update; route-bearing sessions are retained permanently
    # regardless of this window (not configurable — see purge_anonymous_sessions).
    anonymous_session_retention_days: int = Field(
        default=30,
        ge=1,
        description="Days of inactivity before a routeless anonymous session is purged",
    )
    # Retention for anon_daily_message_count (issue #282 review): rows older
    # than this many UTC days are eligible for the standalone purge script
    # (scripts/purge_anon_quota_counts.py). 30 mirrors the anonymous-session
    # retention window above.
    anon_daily_message_count_retention_days: int = Field(
        default=30, gt=0, description="Days to keep anon_daily_message_count rows"
    )

    @model_validator(mode="after")
    def validate_required_env(self) -> PurgeCronSettings:
        """Fail fast on the one thing these scripts actually need."""
        if not self.supabase_db_url:
            raise ValueError(
                "Missing required environment variable: SUPABASE_DB_URL. "
                "Check your .env file or run from the project root."
            )
        return self


def get_purge_cron_settings() -> PurgeCronSettings:
    """Build settings for a DB-only retention cron.

    Not cached (unlike `get_settings()`): each cron invocation is a
    short-lived CLI process that calls this exactly once, so an `lru_cache`
    singleton buys nothing and only adds a second cache to reason about.
    """
    return PurgeCronSettings()
