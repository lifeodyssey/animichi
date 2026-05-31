"""Public search preview — no auth required, returns limited results.

Rate-limited by IP at the application layer (10 req/min).
In production, Cloudflare Rate Limiting Rules + Bot Management
provide the primary defense; this is a fallback.
"""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from backend.interfaces.routes._deps import (
    _get_db_from_request,
    _json_response,
    _require_supabase,
)

router = APIRouter(prefix="/v1/search", tags=["search"])

PREVIEW_LIMIT = 5
RATE_LIMIT_CALLS = 10
RATE_LIMIT_WINDOW_S = 60

# Simple in-memory IP rate limiter (resets on restart, no shared state)
_ip_timestamps: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    window_start = now - RATE_LIMIT_WINDOW_S
    timestamps = _ip_timestamps[ip]
    _ip_timestamps[ip] = [t for t in timestamps if t > window_start]
    if len(_ip_timestamps[ip]) >= RATE_LIMIT_CALLS:
        raise HTTPException(status_code=429, detail="Too many requests.")
    _ip_timestamps[ip].append(now)


@router.get("/preview")
async def handle_search_preview(
    request: Request,
    q: str = "",
    locale: str = "ja",
) -> JSONResponse:
    """Anonymous search preview. Returns up to 5 points for a query."""
    client_host = request.client.host if request.client else "unknown"
    client_ip = request.headers.get("CF-Connecting-IP") or client_host
    _check_rate_limit(client_ip)

    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="q parameter required.")

    db = _require_supabase(_get_db_from_request(request))

    bangumi_id = await db.bangumi.find_bangumi_by_title(query)
    if not bangumi_id:
        return _json_response(
            {
                "results": {
                    "rows": [],
                    "row_count": 0,
                    "total_available": 0,
                    "preview_limit": PREVIEW_LIMIT,
                    "status": "empty",
                },
                "auth_required_for_full": False,
                "message": "",
            }
        )

    bangumi = await db.bangumi.get_bangumi(bangumi_id)
    all_points = await db.points.get_points_by_bangumi(bangumi_id)
    total = len(all_points)
    preview = all_points[:PREVIEW_LIMIT]

    rows = [
        {
            "id": str(p.get("id", "")),
            "name": p.get("name", ""),
            "name_cn": p.get("name_cn"),
            "episode": p.get("episode"),
            "time_seconds": p.get("time_seconds"),
            "screenshot_url": p.get("image") or p.get("screenshot_url"),
            "bangumi_id": bangumi_id,
            "latitude": p.get("latitude", 0),
            "longitude": p.get("longitude", 0),
        }
        for p in preview
    ]

    metadata = {}
    if bangumi:
        metadata = {
            "anime_title": bangumi.get("title"),
            "anime_title_cn": bangumi.get("title_cn"),
            "cover_url": bangumi.get("cover_url"),
            "bangumi_id": bangumi_id,
        }

    return _json_response(
        {
            "results": {
                "rows": rows,
                "row_count": len(rows),
                "total_available": total,
                "preview_limit": PREVIEW_LIMIT,
                "status": "ok" if rows else "empty",
                "metadata": metadata,
            },
            "auth_required_for_full": total > PREVIEW_LIMIT,
            "message": "",
        }
    )
