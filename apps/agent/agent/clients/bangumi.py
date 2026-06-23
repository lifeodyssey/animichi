"""
Bangumi API v0 client for anime/manga metadata.

API docs: https://bangumi.github.io/api/
Uses the v0 API which provides richer data (platform, tags, series).
"""

from agent.clients.base import BaseHTTPClient, JSONDict, expect_json_object
from agent.clients.errors import APIError
from agent.utils.logger import get_logger

logger = get_logger(__name__)


class BangumiClient(BaseHTTPClient):
    """Client for the Bangumi v0 metadata API.

    Provides access to anime/manga metadata including:
    - Subject search by keyword (POST /v0/search/subjects)
    - Subject details by ID (GET /v0/subjects/{id})
    """

    BANGUMI_API_BASE = "https://api.bgm.tv"
    USER_AGENT = "Seichijunrei/1.0 (https://github.com/lifeodyssey/Seichijunrei-agent)"

    TYPE_BOOK = 1
    TYPE_ANIME = 2
    TYPE_MUSIC = 3
    TYPE_GAME = 4
    TYPE_REAL = 6

    def __init__(
        self,
        base_url: str | None = None,
        use_cache: bool = True,
        rate_limit_calls: int = 30,
        rate_limit_period: float = 60.0,
    ):
        super().__init__(
            base_url=base_url or self.BANGUMI_API_BASE,
            api_key=None,
            timeout=10,
            max_retries=3,
            rate_limit_calls=rate_limit_calls,
            rate_limit_period=rate_limit_period,
            use_cache=use_cache,
            cache_ttl_seconds=86400,
        )
        logger.info(
            "Bangumi client initialized",
            base_url=self.base_url,
            cache_enabled=use_cache,
            rate_limit=f"{rate_limit_calls}/{rate_limit_period}s",
        )

    async def search_subject(
        self, keyword: str, subject_type: int = TYPE_ANIME, max_results: int = 10
    ) -> list[JSONDict]:
        """Search for subjects by keyword via v0 API.

        Uses POST /v0/search/subjects with JSON body.

        Returns:
            List of subject dicts with id, name, name_cn, platform, images, etc.
        """
        if not keyword or not keyword.strip():
            raise ValueError("Keyword cannot be empty")
        if not 1 <= max_results <= 25:
            raise ValueError("max_results must be between 1 and 25")

        try:
            logger.info(
                "Searching bangumi subjects",
                keyword=keyword,
                subject_type=subject_type,
                max_results=max_results,
            )

            raw = await self.post(
                "/v0/search/subjects",
                json_data={
                    "keyword": keyword,
                    "filter": {"type": [subject_type]},
                    "limit": max_results,
                },
                headers={"User-Agent": self.USER_AGENT},
            )

            data = expect_json_object(raw, context="search_subject")
            raw_list = data.get("data", [])
            results: list[JSONDict] = []
            for item in raw_list if isinstance(raw_list, list) else []:
                if isinstance(item, dict):
                    results.append(item)

            logger.info(
                "Bangumi search completed",
                keyword=keyword,
                results_count=len(results),
            )
            return results

        except APIError:
            raise

        except (OSError, RuntimeError, ValueError, TypeError) as e:
            logger.error(
                "Bangumi search failed",
                keyword=keyword,
                error=str(e),
                exc_info=True,
            )
            raise APIError(f"Bangumi search failed: {str(e)}") from e

    async def get_subject(self, subject_id: int) -> JSONDict:
        """Get subject details via v0 API.

        Uses GET /v0/subjects/{id}. Returns full metadata including
        platform (TV/剧场版/OVA/Web), total_episodes, tags, series.
        """
        if subject_id <= 0:
            raise ValueError("subject_id must be positive")

        try:
            logger.info("Fetching bangumi subject details", subject_id=subject_id)

            raw = await self.get(
                f"/v0/subjects/{subject_id}",
                headers={"User-Agent": self.USER_AGENT},
            )
            subject = expect_json_object(raw, context="get_subject")

            logger.info(
                "Bangumi subject fetched",
                subject_id=subject_id,
                name=subject.get("name"),
                platform=subject.get("platform"),
            )
            return subject

        except APIError:
            raise

        except (OSError, RuntimeError, ValueError, TypeError) as e:
            logger.error(
                "Failed to fetch bangumi subject",
                subject_id=subject_id,
                error=str(e),
                exc_info=True,
            )
            raise APIError(f"Failed to fetch subject {subject_id}: {str(e)}") from e
