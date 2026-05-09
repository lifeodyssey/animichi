# Bangumi API Reference

Source: [github.com/bangumi/api](https://github.com/bangumi/api)

## Base URL

`https://api.bgm.tv/`

All requests should include a `User-Agent` header.

## Subject Types

| Value | Type |
|-------|------|
| 1 | Book |
| 2 | Anime |
| 3 | Music |
| 4 | Game |
| 6 | Real (live-action) |

## Endpoints

### GET `/search/subject/{keywords}`

Search for subjects by keyword.

**Path params:**
- `keywords` — URL-encoded search terms

**Query params:**
- `type` — Subject type filter (e.g., `2` for anime)
- `responseGroup` — Data size (`small`, `medium`, `large`)
- `start` — Offset for pagination
- `max_results` — Items per page (max 20)

**Response:**
```json
{
  "results": 10,
  "list": [
    {
      "id": 160209,
      "type": 2,
      "name": "君の名は。",
      "name_cn": "你的名字。",
      "summary": "...",
      "images": {
        "large": "https://...",
        "common": "https://...",
        "medium": "https://...",
        "small": "https://...",
        "grid": "https://..."
      }
    }
  ]
}
```

### GET `/subject/{id}`

Get subject detail.

**Response fields:**
- `id` — Subject ID
- `type` — Subject type (2 = anime)
- `name` — Original title
- `name_cn` — Chinese title
- `summary` — Description
- `air_date` — First air date
- `eps` — Episode count (1 for movies, >1 for TV series)
- `rating` — `{ score, total, count: { 1..10 } }`
- `rank` — Global ranking
- `images` — Multiple sizes: `large`, `common`, `medium`, `small`, `grid`
- `collection` — Stats: wish, collect, doing, on_hold, dropped

**Determining movie vs TV:** Use `eps` count. Movies have `eps = 1`, TV series have `eps > 1`.

## Rate Limits

No official rate limit documented, but be respectful. Use caching and avoid rapid requests.

## Our Usage

- `resolve_anime` handler uses `search_subject` to find candidates
- `enrichment.py` uses `get_subject` for metadata (cover, rating, eps_count)
- Subject IDs are shared with Anitabi (same ID system)
