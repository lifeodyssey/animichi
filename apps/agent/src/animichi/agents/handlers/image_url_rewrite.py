"""Rewrite Anitabi screenshot URLs to route through the CF image proxy."""

from __future__ import annotations

import os


def _rewrite_url(url: str) -> str:
    """Rewrite a single Anitabi image URL to go through our CF proxy."""
    if "image.anitabi.cn/" in url:
        return url.replace("https://image.anitabi.cn/", "/img/")
    if url.startswith("screenshot/"):
        return f"/img/{url}"
    return url


def rewrite_image_urls(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Rewrite Anitabi image URLs to go through our CF proxy.

    In development mode (no CF Worker), keep the original Anitabi URLs
    so images load directly from the CDN.
    """
    if os.environ.get("APP_ENV", "development") == "development":
        return rows

    out = list(rows)
    for row in out:
        url = row.get("screenshot_url")
        if isinstance(url, str) and url:
            row["screenshot_url"] = _rewrite_url(url)
    return out
