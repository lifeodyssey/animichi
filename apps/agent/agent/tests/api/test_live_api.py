"""Local live API tests — the full hybrid chain against a running stack.

Validates, end to end, what was confirmed live on 2026-06-21:
  Python agent (LLM) -> CatalogClient -> TS catalog Worker -> Supabase Postgres.

Run after starting the local stack:
  supabase start -x studio,imgproxy,vector,analytics   # + apply migrations
  (cd catalog && npx wrangler dev --port 8787)         # DATABASE_URL in .dev.vars
  CATALOG_API_URL=http://127.0.0.1:8787 \
    DEFAULT_AGENT_MODEL=openai:mimo-v2.5@https://api.xiaomimimo.com/v1 \
    uv run animichi-api                                 # agent on :8080

Skips automatically when the stack is not reachable (CI / unit runs).
"""

import os

import httpx
import pytest

pytestmark = pytest.mark.api

CATALOG_URL = os.environ.get("CATALOG_API_URL", "http://127.0.0.1:8787")
AGENT_URL = os.environ.get("AGENT_API_URL", "http://127.0.0.1:8080")
WORK_ID = "160209"  # 君の名は。— has Anitabi pilgrimage points
WORK_QUERY = "君の名は。"


def _reachable(url: str) -> bool:
    try:
        return httpx.get(f"{url}/healthz", timeout=2.0).status_code == 200
    except httpx.HTTPError:
        return False


skip_no_stack = pytest.mark.skipif(
    not (_reachable(CATALOG_URL) and _reachable(AGENT_URL)),
    reason="local stack not running (supabase + catalog wrangler dev + agent serve)",
)


def _post_with_retry(
    url: str, payload: dict[str, object], attempts: int = 4
) -> httpx.Response:
    """POST tolerating workerd-dev's intermittent hung-request 500.

    wrangler dev's local pg.Pool sporadically trips workerd's hung-request
    detector (~1/3 of requests); the real CatalogClient retries, so this mirrors
    it. Production uses Hyperdrive (not a raw pg.Pool) and does not exhibit this.
    """
    last: httpx.Response | None = None
    for _ in range(attempts):
        last = httpx.post(url, json=payload, timeout=45.0)
        if last.status_code == 200:
            return last
    assert last is not None
    return last


@skip_no_stack
def test_catalog_healthz_ok() -> None:
    assert (
        httpx.get(f"{CATALOG_URL}/healthz", timeout=5.0).json()["service"] == "catalog"
    )


@skip_no_stack
def test_catalog_ingest_makes_work_searchable() -> None:
    ingest = _post_with_retry(f"{CATALOG_URL}/catalog/ingest", {"bangumi_id": WORK_ID})
    assert ingest.status_code == 200
    assert ingest.json()["status"] in {"ingested", "in_progress"}
    search = _post_with_retry(f"{CATALOG_URL}/catalog/search", {"query": WORK_QUERY})
    assert search.status_code == 200
    assert len(search.json()["rows"]) > 0


@skip_no_stack
def test_catalog_nearby_returns_sorted_points() -> None:
    body = {"lat": 35.6852, "lng": 139.71, "radius_m": 3000}
    resp = _post_with_retry(f"{CATALOG_URL}/catalog/nearby", body)
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert rows, "expected seeded points near Shinjuku Gyoen"
    distances = [r["distance_m"] for r in rows]
    assert distances == sorted(distances)


@skip_no_stack
def test_agent_runtime_full_hybrid_chain() -> None:
    """agent (LLM) -> CatalogClient -> catalog Worker -> DB, upstream-free."""
    resp = httpx.post(
        f"{AGENT_URL}/v1/runtime",
        json={"text": "君の名は。の聖地を教えて", "locale": "ja"},
        headers={"X-User-Id": "api-test"},
        timeout=90.0,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["intent"] == "search_bangumi"
    assert len(body["data"]["results"]["rows"]) > 0
