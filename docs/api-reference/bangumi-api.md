# Bangumi API v0 Reference

Source: [github.com/bangumi/api](https://github.com/bangumi/api)

We use the **v0 API** (`/v0/` prefix) which provides richer data than the legacy API.

## Base URL

`https://api.bgm.tv/`

All requests **must** include a `User-Agent` header (403 without it).

## Subject Types

| Value | Type |
|-------|------|
| 1 | Book |
| 2 | Anime |
| 3 | Music |
| 4 | Game |
| 6 | Real (live-action) |

## Platform Values (anime sub-types)

| Value | Meaning |
|-------|---------|
| `TV` | TV broadcast series |
| `剧场版` | Theatrical movie |
| `OVA` | Original video animation |
| `Web` | Web-only release |

## Endpoints

### POST `/v0/search/subjects`

Search for subjects by keyword. **POST with JSON body** (not GET).

**Request body:**
```json
{
  "keyword": "君の名は",
  "filter": { "type": [2] },
  "limit": 10
}
```

**Response:**
```json
{
  "total": 177,
  "limit": 10,
  "offset": 0,
  "data": [
    {
      "id": 160209,
      "type": 2,
      "name": "君の名は。",
      "name_cn": "你的名字。",
      "platform": "剧场版",
      "eps": 1,
      "total_episodes": 1,
      "date": "2016-08-26",
      "summary": "...",
      "images": { "large": "...", "common": "...", "medium": "...", "small": "...", "grid": "..." },
      "rating": { "rank": 190, "total": 33572, "score": 8.1, "count": { "1": 41, ... } },
      "tags": [...],
      "series": {...},
      "nsfw": false
    }
  ]
}
```

Key difference from legacy: search results include **full subject data** (platform, tags, series) — no need for separate `get_subject` call.

### GET `/v0/subjects/{id}`

Get subject detail. Same response shape as search items.

**Response fields:**
- `id` — Subject ID
- `type` — Subject type (2 = anime)
- `name` — Original title
- `name_cn` — Chinese title
- `platform` — Sub-type: `TV`, `剧场版`, `OVA`, `Web`
- `date` — First air/release date
- `eps` — Episode count (1 for movies)
- `total_episodes` — Total episodes including specials
- `summary` — Description
- `rating` — `{ rank, score, total, count: { 1..10 } }`
- `images` — Multiple sizes: `large`, `common`, `medium`, `small`, `grid`
- `collection` — Stats: wish, collect, doing, on_hold, dropped
- `tags` — User tags array
- `series` — Series relationships
- `infobox` — Structured metadata (staff, cast, etc.)
- `nsfw` — Boolean

**Determining movie vs TV:** Use `platform` field.
- `platform === "TV"` → TV series → show episode tabs
- `platform === "剧场版"` → movie → hide episode tabs

## Rate Limits

No official rate limit documented. We use 30 req/60s with caching (24h TTL).

## Our Usage

- `resolve_anime` handler uses `search_subject` (POST) to find candidates
- `enrichment.py` uses `get_subject` for metadata (cover, rating, platform, eps_count)
- `platform` stored in `bangumi.platform` DB column
- Subject IDs are shared with Anitabi (same ID system)
