"""User-facing catalog error messages (SD-19 trust boundary).

Every user-visible string for a catalog failure is authored HERE, keyed by
``(error code, locale)`` with a ``(category, locale)`` fallback, and formatted
only from the typed exception's own attributes. Wire messages from the
catalog service are never echoed to users — see
``agent/clients/catalog_errors.py`` and the contract README's
"Error contract" section.
"""

from __future__ import annotations

from agent.clients.catalog_errors import (
    CatalogError,
    RouteTooManyClustersError,
    RouteTooManyPointsError,
    WorkNotFoundError,
)

_DEFAULT_LOCALE = "en"

_CODE_MESSAGES: dict[tuple[str, str], str] = {
    (
        "ROUTE_TOO_MANY_CLUSTERS",
        "ja",
    ): "選択されたスポットが多すぎます（{cluster_count}エリア）。{max_clusters}エリア以内に絞ってもう一度お試しください。",
    (
        "ROUTE_TOO_MANY_CLUSTERS",
        "zh",
    ): "选择的取景地太多（{cluster_count} 个区域）。请缩小到 {max_clusters} 个区域以内再试。",
    (
        "ROUTE_TOO_MANY_CLUSTERS",
        "en",
    ): "Too many spots selected ({cluster_count} areas). Please narrow your selection to at most {max_clusters} areas and try again.",
    (
        "ROUTE_TOO_MANY_POINTS",
        "ja",
    ): "選択されたスポットが多すぎます（{point_count}件）。{max_points}件以内に絞ってください。",
    (
        "ROUTE_TOO_MANY_POINTS",
        "zh",
    ): "选择的取景地太多（{point_count} 个）。请控制在 {max_points} 个以内。",
    (
        "ROUTE_TOO_MANY_POINTS",
        "en",
    ): "Too many spots selected ({point_count}). Please select at most {max_points} points.",
    (
        "WORK_NOT_FOUND",
        "ja",
    ): "この作品の聖地情報が見つかりませんでした。別の作品でお試しください。",
    ("WORK_NOT_FOUND", "zh"): "没有找到这部作品的圣地信息，换一部作品试试吧。",
    (
        "WORK_NOT_FOUND",
        "en",
    ): "No pilgrimage spots found for this work. Try a different anime.",
}

_CATEGORY_MESSAGES: dict[tuple[str, str], str] = {
    (
        "retryable",
        "ja",
    ): "カタログサービスが一時的に利用できません。少し待ってからもう一度お試しください。",
    ("retryable", "zh"): "目录服务暂时不可用，请稍后再试。",
    (
        "retryable",
        "en",
    ): "The catalog service is temporarily unavailable. Please try again in a moment.",
    (
        "user_actionable",
        "ja",
    ): "この操作は完了できませんでした。条件を変えてもう一度お試しください。",
    ("user_actionable", "zh"): "无法完成这次请求，请调整条件后再试。",
    (
        "user_actionable",
        "en",
    ): "We couldn't complete this request. Please adjust your selection and try again.",
    (
        "system",
        "ja",
    ): "サーバー側で問題が発生しました。しばらくしてからもう一度お試しください。",
    ("system", "zh"): "我们这边出了点问题，请稍后再试。",
    ("system", "en"): "Something went wrong on our side. Please try again later.",
}


def build_error_message(exc: Exception, locale: str, *, fallback: str) -> str:
    """Localized user message for a catalog failure; OUR text only (SD-19).

    Typed :class:`CatalogError` -> the code's template (formatted from the
    exception's typed attributes), else the category template, else
    ``fallback``. Non-catalog exceptions always get ``fallback``.
    """
    if not isinstance(exc, CatalogError):
        return fallback
    template = _lookup(_CODE_MESSAGES, exc.code, locale)
    if template is not None:
        return template.format(**_params(exc))
    category_template = _lookup(_CATEGORY_MESSAGES, exc.category, locale)
    return category_template if category_template is not None else fallback


def _lookup(table: dict[tuple[str, str], str], key: str, locale: str) -> str | None:
    """Find ``(key, locale)`` with an English fallback for unknown locales."""
    hit = table.get((key, locale))
    return hit if hit is not None else table.get((key, _DEFAULT_LOCALE))


def _params(exc: CatalogError) -> dict[str, int | str]:
    """Template parameters from the typed exception's own attributes."""
    if isinstance(exc, RouteTooManyClustersError):
        return {"cluster_count": exc.cluster_count, "max_clusters": exc.max_clusters}
    if isinstance(exc, RouteTooManyPointsError):
        return {"point_count": exc.point_count, "max_points": exc.max_points}
    if isinstance(exc, WorkNotFoundError):
        return {"bangumi_id": exc.bangumi_id}
    return {}
