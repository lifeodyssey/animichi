# Anitabi API Reference

Source: [github.com/anitabi/anitabi.cn-document](https://github.com/anitabi/anitabi.cn-document)

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
