# Iteration 5 — 発見 (Discovery): Anime Pages + Homepage

Detail level: **pre-build refinement**. Story count: 10 (originally 8 product/enabler stories + S5.9 area pages and S5.10 quality-gate-in-CI added by the SD-27 seo-geo-plan.md iteration mapping).

Suggested dependency order: S5.4 (catalog public-data enabler, needs eng-review sign-off, recommended to start early) → S5.1 → {S5.2, S5.3} → S5.6 → S5.7 → S5.8 (can run in parallel with the earlier ones; its consumer is S5.4). S5.5 (homepage) depends on S2.8 (続きから) and S1.1 (search-jump reuse), and can be developed in parallel with the anime page. S5.9 (area pages) can be developed in parallel with S5.1, sharing S5.4's catalog public-data enabler. S5.10 (quality gate in CI) depends on the pages produced by S5.6/S5.9 already existing.

**catalog's first public exposure (risk, see main spec §9)**: S5.4 is this train's **only** story that widens `workers/catalog`'s exposure surface — it needs an eng-review sign-off before merging.

**SD-8 final-decision reminder (backfilled from SD-8)**: S5.5's "続きから" ("Continue From") depends only on `sessions`/`routes` data, **not** on `user_memory` (that table stays dormant — it isn't invested in for new features).

**SEO/GEO content-attribution verification (backfilled from SD-27, corresponds to the same check in iter-2.md; ruling now final — C3, see backfill-conflicts.md)**: `2026-07-06-seo-geo-plan.md` §7's iteration-mapping table once placed "anime-page TVSeries/Movie JSON-LD + fact-summary block v1 + ImageObject/license + hreflang bootstrap" under the "2 Details + List" row, but `/anime/:id` doesn't get built until this iteration (5) — and SD-27 explicitly states the programmatic-SEO main battlefield is iteration 5 — so that table row's attribution was judged to be a typo; this content has been folded into S5.1/S5.6. **Resolution (C3 ruling = adopted, user sign-off 2026-07-06)**: this is now final, not merely a provisional judgment awaiting confirmation (as the earlier draft of this note — and the matching note in `iter-2.md` — both said before the ruling landed); the `seo-geo-plan.md` §7 mapping-table typo has been corrected accordingly. S5.6's earlier-version JSON-LD content (`TouristTrip + CreativeWork`) was the iteration train's original phrasing and **has been superseded by SD-27's JSON-LD-contraction decision** (see the S5.6 revision).

**Translation-eval capacity expansion (backfilled from SD-30 L3)**: the translation-eval case target grows from 62 to roughly 100 cases as part of the domain-specific (L3) tier of the eval-system overhaul (SD-30); this doesn't warrant a dedicated story in this iteration — it falls under flywheel-1 / iteration-1's ongoing prompt-eval infrastructure expansion, since it isn't tied to any anime-page/homepage story shipped here.

---

### S5.1 Anime-page shell (図鑑型 variant, SSR) + SW network-first (X7) + fact-summary block v1 + hreflang bootstrap (backfilled from SD-27)

**Scope**: `/anime/:id` rendered via selective SSR — hero + top 名場面 (famous scenes, sorted by shot count) + an above-the-fold fact-summary block + three-language hreflang bootstrap. The ポスター型 (poster-style) variant B stays archived, not implemented (see main spec §6).

**Design basis**: `作品公開页 状态总览.html` (図鑑型 variant A, finalized); `作品公開页 demo.html`; `user-journey.md` §3.1 "anime public page"; `2026-07-06-seo-geo-plan.md` §2 "fact-summary block" (backfilled from SD-27).

**Core AC**:
- Happy path: `/anime/:id` for a known `bangumi_id` server-renders (SSR) the hero + a top-名場面 list sorted by shot count -> browser
- Empty: an anime with zero pilgrimage-spot records renders a graceful "この作品はまだ聖地情報がありません" ("no pilgrimage-spot data for this title yet") state, not a broken page -> browser
- Error: an unknown/invalid `bangumi_id` returns a proper 404 page, without crashing -> browser
- **X7 hard AC**: with the SW active, requesting `/anime/:id` never returns stale cached HTML (network-first) -> browser
- **Fact-summary block v1 (backfilled from SD-27, trilingual)**: an above-the-fold `<section>+<dl>`-shaped fact-summary block renders, with every field sourced from existing catalog fields (introducing no data that doesn't already exist) — total spot count (`pointsLength`), top-3 major cities (PostGIS aggregation), suggested pilgrimage duration (from the route planner's estimate), the covered episode range (movies show "theatrical release"), and data-source attribution (Anitabi + CC BY-NC-SA); every sentence is self-contained and independently citable (doesn't depend on surrounding context) -> browser
- **hreflang bootstrap hard AC (backfilled from SD-27C)**: `/anime/:id`'s `ja`/`zh`/`en` routes not only cross-link via hreflang, but **each language's `<title>`/`<h1>`/URL slug is localized with keywords in that language** (not the same keyword set simply translated three times) — since ChatGPT/Perplexity/Claude have been observed not to read hreflang tags, localized keywords are the only signal that actually works -> unit
- Anime-page OG (backfilled from SD-27, reusing iteration 4's rendering pipeline): `/anime/:id`'s OG image plugs into the dynamic-OG rendering pipeline built by S4.4, adding an anime-page template (cover + spot count + frame-comparison collage), without rebuilding the core rendering/caching logic -> integration

**Changed files**: `apps/web/src/routes/anime/$bangumiId.tsx` (SSR), `apps/web/src/components/anime-page/*`, `apps/web/src/components/anime-page/FactSummaryBlock.tsx` (new), `apps/web/src/lib/og/templates/animePage.ts` (new), `apps/web/src/sw.ts` (extended rule).

**Dependencies**: S5.4 (data source), S4.4 (OG rendering pipeline).

---

### S5.2 Bubble map

**Scope**: a bubble map (area ∝ spot count), region-name matching, tap → zoom → shot-angle (機位) sheet.

**Design basis**: `作品公開页 demo.html` (bubble tap → zoom → shot-angle sheet); main spec X1 (MapLibre).

**Core AC**:
- Happy path: bubbles render sized by spot count, with region names correctly resolved by the existing place-name-matching logic -> browser
- Empty: an anime whose spots are all in a single region renders a single bubble, not an empty map -> browser
- Error: clicking a bubble for a spot with zero photos still gracefully opens the shot-angle sheet showing the available (non-photo) spot, not a blank sheet -> browser

**Changed files**: `apps/web/src/components/anime-page/CircleBubbleMap.tsx`, `apps/web/src/components/anime-page/SpotSheet.tsx`.

**Dependencies**: S0.4, S5.1, S5.4.

---

### S5.3 「AIにルートを組んでもらう」("Have the AI put together a route") → Chat pre-fill

**Scope**: a CTA deep-linking into chat, pre-filling the anime context.

**Design basis**: `user-journey.md` §3.1 (CTA); `generative-ui.md` (analogous to the A2b reference-state mechanism).

**Core AC**:
- Happy path: clicking the CTA navigates to `/chat` and pre-fills the anime context (as an opening message/context card), so the user doesn't have to retype the title -> browser
- Empty: an anime with zero pilgrimage spots still allows this CTA (chat handles the "0 spots" D2 state itself) -> browser
- Error: a navigation failure (e.g. a JS exception) degrades to a plain `/chat` link, not a dead button -> unit

**Changed files**: `apps/web/src/components/anime-page/AiRouteCta.tsx`, `apps/web/src/lib/chat/prefillContext.ts`.

**Dependencies**: S5.1; reuses S1.1's "A2, arriving with a query" logic.

---

### S5.4 Catalog public-data enabler (new public oRPC route, first public exposure)

**Scope**: supplies the anime page with bubble aggregation and 名場面 ranking data.

**Design basis**: no visual mockup.

**Backend enabler (final, main spec default #3)**: `workers/catalog` gets a new oRPC route (e.g. `catalog.animeOverview`) returning bubble aggregation (region name + count) + a 名場面 ranking (by shot count) + sample routes; the root Worker gets a new `isPublicCatalog` allowlist that forwards `/catalog/public/*` to the existing `env.CATALOG` service binding (**catalog's first public exposure, the only one on this train — needs eng-review sign-off to merge**); `packages/contract` gets the new contract. The **existing** `GET /v1/bangumi/{id}/guide` (agent-side, already public/unauthenticated) stays in place for other consumers — it is not required to migrate.

**Core AC**:
- Happy path: requesting the new public catalog route for a known anime returns bubble-aggregation + 名場面-ranking data -> integration
- Empty: an anime with sparse data (few spots, no clear "region" clustering) returns an empty-but-valid `circles` array, without erroring -> unit
- **Security AC**: the newly allowlisted `/catalog/public/*` exposes only the routes explicitly on the allowlist, not the whole catalog service surface (a test confirms a catalog path not on the allowlist is still blocked) -> integration

**Changed files**: `workers/catalog/src/api/anime-overview.ts` (new), `packages/contract/src/contract.ts` (new contract), `worker/app.ts` (`isPublicCatalog` allowlist).

**Dependencies**: none (can proceed independently first); **needs an eng-review sign-off before merging**.

---

### S5.5 App Home (続きから depends only on sessions/routes, SD-8)

**Scope**: search box + 続きから ("Continue From," in-progress routes) + 人気ランキング ("Popular Ranking").

**Design basis**: `首页 - Seichijunrei.html` (search / 続きから / 人気ランキング).

**Core AC**:
- Happy path: submitting the search box navigates to `/chat` and pre-fills the query (reusing S1.1's A2 entry-point logic) -> browser
- Happy path: a logged-in user with an in-progress route sees a "続きから" card (queried via `workers/users` oRPC, **SD-8 final: depends only on `sessions`/`routes`, not on `user_memory`**) -> integration
- Empty: a logged-out user, or one with no in-progress route, doesn't show the "続きから" block at all (not a broken empty card) -> browser
- Happy path: 人気ランキング renders using the existing `GET /v1/bangumi/popular` (agent-side, an existing endpoint this train does not migrate) -> browser
- i18n: all three blocks' copy renders in ja/zh/en -> unit

**Changed files**: `apps/web/src/routes/index.tsx` (**note**: how this coexists with/divides from S0.6's Landing marketing route is left to be settled during pre-build refinement), `apps/web/src/components/home/{SearchBox,ContinueFromCard,PopularRanking}.tsx`.

**Dependencies**: S2.8 (続きから data source), S1.1 (search-jump reuse).

---

### S5.6 Programmatic SEO (JSON-LD contracted version + per-anime sitemap + new-title SLA + hreflang site-wide closure, backfilled from SD-27)

**Scope** (**revised**: the earlier version's `TouristTrip + CreativeWork` JSON-LD was the iteration train's original phrasing, and **has been superseded by SD-27's "JSON-LD contraction" decision** — TouristAttraction/TouristTrip/ItemList are all outside Google's supported list, and an Ahrefs comparison experiment confirmed schema padding provides no AI-citation benefit). `/anime/:id` pages render JSON-LD per SD-27's contracted mapping table + auto-generate sitemap entries per anime, and this iteration also closes out site-wide hreflang + brings the new-title sitemap SLA into effect.

**Design basis**: `2026-07-06-seo-geo-plan.md` §1 "JSON-LD mapping table," §4 "sitemap system + new-title SLA," §7 "iteration mapping" (backfilled from SD-27); port the pattern from `apps/agent/agent/tests/unit/test_seo_static_files.py` (infrastructure already introduced by S0.8).

**Core AC**:
- Happy path: `/anime/:id` renders **`TVSeries` or `Movie`** JSON-LD (typed by the `eps` field), with `name` + `alternateName` (a trilingual title array) + `image` (cover) + `datePublished`; **spot coordinates do not go into the JSON-LD** (hundreds of `Place` entries would be noise — crawlers read the fact-summary block in the body instead) -> unit
- Happy path: every content page (including `/anime/:id`) renders `BreadcrumbList` JSON-LD (Home > Anime >, with anchors excluded from the breadcrumb) -> unit
- Happy path: 対比図/representative-frame images render `ImageObject` JSON-LD, with `contentUrl` + `license` (CC BY-NC-SA) + `creditText` (taken from catalog's `origin` field) — simultaneously satisfying Anitabi's attribution requirement and Google Images' licensable-image markup -> unit
- Empty: an anime page with zero spots still produces valid (if minimal) JSON-LD, not a missing/broken script tag -> unit
- **One entity, one page + unique data per page (hard AC, backfilled from SD-27C)**: every programmatically generated `/anime/:id` page must contain data field values unique to that anime (spot count / city distribution / episode range, etc.), not just a template with the title swapped — measured data from the 2026 spam update shows sites with 70% templated content took a -78% ranking hit, versus only -3% at 5% templated content; this AC asserts that "non-template field values in the rendered output vary with the anime's actual data," not merely that the HTML structure exists -> integration
- Automation AC: per-anime sitemap entries are auto-generated from catalog data by a build/deploy-time script, not hand-maintained -> integration
- **New-title sitemap SLA (hard AC, in effect starting iteration 5)**: once a new catalog title clears the S5.8 quality gate (X15, spot count ≥ threshold), its sitemap entry must appear in `sitemap-anime.xml` within **≤24 hours** (verified via the Worker cron regeneration mechanism, asserting the time window itself rather than merely "it eventually shows up") -> integration
- **IndexNow push (hard AC)**: adding/updating an anime sitemap entry triggers one IndexNow POST push (to Bing/Naver's family), without relying on Google's now-deprecated sitemap ping endpoint -> integration
- **`lastmod` truthfulness (hard AC)**: a sitemap entry's `lastmod` field only updates when that page's content hash actually changes — never a build timestamp or a fixed value (a fake `lastmod` gets Google to distrust the signal, per SD-27's explicit warning) -> unit
- **Site-wide hreflang closure (backfilled from SD-27C)**: across every programmatic page (`/anime/:id` in full + S5.9's area pages + the homepage), the `ja`/`zh`/`en` hreflang cross-links close into a complete loop, verified with a link-graph test confirming no broken links and no missing language variants (S5.1's hreflang bootstrap covers a single page; this AC verifies the site-wide closure) -> integration

**Changed files**: `apps/web/src/lib/anime-page/structured-data.ts` (rewritten: TVSeries/Movie + BreadcrumbList + ImageObject), `scripts/generate-anime-sitemap.ts` (new, includes `lastmod` hash-comparison logic), `scripts/indexnow-push.ts` (new), `apps/web/src/lib/seo/hreflangGraph.ts` (new, site-wide closure verification).

**Dependencies**: S5.1, S5.4, S5.8 (quality gate, a precondition for the new-title SLA).

---

### S5.7 GEO-citation-friendly formatting + AI-crawler robots policy + internal-link structure

**Scope**: organizing spot addresses/episode numbers/名場面 into fact blocks that AI crawlers can cite cleanly; a robots policy that allows the mainstream AI crawlers through; a closed internal-link loop between the anime page ↔ route detail ↔ homepage ranking. **Spots don't get their own independent pages (echoing DD-14 — an explicit non-goal, not an oversight)**: this story's fact blocks are organized as anchors within the anime page (`/anime/:id#point-:pid`), with no new standalone spot page built — SD-27A's thin-content defense line holds until spot-level UGC depth is judged sufficient; DD-14 registers "spot-level UGC coverage ≥20%" as the unfreeze trigger.

**Design basis**: no visual mockup; inputs' SEO/GEO scope (iteration 5 is the main battlefield).

**Core AC**:
- Happy path: spot addresses/episode numbers/scene names on the anime page are organized in structured "fact block" form (semantic markup, not plain prose), making them easy for AI crawlers to cite cleanly -> unit
- Happy path: `robots.txt` explicitly allows GPTBot/ClaudeBot/PerplexityBot -> unit
- Happy path: bidirectional internal links exist between the anime page ↔ route detail ↔ homepage ranking (verified with a link-graph test) -> unit

**Changed files**: `apps/web/public/robots.txt` (updated), `apps/web/src/components/anime-page/FactBlock.tsx`, `apps/web/src/lib/seo/internalLinks.ts`.

**Dependencies**: S5.1, S5.6.

**Verification step**: after launch, run the `claude-seo` plugin (including the seo-geo agent) per main spec §11 and record the resulting score in this iteration's Tester report.

---

### S5.8 Catalog data-quality gate (X15)

**Scope**: row-level data-quality validation at the catalog publish stage, to prevent "garbage data × SEO amplifier = a garbage-page factory."

**Design basis**: no visual mockup; X15.

**Core AC**:
- Happy path: a spot record with invalid coordinates (outside the valid lat/long range, or sitting on null island 0,0) is rejected/flagged before it reaches the public overview endpoint, and never flows into a public page -> unit
- Happy path: duplicate-spot detection (same coordinates + same episode within a small radius) triggers dedup/merge, so the public page never shows duplicate cards -> unit
- Empty: an anime with zero spots passes the quality gate uneventfully (not misjudged as an anomaly and rejected) -> unit
- **Alerting AC**: a sudden drop or spike in some anime's spot count relative to its last publish triggers an alert (log/notification), rather than a silent publish -> unit

**Changed files**: `workers/catalog/src/publish/qualityGate.ts` (new), `workers/catalog/test/qualityGate.test.ts`.

**Dependencies**: S5.4 (consumes data that has passed the quality gate).

---

### S5.9 Area pages `/area/:region` (prefecture + major-city, two tiers, backfilled from SD-27)

**Scope**: programmatic area pages, covering two granularities — prefecture level + major-city level, **no deeper** (no ward/street-level pages — SD-27A explicitly lists "ward/street-level area pages (thin)" on the negative list). Each area page aggregates the list of anime with pilgrimage spots in that area + that area's spot statistics — this is the second piece of SD-27A's page matrix's "programmatic full rollout" (the first piece being `/anime/:id`).

**Design basis**: no visual mockup; `2026-07-06-seo-geo-plan.md` §1's JSON-LD mapping table, "area page `/area/:region`" row (a lightweight `Place` schema + a geo centroid), §7 iteration mapping.

**Core AC**:
- Happy path: `/area/:region` for a known prefecture `region` renders the list of anime with pilgrimage spots in that area (sorted by spot count) + the area's spot statistics -> browser
- Happy path: a major-city-level area page (e.g. a major city within a given prefecture) renders the same way, with the two tiers clearly distinguished at the routing/parameter level -> browser
- Empty: an area with zero pilgrimage spots (theoretically possible, though not currently the case in the data) renders a graceful empty state, not a 500 or a blank page -> browser
- Error: an unknown/nonexistent area identifier returns a proper 404, without crashing -> browser
- **No-deeper-tier boundary (hard AC)**: no ward/street-level route exists (e.g. a specific ward within some city); requesting that tier should 404 or redirect to the city level, rather than accidentally being reachable as a "shadow route" -> unit
- JSON-LD: area pages render a lightweight `Place` JSON-LD, with `name` + a geo centroid -> unit
- **One entity, one page + unique data** (same principle as S5.6): different area pages' anime lists/statistics must vary with that area's actual data, not be a template copy -> integration
- hreflang: area pages' trilingual routes participate in S5.6's site-wide hreflang closure verification -> integration

**Changed files**: `apps/web/src/routes/area/$region.tsx` (SSR), `apps/web/src/components/area-page/*`, `apps/web/src/lib/area-page/structured-data.ts` (new).

**Dependencies**: S5.4 (catalog public-data enabler, reusing its area-aggregation capability).

---

### S5.10 Programmatic quality gate in CI (template ratio + minimum information-density threshold, backfilled from SD-27)

**Scope**: X15 (S5.8) is catalog's **data-layer** quality gate (coordinate validity/dedup/episode-count completeness, run at `workers/catalog`'s publish stage). This story is a **page-content-layer** quality gate, run in CI against already-built programmatic pages (`/anime/:id` + `/area/:region`), checking template ratio and minimum information density — mapping directly to SD-27C's 2026-spam-update rationale. The two gates trigger at different points (data publish vs. post-build CI check) and are intentionally kept as separate stories rather than merged into one.

**Design basis**: no visual mockup; `2026-07-06-seo-geo-plan.md` §7 "quality gate in CI (template ratio + minimum information density)" (SD-27C).

**Core AC**:
- Happy path: a CI script samples programmatic pages in the build artifact and computes the "fixed template text / total page text" ratio; a page whose ratio exceeds the preset threshold (e.g. 70%) fails CI (blocking deployment), not merely logging a warning -> integration
- Happy path: a CI script checks each programmatic page's "unique information volume" (e.g. the fact-summary block's field count, non-template paragraph length) against a minimum-density threshold; a page below the threshold fails CI -> integration
- Empty: a build artifact with zero programmatic pages (a theoretical edge case that shouldn't happen, but needs graceful handling) doesn't crash the CI script itself -> unit
- Regression: when new fields added by S5.6/S5.9 unexpectedly push the template ratio up, CI catches it before merge, rather than discovering the "garbage-page-factory" effect only after launch -> integration

**Changed files**: `scripts/check-programmatic-quality.ts` (new), `.github/workflows/ci.yml` (new `ci-content-quality` job, or folded into the existing web CI job).

**Dependencies**: S5.6, S5.9 (their output is what gets checked).
