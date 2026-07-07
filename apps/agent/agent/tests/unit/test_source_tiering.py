"""Unit tests for SD-19 P1 source tiering (classify_source).

The classifier maps a web-search result URL to a trust tier by domain
allowlist. Matching must be exact-domain or dot-boundary subdomain —
never substring — so lookalike hosts cannot claim the verified tier.
"""

from __future__ import annotations

import pytest

from agent.agents.source_tiering import classify_source


@pytest.mark.parametrize(
    "href",
    [
        "https://en.wikipedia.org/wiki/Uji_Station",
        "https://ja.wikipedia.org/wiki/%E5%AE%87%E6%B2%BB%E9%A7%85",
        "https://wikipedia.org/",
        "https://zh.moegirl.org.cn/吹响！悠风号",
        "https://bgm.tv/subject/115908",
        "https://bangumi.tv/subject/160209",
        "https://api.anitabi.cn/bangumi/115908/lite",
        "http://en.wikipedia.org/wiki/Anime",
    ],
)
def test_classifies_allowlisted_domains_as_verified(href: str) -> None:
    assert classify_source(href) == "verified"


@pytest.mark.parametrize(
    "href",
    [
        "https://random-blog.example.com/uji-spots",
        "https://fandom.com/wiki/Hibike",
        "https://wikipedia.org.evil.com/wiki/Uji",
        "https://evilwikipedia.org/wiki/Uji",
        "https://evil.com/en.wikipedia.org/wiki/Uji",
        "https://evil.com/?ref=wikipedia.org",
    ],
)
def test_classifies_unlisted_or_lookalike_domains_as_unverified(href: str) -> None:
    assert classify_source(href) == "unverified"


def test_userinfo_trick_does_not_upgrade_tier() -> None:
    assert classify_source("https://en.wikipedia.org@evil.com/wiki") == "unverified"


@pytest.mark.parametrize(
    "href",
    [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "ftp://wikipedia.org/file",
        "//en.wikipedia.org/wiki/Uji",
    ],
)
def test_non_http_schemes_are_unverified(href: str) -> None:
    assert classify_source(href) == "unverified"


@pytest.mark.parametrize("href", ["", "   ", "not a url", "https://", "https://:80"])
def test_empty_or_malformed_urls_are_unverified(href: str) -> None:
    assert classify_source(href) == "unverified"


def test_host_matching_is_case_insensitive() -> None:
    assert classify_source("HTTPS://EN.WIKIPEDIA.ORG/wiki/Uji") == "verified"


def test_trailing_dot_fqdn_still_matches_allowlist() -> None:
    assert classify_source("https://en.wikipedia.org./wiki/Uji") == "verified"


def test_explicit_port_still_matches_allowlist() -> None:
    assert classify_source("https://en.wikipedia.org:443/wiki/Uji") == "verified"


def test_punycode_homograph_is_unverified() -> None:
    assert classify_source("https://xn--wikipedi-86d.org/wiki") == "unverified"
