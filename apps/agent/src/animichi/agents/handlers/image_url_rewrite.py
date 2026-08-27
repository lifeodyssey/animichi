"""Rewrite Anitabi screenshot URLs to route through the CF image proxy."""

from __future__ import annotations

import os

#: Origins whose screenshots must route through /img/. Matched by prefix, both
#: schemes: an http:// URL used to pass the old substring test yet dodge the
#: https-only replace, shipping a mixed-content URL to production.
_ANITABI_ORIGINS = ("https://image.anitabi.cn/", "http://image.anitabi.cn/")


def _rewrite_url(url: str) -> str:
    """Rewrite a single Anitabi image URL to go through our CF proxy."""
    for origin in _ANITABI_ORIGINS:
        if url.startswith(origin):
            return f"/img/{url.removeprefix(origin)}"
    if url.startswith("screenshot/"):
        return f"/img/{url}"
    return url


def _rewrite_row(row: dict[str, object]) -> None:
    url = row.get("screenshot_url")
    if isinstance(url, str) and url:
        row["screenshot_url"] = _rewrite_url(url)


def rewrite_image_urls(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Rewrite Anitabi image URLs to go through our CF proxy.

    In development mode (no CF Worker), keep the original Anitabi URLs
    so images load directly from the CDN.
    """
    if os.environ.get("APP_ENV", "development") == "development":
        return rows
    out = list(rows)
    for row in out:
        _rewrite_row(row)
    return out
