"""Server-owned copy for deterministic selection outcomes."""

_SELECTED_MESSAGES = {
    "en": "Created a route with {count} selected stops.",
    "ja": "{count}件の選択スポットでルートを作成しました。",
    "zh": "已为{count}处选定取景地规划路线。",
}
_MULTI_MESSAGES = {
    "en": {
        "ok": "Selected works were merged and routed.",
        "empty": "No catalog spots exist for those works yet; choose different ones.",
        "too_large": "That selection has too many spots; narrow your selection.",
        "error": "The catalog could not load those works; please retry.",
    },
    "ja": {
        "ok": "選択した作品のスポットをまとめてルートを作成しました。",
        "empty": "選択した作品にはまだスポットがありません。別の作品を選んでください。",
        "too_large": "スポットが多すぎます。選択する作品を減らしてください。",
        "error": "作品データを取得できませんでした。もう一度お試しください。",
    },
    "zh": {
        "ok": "已合并所选作品的地点并规划路线。",
        "empty": "所选作品暂时没有收录地点，请改选其他作品。",
        "too_large": "地点过多，请减少所选作品。",
        "error": "暂时无法载入这些作品，请重试。",
    },
}
_OMITTED_MESSAGES = {
    "en": " Omitted works: {ids}.",
    "ja": " 対象外の作品: {ids}。",
    "zh": " 未纳入的作品：{ids}。",
}
PLACE_MESSAGES = {
    "en": {
        "ok": "Nearby search complete.",
        "empty": "No pilgrimage spots were found near that place.",
        "error": "Nearby search failed; please retry.",
    },
    "ja": {
        "ok": "周辺の聖地を検索しました。",
        "empty": "その場所の周辺には聖地が見つかりませんでした。",
        "error": "周辺検索に失敗しました。もう一度お試しください。",
    },
    "zh": {
        "ok": "已完成附近圣地搜索。",
        "empty": "该地点附近没有找到巡礼地。",
        "error": "附近搜索失败，请重试。",
    },
}


def selected_route_message(locale: str, count: int) -> str:
    """Render the deterministic selected-point route wrapper."""
    language = locale if locale in _SELECTED_MESSAGES else "en"
    return _SELECTED_MESSAGES[language].format(count=count)


def multi_message(locale: str, status: str, omitted: list[str] | None = None) -> str:
    """Render locale-aware terminal copy and disclose partial omissions."""
    language = locale if locale in _MULTI_MESSAGES else "en"
    message = _MULTI_MESSAGES[language][status]
    if omitted:
        message += _OMITTED_MESSAGES[language].format(ids=", ".join(omitted))
    return message
