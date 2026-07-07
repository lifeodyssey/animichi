"""Source tiering for external web content (SD-19 P1).

Classifies web-search result URLs into two provenance tiers by domain
allowlist. The tier is a reputation label ONLY — "verified" content is
still untrusted external data and is delimited exactly like unverified
content (see ``guardrails.wrap_untrusted_web_results``). Tiering never
upgrades trust; it only tells the model which sources are reputable.
"""

from __future__ import annotations

from typing import Literal
from urllib.parse import urlsplit

SourceTier = Literal["verified", "unverified"]

VERIFIED_SOURCE_DOMAINS: frozenset[str] = frozenset(
    {
        "wikipedia.org",
        "moegirl.org.cn",
        "bgm.tv",
        "bangumi.tv",
        "anitabi.cn",
    }
)

_ALLOWED_SCHEMES = frozenset({"http", "https"})


def classify_source(href: str) -> SourceTier:
    """Classify a URL as ``verified`` (allowlisted domain) or ``unverified``.

    Fails closed: any URL that cannot be parsed into an http(s) host, or
    whose host is not on the allowlist at a dot boundary, is unverified.
    """
    host = _extract_host(href)
    if host is None:
        return "unverified"
    if any(_is_same_or_subdomain(host, domain) for domain in VERIFIED_SOURCE_DOMAINS):
        return "verified"
    return "unverified"


def _extract_host(href: str) -> str | None:
    """Return the lowercased http(s) hostname, or None when unusable.

    A backslash anywhere in the netloc fails closed: browsers treat
    ``\\`` as ``/`` during navigation, so ``urlsplit().hostname`` can
    report a different (allowlisted) host than the one actually
    navigated to (authority confusion, e.g. ``evil.com\\@wikipedia.org``).
    """
    try:
        parts = urlsplit(href.strip())
        host = parts.hostname
    except ValueError:
        return None
    if "\\" in parts.netloc:
        return None
    if parts.scheme.lower() not in _ALLOWED_SCHEMES or not host:
        return None
    return host.lower().rstrip(".")


def _is_same_or_subdomain(host: str, domain: str) -> bool:
    """Dot-boundary domain match — never a substring match."""
    return host == domain or host.endswith("." + domain)
