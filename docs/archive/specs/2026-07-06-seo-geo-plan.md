# SEO/GEO Landing Package (SD-27 implementation details + iteration mapping)

> Decision basis: SD-27 A/B/C (inputs §10) + the 2026-07-06 research-agent report (Ahrefs/Semrush/Google first-party data).
> This document = the output of task #9 (implementation details) + #10 (iteration mapping); when backfilling the spec (task #3), split stories/ACs per the "iteration mapping" section.

## 1. JSON-LD mapping table (contracted: entity disambiguation, not chasing rich results)

Basis: FAQ rich results are no longer displayed; TouristAttraction/TouristTrip/ItemList are not in Google's supported list; Ahrefs controlled experiments proved schema gives no AI-citation lift → keep only the minimal entity-disambiguation set, reject schema stuffing.

| Page | JSON-LD | Key points |
|---|---|---|
| Homepage | `Organization` + `WebSite` | Organization: name=Animichi, logo, `sameAs` (X/GitHub etc. social profiles, an Entity-SEO anchor). The only complete version site-wide |
| All content pages | `BreadcrumbList` | Home > Anime > (anchors don't enter the breadcrumb) |
| Anime page `/anime/:id` | `TVSeries` or `Movie` (typed by eps) | name + `alternateName` (trilingual titles) + image (cover) + datePublished. **Point coordinates do NOT enter JSON-LD** (hundreds of Places are noise; crawlers read them from the body text) |
| Area page `/area/:region` | `Place` (lightweight) | name + geo center point |
| Share page `/s/:id` | `TouristTrip` (lightweight) | name + description + station count; itinerary lists only the first/last stations (avoid bloat). **Kept deliberately (an exception to the contraction rule): share pages are real-itinerary entities — this is entity disambiguation, not rich-results chasing, per the SD-27 contraction rationale** |
| 対比図/representative-frame images | `ImageObject` | `contentUrl` + **`license` (CC BY-NC-SA) + `creditText` (origin field)** — two birds: the Anitabi attribution obligation + the Google Images licensable badge |

## 2. Fact-summary block (anime page above-the-fold; feeds both GEO and snippets)

- Positioning correction (after the SAGEO-debunked rhetoric tactic): this is not "GEO magic," it is featured-snippet material + entity clarity + retrievability.
- All data comes from existing catalog fields; **no data we don't have is introduced** (e.g. stations — catalog has no such field, so don't fabricate it):

| Field | Source |
|---|---|
| Total point count | pointsLength |
| Top-3 cities + each one's point count | PostGIS aggregation |
| Suggested pilgrimage duration | route-planner estimate (point count × dwell + walking) |
| Episode range of filming locations | ep-field aggregation (a movie shows "劇場版") |
| Data-source attribution | Anitabi + CC BY-NC-SA (the body-text surfacing point for the license obligation) |

- Form: a `<section>` + `<dl>`, each sentence self-contained and independently quotable (e.g. 「『君の名は。』の巡礼スポットは東京を中心に68ヶ所。」).
- Each of the three languages is generated locally (echoing SD-27C: the localized title/H1/slug hard AC), not a byproduct of translating the body text.

## 3. Domain-migration checklist (seichijunrei.app → animichi.com, done in one pass in Iteration 0)

Current traffic ≈ zero = the lowest-cost migration window. Checklist (all Iteration 0):

- [ ] Onboard animichi.com to Cloudflare; TLS/DNS ready
- [ ] 301 every old-domain path → the corresponding new-domain path (a Worker redirect rule; fall back to the homepage for any path with no match)
- [ ] GSC dual-property verification → file a Change of Address; sync Bing Webmaster
- [ ] canonical / OG / sitemap / robots all point to the new domain; the domain is driven by a build-time env variable, **AC: a repo-wide grep finds no old-domain hardcode residue**
- [ ] Update the Supabase auth callback URL + the email-template domain (the auth-domain list is called out separately — miss one and it's a login incident)
- [ ] Keep the old domain renewed for ≥2 years (the 301 authority-transfer window)

## 4. Sitemap system + new-season SLA + dynamic OG

**Sitemap structure**: index → `sitemap-anime.xml` / `sitemap-areas.xml` / `sitemap-routes.xml` (public shares) / `sitemap-images.xml` (対比図/representative frames) / static pages. `lastmod` must be real (it changes only when the content hash changes — a fake `lastmod` gets Google to lower trust).

**New-season SLA (effective from Iteration 5)**: a new catalog title passes the X15 quality gate (**spot count ≥ 5 — initial value, ops-tunable**) → enters the sitemap within **≤24h**. Implementation = a Worker cron regenerates the sitemap (Neon query → static artifact).
**Push**: Google's sitemap ping endpoint is dead (deprecated 2023) → rely on GSC auto-recrawl + **IndexNow** (instant push for the Bing/Naver family, free, one key file + one POST per new page).

**Dynamic OG (Iteration 4)**: anime page = cover + point count + frame-comparison collage; share page = route thumbnail + station count. 1200×630, copy follows the page language, artifacts cached in R2. Tech choice (the Satori-family workers-og / CF Images) is left to the executor. Iteration 0 ships a static OG fallback first.

## 5. L3 growth analytics (user-approved 2026-07-06)

- **GSC + Bing Webmaster** (Iteration 0): property verification + submit the sitemap. The primary SEO-KPI data source (indexation/clicks/query terms)
- **Cloudflare Web Analytics** (Iteration 0): free, cookieless, a one-line beacon; traffic/referrer reports
- **AI-referral attribution**: an agreed referrer list (chatgpt.com / chat.openai.com / perplexity.ai / claude.ai / copilot.microsoft.com / gemini.google.com) → read the CF referrer report manually during walkthroughs; auto-tagging is deferred (revisit once volume reaches DD-15 level)
- No GA4 (heavy, a privacy burden, its depth isn't needed)
- **KPI baseline (flywheel-4 metrics landing)**: indexed page count (GSC) / organic clicks (GSC) / AI-referral sessions (CF) / AI-citation spot-checks (the claude-seo audit, run once per iteration)

## 6. robots.txt / llms.txt (Iteration 0)

```
# Training crawlers: block (a CC BY-NC-SA compliance posture)
User-agent: GPTBot            → Disallow: /
User-agent: ClaudeBot         → Disallow: /
User-agent: Google-Extended   → Disallow: /
# Search/citation/agent crawlers: allow all (the GEO traffic source + we're an AI app ourselves)
OAI-SearchBot / Claude-SearchBot / Claude-User / ChatGPT-User / PerplexityBot → Allow
Sitemap: https://animichi.com/sitemap.xml
```

- llms.txt: a single static page (site intro + main URL patterns + a reserved MCP-endpoint line), ≤1 hour of work, no llms-full pipeline is built
- **Hard AC (Iteration 0)**: manually check the CF AI Crawl Control panel (the new 2026-09-15 default blocks Training+Agent) + a real `curl` per crawler UA confirming no hidden 403

## 7. Iteration mapping (when backfilling the spec in task #3, split stories/ACs per this)

| Iteration | SEO/GEO content |
|---|---|
| **0 Foundations** | Every item on the domain-migration checklist / robots.txt + llms.txt / sitemap skeleton + IndexNow key / GSC + Bing + CF Analytics / Organization + WebSite + BreadcrumbList / static meta + OG / **the CF crawler-reachability hard AC** |
| **1 計画 Chat** | (no SEO surface) the five photo-search signals ship alongside the full-signal instrumentation |
| **2 Details + list** | (this iteration ships `/routes/:id` + `/routes` as user-private pages — not SSR / not in the sitemap / no SEO surface) — an original slip mistakenly tagged the anime-page SEO here; it has been moved to Iteration 5 (C3 ruling, 2026-07-06) |
| **4 残す しおり** | Dynamic OG (the general rendering pipeline + the share-page template; the anime-page template is wired in at Iteration 5) + 対比図 enters the image sitemap |
| **5 発見 + homepage** | **Anime-page TVSeries/Movie JSON-LD + fact-summary block v1 (trilingual) + ImageObject/license + hreflang kickoff (riding on the `/anime/:id` SSR trilingual routes; per-language localized title/H1/slug = a hard AC)** + area pages `/area/:region` + programmatic rollout in full + site-wide hreflang closure + **the quality gate wired into CI** (template ratio + minimum information density) + the new-season sitemap SLA takes effect |
| **7 Open API** | MCP-as-GEO: MCP Registry + mcp.so/Glama submission + the isitagentready five-dimension self-check + llms.txt gains an MCP-endpoint line |

## 8. Explicit non-goals (a negative checklist, to prevent backsliding)

- ✗ FAQPage schema (no longer displayed) / TouristAttraction stuffing / SearchAction
- ✗ an llms-full.txt maintenance pipeline (97% zero requests)
- ✗ GA4 / a standalone GEO budget / "GEO tactics package" rhetorical optimization (SAGEO-debunked)
- ✗ standalone point pages (→ DD-14) / ward/street-level area pages (thin)
- ✗ the sitemap ping endpoint (dead; use IndexNow)
