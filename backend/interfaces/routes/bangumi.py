"""Bangumi discovery routes (popular, nearby)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from backend.agents.geo_names import localized_city_name
from backend.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_db_from_request,
    _get_trusted_auth_context,
    _json_response,
    _require_supabase,
)

router = APIRouter(prefix="/v1/bangumi", tags=["bangumi"])


@router.get("/popular")
async def handle_bangumi_popular(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
    limit: int = 8,
) -> JSONResponse:
    if limit < 1:
        raise HTTPException(status_code=422, detail="limit must be a positive integer.")
    db = _require_supabase(_get_db_from_request(request))
    rows_obj: object = await db.bangumi.list_popular(limit=limit)
    rows: list[object] = list(rows_obj) if isinstance(rows_obj, list) else []
    return _json_response({"bangumi": rows})


@router.get("/{bangumi_id}/guide")
async def handle_bangumi_guide(
    request: Request,
    bangumi_id: str,
    locale: Annotated[str, Query()] = "ja",
) -> JSONResponse:
    """Public anime pilgrimage guide — all spots, no auth required."""
    db = _require_supabase(_get_db_from_request(request))
    bangumi = await db.bangumi.get_bangumi(bangumi_id)
    if not bangumi:
        raise HTTPException(status_code=404, detail="Bangumi not found.")

    all_points = await db.points.get_points_by_bangumi(bangumi_id)

    def _float(val: object) -> float:
        if isinstance(val, (int, float)):
            return float(val)
        return 0.0

    spots = [
        {
            "id": str(p.get("id", "")),
            "name": p.get("name", ""),
            "name_cn": p.get("name_cn"),
            "episode": p.get("episode"),
            "time_seconds": p.get("time_seconds"),
            "screenshot_url": p.get("image") or p.get("screenshot_url"),
            "bangumi_id": bangumi_id,
            "latitude": _float(p.get("latitude")),
            "longitude": _float(p.get("longitude")),
            "city": p.get("city"),
        }
        for p in all_points
    ]

    lats: list[float] = [
        s["latitude"]
        for s in spots
        if isinstance(s["latitude"], float) and s["latitude"] != 0.0
    ]
    lngs: list[float] = [
        s["longitude"]
        for s in spots
        if isinstance(s["longitude"], float) and s["longitude"] != 0.0
    ]
    bounds = (
        {
            "north": max(lats),
            "south": min(lats),
            "east": max(lngs),
            "west": min(lngs),
        }
        if lats and lngs
        else None
    )

    for spot in spots:
        raw_city = spot.get("city", "")
        if isinstance(raw_city, str) and raw_city:
            spot["city"] = localized_city_name(raw_city, locale)

    raw_top_city = bangumi.get("city")
    top_city = (
        localized_city_name(raw_top_city, locale)
        if isinstance(raw_top_city, str) and raw_top_city
        else raw_top_city
    )

    return _json_response(
        {
            "bangumi_id": bangumi_id,
            "title": bangumi.get("title"),
            "title_cn": bangumi.get("title_cn"),
            "cover_url": bangumi.get("cover_url"),
            "city": top_city,
            "spot_count": len(spots),
            "spots": spots,
            "bounds": bounds,
        }
    )


@router.get("/nearby")
async def handle_bangumi_nearby(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
    lat: float,
    lng: float,
    radius_m: int = 50000,
) -> JSONResponse:
    if lat < -90.0 or lat > 90.0:
        raise HTTPException(status_code=422, detail="lat must be between -90 and 90.")
    if lng < -180.0 or lng > 180.0:
        raise HTTPException(status_code=422, detail="lng must be between -180 and 180.")
    if radius_m < 1:
        raise HTTPException(status_code=422, detail="radius_m must be positive.")
    db = _require_supabase(_get_db_from_request(request))
    rows_obj: object = await db.bangumi.get_bangumi_by_area(lat, lng, radius_m)
    rows: list[object] = list(rows_obj) if isinstance(rows_obj, list) else []
    return _json_response({"bangumi": rows})
