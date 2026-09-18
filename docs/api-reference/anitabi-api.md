# Anitabi API Reference

Source: [`anitabi/anitabi.cn-document` → `api.md`](https://github.com/anitabi/anitabi.cn-document/blob/main/api.md)

- **Pinned upstream commit**: `513aa80e` — 2025-01-10, the last change to `api.md`
- **Transcribed here**: 2026-06-23 · **pin verified**: 2026-09-18

This file is the repository's authority on what we are permitted to request. It is a
**transcription**, not a copy, and there are two things it cannot prove about itself:

- **Currency.** Check it against the *path*, not the repository — that repo takes commits to its
  README and tutorials that do not touch the API terms, so watching the repo HEAD produces false
  alarms while watching `api.md` produces a real signal:

  ```bash
  gh api "repos/anitabi/anitabi.cn-document/commits?path=api.md&per_page=1" -q '.[0].sha'
  ```

  When that stops matching the pin, read their `changelog.md` — terms changes are announced there.

- **Fidelity.** Nothing checks that the transcription below is faithful. Where this file and the
  upstream disagree, the upstream is right.

**Anything not described here is not permitted**, including paths that look analogous to one that
is. Never request the main domain. How this is enforced in code, and the agreed rate, are in
[`../ops/anitabi-egress.md`](../ops/anitabi-egress.md).

## Base URLs

- Data API: `https://api.anitabi.cn/`
- Image API: `https://image.anitabi.cn/`

## ID System

**Anitabi uses Bangumi.tv subject IDs** (`subjectID`). There is no separate Anitabi ID system.

## Endpoints

### GET `/bangumi/{subjectID}/lite`

Lite bangumi info with first 10 points.

**Response fields:**
- `id` — Bangumi.tv subject ID (integer)
- `cn` — Chinese title
- `title` — Original Japanese title
- `city` — Primary pilgrimage city
- `cover` — Cover image URL
- `color` — Theme color (hex)
- `geo` — Center coordinates `[lat, lng]`
- `zoom` — Default map zoom level
- `pointsLength` — Total number of pilgrimage points
- `imagesLength` — Total number of screenshot images
- `litePoints` — First 10 points (array), each with: `id`, `name`, `image`, `ep`, `s` (seconds), `geo`

### GET `/bangumi/{subjectID}/points/detail`

Full point list for a bangumi.

**Query params:**
- `haveImage=true` — Filter to only include points with screenshots

**Response:** Array of point objects:
- `id` — Point ID (string, e.g., `"al3yeri"`)
- `name` — Location name (Japanese)
- `cn` — Location name (Chinese, optional)
- `image` — Screenshot URL
- `ep` — Episode number (null for movies)
- `s` — Timestamp in seconds
- `geo` — Coordinates `[lat, lng]`
- `origin` — Screenshot source attribution
- `originURL` — Source URL

## Image URL Resolution

Append query params to image URLs for different sizes:
- `?plan=h160` — Thumbnail (160px height)
- `?plan=h360` — Mobile-optimized (360px height)
- No param — Full resolution

Cover images follow the pattern: `https://image.anitabi.cn/bangumi/{subjectID}.jpg`

## Notes

- License: CC BY-NC-SA 4.0 — must attribute screenshot origins via `origin` field
- Not all Bangumi subjects have Anitabi data — some return 404
- Movies typically have `ep: null` or missing on most points
