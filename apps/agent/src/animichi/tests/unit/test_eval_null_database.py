"""Unit tests for the eval null database."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable

import pytest

from animichi.domain.ports import CatalogLookup
from animichi.tests.eval.null_database import NullDatabase

RepoCall = Callable[[NullDatabase], Awaitable[object]]


async def _find_bangumi_by_title(db: NullDatabase) -> object:
    return await db.bangumi.find_bangumi_by_title("title")


async def _find_all_by_title(db: NullDatabase) -> object:
    return await db.bangumi.find_all_by_title("title")


async def _find_candidate_details_by_titles(db: NullDatabase) -> object:
    return await db.bangumi.find_candidate_details_by_titles(["title"])


async def _search_points_by_location(db: NullDatabase) -> object:
    return await db.points.search_points_by_location(35.0, 139.0, 500)


async def _get_points_by_ids(db: NullDatabase) -> object:
    return await db.points.get_points_by_ids(["point-1"])


def test_null_database_satisfies_database_port() -> None:
    assert isinstance(NullDatabase(), CatalogLookup)


@pytest.mark.parametrize(
    ("method_name", "call"),
    [
        ("bangumi.find_bangumi_by_title", _find_bangumi_by_title),
        ("bangumi.find_all_by_title", _find_all_by_title),
        ("bangumi.find_candidate_details_by_titles", _find_candidate_details_by_titles),
        ("points.search_points_by_location", _search_points_by_location),
        ("points.get_points_by_ids", _get_points_by_ids),
    ],
)
async def test_repo_methods_raise(method_name: str, call: RepoCall) -> None:
    with pytest.raises(RuntimeError, match=re.escape(method_name)):
        await call(NullDatabase())
