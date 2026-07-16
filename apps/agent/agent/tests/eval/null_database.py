"""DB-free eval database double that fails loudly on repository access."""

from __future__ import annotations

from typing import NoReturn

from agent.domain.ports import BangumiRepo, DatabasePort, PointsRepo

_DB_FREE_MESSAGE = "trajectory tier is DB-free — unexpected DB access"


def _raise_access(repo: str, method: str) -> NoReturn:
    raise RuntimeError(f"{_DB_FREE_MESSAGE}: {repo}.{method}")


class _NullBangumiRepo:
    async def find_bangumi_by_title(self, title: str) -> NoReturn:
        _raise_access("bangumi", "find_bangumi_by_title")

    async def find_all_by_title(self, title: str) -> NoReturn:
        _raise_access("bangumi", "find_all_by_title")

    async def upsert_bangumi_title(self, title: str, bangumi_id: str) -> NoReturn:
        _raise_access("bangumi", "upsert_bangumi_title")

    async def upsert_bangumi(
        self,
        bangumi_id: str,
        *,
        title: str | None = None,
        cover_url: str | None = None,
        points_count: int | None = None,
    ) -> NoReturn:
        _raise_access("bangumi", "upsert_bangumi")

    async def find_candidate_details_by_titles(self, titles: list[str]) -> NoReturn:
        _raise_access("bangumi", "find_candidate_details_by_titles")

    async def filter_existing_ids(self, bangumi_ids: list[str]) -> NoReturn:
        _raise_access("bangumi", "filter_existing_ids")


class _NullPointsRepo:
    async def search_points_by_location(
        self,
        latitude: float,
        longitude: float,
        radius_m: int,
        *,
        limit: int = 50,
    ) -> NoReturn:
        _raise_access("points", "search_points_by_location")

    async def get_points_by_ids(self, point_ids: list[str]) -> NoReturn:
        _raise_access("points", "get_points_by_ids")

    async def upsert_points_batch(self, rows: object) -> NoReturn:
        _raise_access("points", "upsert_points_batch")


_BANGUMI_REPO: BangumiRepo = _NullBangumiRepo()
_POINTS_REPO: PointsRepo = _NullPointsRepo()


class NullDatabase:
    """DatabasePort implementation for trajectory evals that must not hit DB."""

    @property
    def bangumi(self) -> BangumiRepo:
        return _BANGUMI_REPO

    @property
    def points(self) -> PointsRepo:
        return _POINTS_REPO


_NULL_DATABASE: DatabasePort = NullDatabase()
