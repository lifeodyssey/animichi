"""Normalized route-anime write/read contract against migrated PostgreSQL."""

import pytest

from agent.infrastructure.supabase.client import SupabaseClient

pytest_plugins = ("agent.tests.conftest_db",)


@pytest.mark.integration
async def test_route_anime_associations_round_trip_in_derivation_order(
    real_db: SupabaseClient,
) -> None:
    session_id = "phase1c-route-associations"
    user_id = "phase1c-route-user"
    await real_db.session.upsert_session(session_id, {}, metadata={})
    await real_db.pool.execute(
        """INSERT INTO conversations (session_id, user_id, first_query)
           VALUES ($1, $2, $3)""",
        session_id,
        user_id,
        "multi route",
    )
    try:
        route_id = await real_db.routes.save_route(
            session_id,
            ["115908", "160209"],
            ["p004", "p001"],
            {"route": "fixture"},
        )
        rows = await real_db.routes.get_user_routes(user_id)
        assert rows[0]["id"] == route_id
        assert rows[0]["anime_ids"] == ["115908", "160209"]
        assert rows[0]["anime_titles"] == ["響け！ユーフォニアム", "君の名は。"]
    finally:
        await real_db.pool.execute(
            "DELETE FROM routes WHERE session_id = $1", session_id
        )
        await real_db.pool.execute(
            "DELETE FROM conversations WHERE session_id = $1", session_id
        )
        await real_db.pool.execute("DELETE FROM sessions WHERE id = $1", session_id)
