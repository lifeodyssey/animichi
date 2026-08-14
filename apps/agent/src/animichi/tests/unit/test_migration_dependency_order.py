"""Fresh-schema migrations may reference an object only after it exists."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
MIGRATIONS = ROOT / "migrations" / "neon"
EARLY_GRANTS = MIGRATIONS / "20260809000030_grants.sql"
MESSAGES = MIGRATIONS / "20260811000002_table_messages.sql"


def test_messages_grants_follow_messages_table_creation() -> None:
    early_grants = EARLY_GRANTS.read_text()
    messages = MESSAGES.read_text()

    assert "public.messages" not in early_grants
    create_at = messages.index("CREATE TABLE public.messages")
    agent_grant_at = messages.index("ON TABLE public.messages TO agent_svc")
    jobs_grant_at = messages.index("ON TABLE public.messages TO jobs_svc")

    assert create_at < agent_grant_at
    assert create_at < jobs_grant_at
