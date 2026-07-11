# Map Stack Spike

This standalone spike proves the accepted map-stack ADR at
`docs/superpowers/specs/2026-07-11-map-stack-adr.md` without touching product
apps, shared workers, root package files, or cloud accounts.

## What It Proves

| Spike surface | ADR item | S0.4 acceptance coverage |
| --- | --- | --- |
| Static-first card with branded SVG, SVG projected pins, dashed route, idle MapLibre hydration, and tile-failure toggle | §8.1, D4 | AC3: card remains useful when tiles fail |
| Interactive MapLibre map with PMTiles source, DOM markers, GL dashed route, and fly-outside-coverage button | §8.2, D1, D3 | AC2: out-of-coverage tiles render as plain background |
| Source switch for `pmtiles://` range reads vs local `/tiles/{z}/{x}/{y}.mvt` worker | §8.4, D3 | Proves the ZXY Worker shape before product integration |
| Offline button using `Blob` → `File` → `new PMTiles(new FileSource(file))` | §8.3, D5 | Proves Walk-mode offline tile path |
| `worker/tiles.ts` over local Wrangler R2 simulation | §8.4, D3 | No API keys, no cloud calls |

## Run

```bash
npm ci
npm run dev
```

Open the Vite URL. The default source is the local PMTiles archive served by
Vite via range requests:

```text
http://localhost:5173/
```

The style uses `@protomaps/basemaps` 5.x with the package README's documented
v4 basemaps sprite URL. POI icon layers are disabled in the spike style because
the v4 sprite sheet does not include every 5.x POI icon name.

For the local worker-backed ZXY path:

```bash
npm run worker:seed
npm run worker:dev
```

Then open:

```text
http://localhost:5173/?source=worker
```

Worker smoke endpoints:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/tiles/14/14372/6495.mvt
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/tiles/14/14552/6451.mvt
```

## Data Measurements

| Region / zooms | Size / timing / requests |
| --- | --- |
| `uji-kyoto` z0-15 | 20.4MB / 25s / 45 range requests |
| `uji` z≤12 | 2.8MB, so z12→z15 is about 7.3x |
| Kansai z≤12 | 33.3MB |
| Kanto z≤12 | 35.2MB |
| Japan z≤12 | 327MB in 4m46s / 58 requests |
| Japan z15 estimate | ≤2.4GB, inside the R2 free tier |

The staged archive is `public/tiles/uji-kyoto.pmtiles`, extracted from
`https://build.protomaps.com/20260710.pmtiles` with bbox
`135.68,34.85,135.85,35.02`.

## Attribution

© OpenStreetMap contributors, Protomaps.

## Security And Scope

No API key exists anywhere in this spike. The worker uses Wrangler local R2
simulation only; it does not call Cloudflare APIs or require a cloud account.
