# Iteration 0 — Foundation

Detail level: **fully elaborated**. Story count: 10 (exceeds the "3-8" guideline; reason, see main spec §③: X1's map ADR and X8's eval tiering are additional must-do items, plus S0.10, the contract-enforcement + hygiene sweep, backfilled from the P3 patch / `docs/superpowers/plans/2026-07-07-refactor-backlog.md`).

Precondition (not a story, an external blocker): **PR #206 (the atlas CI fix) must merge first**, otherwise this iteration's CI baseline can't be trusted.

Suggested dependency order: S0.1 (independent) → S0.2 → {S0.3, S0.4, S0.5} → S0.6 → S0.7 → S0.8 → S0.9 (wrap-up). **S0.10** (contract enforcement + hygiene sweep) is independent and can run in parallel at any point — no hard dependency; the dead-eval-dataset deletions only soft-touch S0.1's eval gating.

**How the SD-interview's final conclusions affect this iteration (see main spec §②, inputs §7's full text SD-0~SD-11)**:
- **SD-0 (domain, finalized)**: `animichi.com` is finalized, no longer pending; S0.8 hardcodes this domain directly rather than leaving a parameter blank awaiting a decision. **`aninavi.app` disposition (settled per SD-30 review, Codex P2 / Fable P2-4)**: execute a 301 → `animichi.com` **if the `aninavi.app` domain is actually held at execution time**; otherwise record an explicit no-op in the ops log (`docs/ops/`) — this is a manual-ops decision with an ops-log record, not an executor judgment call left dangling.
- **SD-1** (migration chain): on the Neon side, confirmed as "dual-chain + atlas-provider-drizzle" (the Drizzle TS schema is the single source of truth); S0.9 adds `docs/ops/migrations.md` to record the boundary and the CI steps.
- **SD-6** (the edge worker): `worker/` is already TS with 16 test cases (**measured 2026-07-07: `entry.test.ts`'s 11 + `auth.test.ts`'s 5 = 16 — this is the authoritative count, correcting the "15" figure in the inputs SD-6 line**); verification found the only real gap is that these tests were never wired into any CI job — S0.3 adds a new CI job for this; it isn't building tests from scratch.
- **SD-4** (the agent runtime): both the Pyodide path and the "TS rewrite" path under D7 are **REJECTED**, finalized; S0.9's documentation consolidation must state this explicitly (not just "REJECTED," but clearly stating "both REJECTED").

**Reproducible performance-test profile `perf-mobile-cold` (added per SD-30 review, Codex P2 on S0.4/S0.7)**: every timing AC in this iteration that names a millisecond/second budget is measured under one fixed, named profile so the threshold is repeatable — **Playwright, Chromium, "Fast 3G" network preset + 4× CPU throttle, cold cache (no service-worker/HTTP cache), 390×844 viewport (DPR 2)**. Any deviation (different network/CPU/viewport) is a different measurement and does not satisfy the AC. Timing budgets below (S0.4's 3s, S0.7's 800ms) are all anchored to this profile. Numeric budgets here are initial values; the executor may tune with evidence.

---

### S0.1 Eval gate tiering (X8)

**User story**: As a Reviewer, I want a PR to trigger a lightweight smoke eval, with the full suite running nightly, so I can still catch agent-behavior regressions before merging without paying the full eval suite's time cost on every single PR.

**Design basis**: no visual canvas; per inputs §6 X8.

**Releasable statement**: once this story ships, any PR that **changes a prompt / model-config / guardrail file** (per the SD-30 path-filter rule — e.g. `apps/agent/agent/agents/prompts/**`, the model-config module, or the guardrail modules such as `context_boundary.py`/`source_tiering.py`/`guardrails.py`; **not** every PR under `apps/agent/**`) automatically runs the **L0 smoke suite (~80 cases: one per path + the P0 set in all three languages, backfilled from SD-30, superseding this story's original ad hoc "5-case" framing)** as a required gate; the **L1 full suite (617 cases today, targeted to grow to ~750 over time per SD-30)** moves to a nightly cron + a manual `workflow_dispatch` trigger; the existing all-off `if: false` configuration disappears. **This path-filter scope is identical to iter-1 S1.13's — the two stories share one SD-30 rule, worded the same.**

**AC**:
- A PR that changes a prompt / model-config / guardrail file triggers the L0 smoke-eval job and it passes on a known-good commit -> integration
- A PR touching only `apps/web/**`, or an `apps/agent/**` file outside the prompt/model-config/guardrail scope (e.g. a telemetry helper), does **not** trigger the eval job (the SD-30 path filter correctly excludes it) -> integration
- Deliberately injecting one broken case into the L0 set fails the job and blocks the merge (a required branch-protection check) -> integration
- The nightly cron triggers the L1 full suite (617 cases today) on schedule (asserted via the workflow schedule, not a real wait) -> unit

**Files changed**: `.github/workflows/ci.yml`, a new or modified agent-eval job definition, a new nightly cron workflow file (e.g., `.github/workflows/agent-eval-nightly.yml`).

**Dependencies**: none.

---

### S0.2 The apps/web TanStack Start skeleton + pnpm workspace registration

**User story**: As a developer, I want an `apps/web` TanStack Start skeleton that's registered in the pnpm workspace and running `animal-island-ui-tailwind@1.0.x`, so later iterations have a foundation to build on.

**Design basis**: no specific canvas; `docs/DESIGN.md` as the token baseline (this story only wires things up, without consuming specific tokens — that's S0.5's job).

**Releasable statement**: `pnpm --filter web dev` runs a branded but blank TanStack Start app; `pnpm --filter web build` produces `.output/`; CI runs typecheck/lint/test/build against it.

**AC**:
- A fresh clone + `pnpm install` + `pnpm --filter web build` succeeds and produces `.output/server/index.mjs` + `.output/public` -> integration
- Visiting an undefined route renders a branded 404 (not the browser's default blank page) -> browser
- When `animal-island-ui-tailwind` is pinned to a broken 1.0.x version, the CI install step gives a clear lockfile error instead of silently installing the wrong version -> unit

**i18n scope note**: the i18n system is introduced by S0.6; this story has no user-facing copy yet (a blank skeleton page), so no i18n AC applies here; once S0.6 lands, the 404 page's copy gets trilingual support.

**Files changed**: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/app.config.ts`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`, `pnpm-workspace.yaml` (adds an `apps/web` entry; updates the stale "leave in place, Wave 4" comments on `frontend`/`worker`).

**Dependencies**: none.

---

### S0.3 Deployment-chain fix + edge-worker CI wiring (backfilled from SD-6/X14)

**User story**: As the Coordinator, I want the deploy pipeline to build and publish `apps/web` (instead of the already-deleted Next.js frontend), so that tag-based deploys keep working after the rebuild; I also want root `worker/`'s existing test suite to actually run in CI, instead of merely passing locally without ever being gated on.

**Design basis**: no visual canvas; the current state of `worker/entry.ts`/`worker/app.ts` (verified by the Planner, see the risk register); the SD-6 verification findings.

**Releasable statement**: after pushing a version tag, `apps/web`'s TanStack build artifact deploys to Cloudflare via the existing Hono-wrapped Worker; the `/healthz`, `/img/*`, `/v1/*` route behavior is unchanged; `worker/entry.test.ts`+`worker/auth.test.ts` (16 cases) run and gate every PR touching `worker/**`.

**AC**:
- `wrangler deploy --dry-run` (or an equivalent CI check) successfully references `.output/public` as the assets directory and a handler derived from `.output/server/index.mjs` as the catch-all -> integration
- Visiting a nonexistent route in apps/web still returns a real, branded 404 response, not a Worker exception -> browser
- If `.output/server/index.mjs`'s export shape doesn't match the existing `NextHandler` interface, the build/typecheck step fails explicitly (the adapter layer's TypeError is caught by a unit test), rather than silently deploying a broken worker -> unit
- The three existing route classes `/v1/*`, `/img/*`, `/healthz` behave unchanged after switching the catch-all handler (reusing/extending the existing `entry.test.ts`/`app.ts` tests) -> unit
- **SD-6 CI wiring**: add a new `ci.yml` job (or reuse the existing pattern) that runs the existing `worker/entry.test.ts`+`worker/auth.test.ts` whenever `worker/**` changes; the Planner verified the previous `changes` path filter had no `worker/**` entry, so this job was never triggered before -> integration

**Files changed**: `wrangler.toml` (`[assets] directory` changes to `.output/public`; remove the `NEXT_PUBLIC_MAPBOX_TOKEN`-related secret reference, see X1), `worker/entry.ts` (replace the `nextHandler` import + an adapter layer), `.github/workflows/_web-ci.yml` (`working-directory: apps/web`, pnpm, a vite build replacing the next build), `.github/workflows/deploy.yml` (the frontend build step switches to apps/web, removing the `NEXT_PUBLIC_MAPBOX_TOKEN` env), `.github/workflows/ci.yml` (a new `worker/**` path filter + corresponding job).

**Dependencies**: S0.2.

---

### S0.4 Map-stack ADR + spike (X1)

**User story**: As a developer, I want a working MapLibre GL + Protomaps (pmtiles on R2) spike, so that Iteration 1's chat map card and the later offline Walk feature can be built on an already-validated stack instead of hitting problems as we go.

**Design basis**: `user-journey.md` §6.6 "map-card pin language" (a visual spec, engine-agnostic); `spec-chat-page-design.md` §4's static-first/GL-on-demand approach (read "Mapbox" in that text as MapLibre per X1).

**Releasable statement**: a demo route inside apps/web renders a MapLibre GL map mounted with a pmtiles data source (sourced from R2), with the pin visual language (teal/gold dots) colored per the DESIGN.md tokens; the ADR document is checked in, establishing a `docs/adr/` directory (fixing the gap flagged in report C, "no unified ADR directory").

**Backend enabler**: create a new R2 bucket, `seichijunrei-assets`, and declare a `[[r2_buckets]]` binding in `wrangler.toml`; the `/tiles/*` prefix holds pmtiles tiles covering at least the Kansai/Kanto regions. This is an explicit exception to D9 (Pulumi as a non-goal) for this train (a root Worker declaration directly, bypassing Pulumi).

**AC**:
- The spike route loads visible tiles within 3s (initial value; executor may tune with evidence) under the **`perf-mobile-cold` profile** (Playwright / Fast 3G / 4× CPU throttle / cold cache / 390×844), measured from navigation start to the first tile paint -> browser
- A bbox request outside the tile coverage gracefully returns an empty tile (the map shows its background color, not a broken-tile icon) -> browser
- Simulating an R2 fetch failure (404/500) degrades to a static, branded illustration basemap (an option that already exists in spec-chat-page-design.md §4), not a blank map -> browser

**Files changed**: `docs/adr/0001-map-stack-maplibre-protomaps.md` (new, establishing the ADR directory), `wrangler.toml` (`[[r2_buckets]]`), `apps/web/src/routes/_dev/map-spike.tsx`, `scripts/build-pmtiles.sh` (or an equivalent tile-build script).

**Dependencies**: S0.2. **Blocks**: S1.4, S1.5, S2.2, S5.2 (every story that consumes the map must wait for this one).

---

### S0.5 The DS token foundation + Zen Maru Gothic + a CI alignment test

**User story**: As a developer, I want apps/web wired up to `animal-island-ui-tailwind@1.0.x`'s tokens, with Zen Maru Gothic vendored in, and a CI test that asserts token alignment, so that every subsequent component story inherits a correct, test-protected visual language instead of everyone doing their own thing.

**Design basis**: `docs/DESIGN.md` (the token authority; the frontmatter is missing explore/walk/map-*, to be backfilled); `DS 补全 - Chat 桌面.html` (the radius-sm=16px governance rule, S8); `docs/ds-审计.md` (2 contrast-ratio FAILs, for later component-level fixes to reference).

**Releasable statement**: apps/web's globals.css exposes `--color-*` semantic tokens that align 1:1 with the package's `--animal-*` primitives (including a backfilled explore/walk/map-pin-* family); any Japanese text renders in Zen Maru Gothic; a CI test fails whenever the package's token values drift without the semantic layer being kept in sync.

**AC**:
- Rendering a Japanese string resolves a computed `font-family` that hits Zen Maru Gothic -> unit
- With `DESIGN.md`'s frontmatter missing explore/walk/map-*, those tokens still have a defined fallback default at runtime (not `undefined`) -> unit
- Bumping `animal-island-ui-tailwind` to a simulated version that changes `--animal-primary-color`'s value fails the token-alignment CI test (using a fixture to simulate the regression) -> unit
- a11y: after the fix, the two token combinations `--color-muted-fg` (originally ~2.8:1) and white-on-teal (originally ~2.1:1) both reach ≥4.5:1, verified by a contrast-ratio-calculation unit test -> unit

**Files changed**: `apps/web/src/styles/globals.css`, `apps/web/src/styles/fonts.css` (vendored from `assets/fonts.css`), `apps/web/tests/design-token-alignment.test.ts`, `apps/web/package.json` (`animal-island-ui-tailwind@^1.0.16`).

**Dependencies**: S0.2.

---

### S0.6 Spike code migration (Landing + login modal + i18n + Storybook)

**User story**: As a user, I want to see the Landing page, a magic-link login modal, and correct multilingual copy on the rebuilt site, so the migration doesn't regress what the spike already validated.

**Design basis**: `Landing - Seichijunrei.html` (day/night toggle, hero, comparison slider, the magic-link form).

**Releasable statement**: `/` (the marketing landing route) renders the migrated Landing page, with a day/night toggle and a working magic-link login modal (wired to **Neon Auth** — Better Auth base, via the Neon Auth SDK; auth backend per SD-31, replacing Supabase Auth); the locale switcher works correctly across ja/zh/en; Storybook runs the migrated components' stories.

**AC**:
- Visiting `/` renders the Landing hero and the "Start Exploring" CTA, with the day/night toggle persisted via localStorage -> browser
- Submitting the magic-link form with an empty email shows an inline validation message without sending a request -> unit
- A failed Neon Auth magic-link request (network/5xx) shows on-brand error copy, not a bare exception -> browser
- i18n: switching locale to zh/en re-renders all of Landing's copy (hero/CTA/login form), with no hardcoded ja fallback strings leaking through -> unit

**Files changed**: `apps/web/src/routes/index.tsx`, `apps/web/src/components/landing/*`, `apps/web/src/components/auth/LoginModal.tsx`, `apps/web/src/i18n/*` (dictionary + context, migrated from the spike), `apps/web/.storybook/*`, `apps/web/src/components/**/*.stories.tsx`.

**Dependencies**: S0.2, S0.5 (tokens).

---

### S0.7 Static splash + deleting the old frontend/

**User story**: As a mobile user, I want to see a branded splash screen, ≤800ms, following the system's light/dark setting, when I open the app; as a developer, I want the old Next.js frontend completely removed, so we only maintain one frontend codebase.

**Design basis**: `Splash 静态版.html` (the `.phone.day`/`.phone.night` two frames, no JS, no animation; the rule is "follow the system · ≤800ms · never enters a scene-cut").

**Releasable statement**: opening the app shows the static splash and proceeds within ≤800ms (no scene-cut animation, per the rule); the `frontend/` directory and its CI/deploy wiring are completely removed from the repo.

**AC**:
- When the system is in light mode (or `prefers-color-scheme: light`), the day frame renders and the splash completes within 800ms (initial value; executor may tune with evidence) under the **`perf-mobile-cold` profile** (measured as splash-removal / first interactive-route paint time) -> browser
- When the system's color-scheme is unavailable (an older browser), it gracefully falls back to the day frame as the default, not an undefined state -> unit
- The splash never blocks for more than 800ms (initial value; executor may tune with evidence) under the **`perf-mobile-cold` profile** (whose 4× CPU throttle is the concrete "slow device" definition; pure CSS, with no dependency on a JS timer), measured as splash-removal time -> browser
- Repository structural check: the `frontend/` directory no longer exists, and CI no longer references it -> integration

**Files changed**: `apps/web/src/routes/__root.tsx` (splash-gating logic), `apps/web/public/splash-day.*`, `apps/web/public/splash-night.*`; **deleted**: `frontend/**`; clean up the stale Next.js-specific comments in `worker/entry.ts`.

**Dependencies**: S0.3 (the deploy chain must point at apps/web first before it's safe to delete the old frontend/).

---

### S0.8 SEO/GEO foundation + domain finalization (`animichi.com`, SD-0) + Lighthouse CI (backfilled from SD-27 + `2026-07-06-seo-geo-plan.md` §3/5/6/7)

**User story**: As the site owner, I want the rebuilt site to ship with baseline SEO/GEO infrastructure (robots/sitemap/hreflang/OG/llms.txt/crawler reachability) and a performance-budget gate, and I want that infrastructure to point directly at the real production domain (including the auth-callback domain), so that search-engine and AI-crawler visibility — and performance — don't regress from the rebuild, and so we don't have to leave a pile of placeholders waiting for the domain to be "decided later."

**Design basis**: no visual canvas; migrating the test infrastructure pattern from `apps/agent/agent/tests/unit/test_seo_static_files.py`; `docs/superpowers/specs/2026-07-06-seo-geo-plan.md` §3 (the domain-migration checklist)/§5 (L3 growth analytics)/§6 (robots/llms.txt)/§7 (the iteration mapping).

**Releasable statement**: apps/web ships robots.txt (blocking training crawlers `GPTBot`/`ClaudeBot`/`Google-Extended`, allowing search/citation/agent crawlers `OAI-SearchBot`/`Claude-SearchBot`/`Claude-User`/`ChatGPT-User`/`PerplexityBot`, with a `Sitemap` directive pointing at `https://animichi.com/sitemap.xml`), a sitemap.xml skeleton (including the root URL, with an IndexNow key file reserved), trilingual hreflang+canonical (all pointing at the `animichi.com` domain), a default OG card (1200x630) + a Twitter summary_large_image card, llms.txt v1 (**a static single page — no llms-full pipeline is built**, backfilled from SD-27C's negative checklist; if the original draft ever envisioned an llms-full pipeline, it is explicitly voided here); Lighthouse CI fails the build when LCP>2.5s or CLS>0.1; dual-property verification with GSC + Bing Webmaster + Cloudflare Web Analytics wired in (the L3 growth-analytics baseline, not GA4); `aninavi.app` gets a 301 redirect to `animichi.com` **if that domain is held at execution time, otherwise a no-op recorded in the ops log** (a manual-ops decision, non-blocking).

**The domain-migration checklist (backfilled from seo-geo-plan §3; every item goes into this story — the auth-callback domain must not be missed)**:
1. Onboard `animichi.com` to Cloudflare, with TLS/DNS ready.
2. 301 every path from the old domain (seichijunrei.app) to the corresponding new-domain path (a Worker redirect rule; anything with no matching page falls back to the homepage).
3. Dual-property verification in GSC → file a Change of Address; sync property verification in Bing Webmaster too.
4. canonical/OG/sitemap/robots all point at the new domain, with the domain driven by a build-time environment variable (`CANONICAL_DOMAIN`).
5. **Update the Neon Auth callback/redirect URL + the magic-link email template's domain to `animichi.com`** (SD-31 — the auth backend is Neon Auth, not Supabase; the domain still migrates to `animichi.com`, only the auth backend being configured changes; and since S0.6 already wires the login modal to Neon Auth **in this same iteration**, this callback/template config must target Neon Auth here too, rather than being deferred). Missing this item is a login incident, not an ordinary SEO gap — the seo-geo-plan §3 original text stresses "miss one of these and it's a login incident".
6. Keep the old domain's registration renewed for ≥2 years (the 301 authority-transfer window; non-blocking, logged as an ops to-do).

**AC**:
- robots.txt returns `Disallow: /` for training crawlers (`GPTBot`/`ClaudeBot`/`Google-Extended`) and `Allow: /` for search/citation/agent crawlers (`OAI-SearchBot`/`Claude-SearchBot`/`Claude-User`/`ChatGPT-User`/`PerplexityBot`), and includes `Sitemap: https://animichi.com/sitemap.xml` (**the SD-0 finalized domain, not a placeholder**) -> unit
- sitemap.xml has no anime/route URLs yet at this point (those are added in Iteration 5), but is still well-formed XML containing at least the root URL (`https://animichi.com/`); the IndexNow key file is reachable at its conventional path (reserved for Iteration 5's new-season SLA push) -> unit
- A missing/broken (404) OG image fails the SEO test suite rather than shipping silently -> unit
- i18n: hreflang tags cover ja/zh/en/x-default, and each language's title (50-60 display-width) / description (120-160) stay within bounds (reusing the old test's CJK width-counting logic) -> unit
- **Domain wrap-up (SD-0)**: the `CANONICAL_DOMAIN` config value is set directly to `animichi.com` (the variable name is kept for a possible future domain change, but it is no longer a pending placeholder); the **Neon Auth** magic-link redirect allowlist and email template are updated to this domain in sync (SD-31 — the auth backend is Neon Auth, consistent with S0.6 in this same iteration; was Supabase) -> unit
- **No old-domain hardcode residue (backfilled from seo-geo-plan §3 item 4)**: a repo-wide grep over `apps/web/**` finds zero hardcoded occurrences of any legacy domain (`seichijunrei.app`, `seichijunrei.zhenjia.dev`, `seichijunrei.zhenjia.org`) — every canonical/OG/sitemap/robots reference resolves through the `CANONICAL_DOMAIN` build-time variable (value `animichi.com`), not a literal; legacy domains may appear **only** in the 301 redirect rules and the migration checklist -> unit
- **Old-domain 301 Worker rule (backfilled from seo-geo-plan §3 item 2, Fable P2-5)**: the Worker redirect rule 301s every path from the legacy production domain(s) (`seichijunrei.app` / `seichijunrei.zhenjia.dev`) to the corresponding `animichi.com` path, falling back to the homepage for any path with no matching page -> integration
- **`aninavi.app` conditional 301 (settled per SD-30 review)**: if the `aninavi.app` domain is held at execution time, a 301 → `animichi.com` rule is in place; otherwise the no-op decision is recorded in the ops log — verified as a checklist item, not left to silent executor judgment -> manual/ops (post-deploy Tester checklist)
- **JSON-LD scope reduction (backfilled from SD-27/seo-geo-plan §1, replacing the original "FAQPage" idea)**: the homepage ships `Organization` (name=Animichi, with `sameAs` social-profile anchors) + `WebSite`; every content page ships `BreadcrumbList`; **FAQPage schema is not implemented** (already discontinued for display; explicitly excluded per SD-27C's negative checklist) -> unit
- **Hard AC for crawler reachability (backfilled from SD-27B/seo-geo-plan §6)**: manually check the CF AI Crawl Control panel and keep evidence on file (confirming the allowlist hasn't been overridden by the panel, since CF blocks Training+Agent-class crawlers by default for new sites starting 2026-09-15); for each allowed crawler UA above, run a real `curl -A "<UA>" https://animichi.com/` and assert there's no hidden 403 -> manual/ops (post-deploy Tester checklist)
- **L3 growth-analytics wiring**: GSC and Bing Webmaster both complete property verification and submit the sitemap; the Cloudflare Web Analytics beacon is mounted and at least one pageview is visible on the dashboard -> manual/ops (post-deploy Tester checklist)

**Files changed**: `apps/web/public/robots.txt`, `apps/web/public/sitemap.xml`, `apps/web/public/llms.txt`, `apps/web/public/<indexnow-key>.txt`, `apps/web/src/routes/__root.tsx` (head meta + the CF Web Analytics beacon), `apps/web/src/lib/structured-data.ts` (Organization+WebSite+BreadcrumbList JSON-LD, migrated with FAQPage dropped), `apps/web/tests/seo-static-files.test.ts` (migrated from `test_seo_static_files.py`, with path adjustments + new crawler-UA reachability tests), `.github/workflows/_web-ci.yml` (a new Lighthouse CI step), the **Neon Auth** redirect allowlist + email-template config (magic-link, including the callback domain; SD-31 — was Supabase Auth), a Worker 301 redirect rule (old domain → new domain).

**Dependencies**: S0.2, S0.6 (i18n). **No longer blocked on a domain dependency** (SD-0 is now finalized).

---

### S0.9 Documentation backfill (the contradiction checklist + the X5 forward-looking statement + consolidating D7's "both REJECTED" + migrations.md, backfilled from SD-1)

**User story**: As a developer joining the project after the rebuild, I want CLAUDE.md/ARCHITECTURE.md/the deployment docs to describe the real TanStack/apps-web architecture (instead of stale Next.js references), and I want one authoritative document telling me where the boundary sits between the Neon and Supabase migration chains, so I'm not misled and don't have to go ask someone.

**Design basis**: none.

**Releasable statement**: `docs/ARCHITECTURE.md`, `docs/todo.md`, `docs/ops/deployment.md`, the root `AGENTS.md`/`CLAUDE.md`, the `wrangler.toml` comments, the CI comments, and `docs/testing-strategy.md` are all rewritten to describe apps/web + TanStack Start + MapLibre (no longer frontend/ + Next.js + OpenNext + Mapbox); D7 is documented as **both REJECTED** (neither Pyodide nor the TS rewrite — not "in progress"); X5's forward-looking statement about the edge auth model is written in; a new `docs/ops/migrations.md` (SD-1) records the boundary and CI steps between the Neon chain (Drizzle+atlas-provider-drizzle) and the Supabase chain (the supabase CLI).

**AC**:
- Grepping `docs/ARCHITECTURE.md` and `docs/ops/deployment.md` for "Next.js"/"OpenNext"/"Mapbox" returns zero hits after the rewrite (asserted by a repo-hygiene test script) -> unit
- `docs/testing-strategy.md`'s coverage-numbers section is rewritten to "see the actual vitest.config.ts values from Iteration 0 for apps/web's coverage floor," not a stale hardcoded percentage -> unit
- D7's three generations of self-overturned documentation are consolidated into one clear passage explicitly labeled "both REJECTED" (Pyodide + the TS rewrite) (a test asserts the string "REJECTED" appears near both the "Pyodide" and the "TS rewrite" descriptions in `ARCHITECTURE.md`) -> unit
- X5's target auth model ("the edge lets anonymous+Turnstile+quota-tagged traffic through") is written into `docs/ARCHITECTURE.md`'s auth chapter as a forward-looking statement (to be backfilled as an accomplished-fact description once S1.8 lands; this story only states the direction) -> unit
- **New from SD-1 (backfilled from SD-1; the dual-chain + atlas-provider-drizzle decision, replacing the original X13 "drop atlas" claim, which has since been withdrawn)**: `docs/ops/migrations.md` exists and covers at least three things — the Neon chain (`workers/catalog/src/db/schema.ts` as the single source of truth → atlas-provider-drizzle generates the desired state → `atlas migrate diff/lint/apply` versioned migrations), the Supabase chain (the supabase CLI, unchanged, unaffected by this migration chain), and the corresponding CI steps -> unit

**Files changed**: `docs/ARCHITECTURE.md`, `docs/todo.md`, `docs/ops/deployment.md`, `AGENTS.md`/`CLAUDE.md`, `wrangler.toml` (comments), `.github/workflows/*.yml` (comments), `docs/testing-strategy.md`, `docs/ops/migrations.md` (new).

**Dependencies**: soft dependency on S0.3/S0.4 (the documentation should describe the actual landed state, not something aspirational).

---

### S0.10 Contract enforcement + hygiene sweep (backfilled from the P3 patch / `docs/superpowers/plans/2026-07-07-refactor-backlog.md`: F1 + the F2-F6 hygiene batch + dead eval-dataset/TODO cleanup)

**User story**: As the operator maintaining the hybrid backend, I want the catalog worker's public contract enforced at compile time and validated at runtime (so a drift between the router and `@seichijunrei/contract` can't silently ship and so malformed public inputs are rejected at the edge), and I want the accumulated small-debt in the agent package swept out (dead dependencies, dead code, an importlib hack, an official tool we're reimplementing, unreferenced eval fixtures, and stale TODOs), so the rebuild starts from a clean, contract-locked baseline instead of carrying known cruft into every later iteration.

**Design basis**: no visual canvas; `docs/superpowers/plans/2026-07-07-refactor-backlog.md` (the "Scheduled into stories (iter-0)" rows F1 + the hygiene batch), governed by X16 (the refactoring mandate + its three disciplines). X11/SD-2's literal "consume the contract" landing.

**Releasable statement**: `workers/catalog/src/router.ts` is rebuilt on top of `implement(catalogContract)` from `@orpc/server` (with `@seichijunrei/contract` added as a catalog dependency), giving a compile-time shape lock against the shared contract plus runtime zod validation on public inputs; and the agent-package hygiene batch lands — the zombie `pydantic-ai-guardrails` dependency is gone, `reverse-geocoder` moves to a scripts/dev dependency group, the dead `LogContext`/`LogTimer` in `utils/logger.py` are deleted, `asyncpg-stubs` replaces the `importlib` import hack + hand-written `Protocol` shims in `infrastructure/supabase/`, `web_tools.py` adopts the official `pydantic_ai.common_tools.duckduckgo.duckduckgo_search_tool()` (with the SD-19 untrusted-content delimiter wrapping kept **outside** the tool), the 4 unreferenced eval datasets are deleted, and the 2 stale TODOs in `persistence.py` are resolved. No behavior changes for end users; the agent's 7 tools and the catalog's public routes keep the same external shapes.

**AC**:
- **F1 contract shape lock**: `workers/catalog/src/router.ts` is implemented via `implement(catalogContract)` from `@orpc/server`, with `@seichijunrei/contract` declared in `workers/catalog/package.json`; a deliberately-introduced mismatch between a router handler's return shape and the contract fails the TypeScript build (asserted by a type-level/compile test) -> unit
- **F1 runtime input validation**: a public catalog route rejects a malformed input payload (e.g., a wrong-typed or out-of-range field) with a zod validation error at the boundary rather than passing it through to the handler -> integration
- **F2 zombie dependency removed**: `pydantic-ai-guardrails` no longer appears in `apps/agent/pyproject.toml`, and a repo-wide grep confirms zero imports of it (this closes the same dead-dependency finding that iter-1 S1.6/S1.12 carry only as a backstop) -> unit
- **F3 `reverse-geocoder` relocated**: `reverse-geocoder` is moved out of the agent's production dependencies into a scripts/dev dependency group; the production dependency set no longer includes it (asserted against `pyproject.toml`), and nothing in the production import graph imports it -> unit
- **F4 dead code deleted**: `LogContext` and `LogTimer` are removed from `apps/agent/agent/utils/logger.py`, and a grep confirms no remaining references anywhere in the package -> unit
- **F5 `asyncpg-stubs` replaces the importlib hack**: `asyncpg-stubs` is added as a dev dependency, `apps/agent/agent/infrastructure/supabase/client.py`'s `importlib.import_module("asyncpg")` hack and the hand-written `Protocol` shims in `client_types.py` are removed in favour of a direct typed `import asyncpg`, and `mypy --strict` still passes over the module -> unit
- **F6 official DuckDuckGo tool adopted**: `apps/agent/agent/agents/web_tools.py` uses `pydantic_ai.common_tools.duckduckgo.duckduckgo_search_tool()` instead of the hand-rolled search call, while the SD-19 `<untrusted_web_result>` delimiter + untrusted-content wrapping stays **outside** the tool (a test asserts the tool's raw results are still delimiter-wrapped before entering the model context) -> integration
- **Dead eval datasets deleted**: the 4 unreferenced fixtures (`apps/agent/agent/tests/eval/datasets/agent_eval_v2.json` / `plan_quality_v1.json` / `agent_eval_smoke.json` / `frontend_flows_v1.json`) are deleted, and a check confirms no test or eval-runner code references them (the L0/L1 suites per SD-30 do not depend on them) -> unit
- **Stale TODOs resolved**: the 2 TODOs in `apps/agent/agent/interfaces/persistence.py` (lines 124/232 — session compaction and conversation-history wiring) are each either implemented or explicitly converted into a tracked, dated decision comment with no bare `TODO` left; a grep asserts those two bare `TODO` markers are gone -> unit

**Files changed**: `workers/catalog/src/router.ts` (rebuilt on `implement(catalogContract)`), `workers/catalog/package.json` (`@seichijunrei/contract` dependency), `workers/catalog/test/*` (contract shape-lock + input-validation tests), `apps/agent/pyproject.toml` (drop `pydantic-ai-guardrails`, move `reverse-geocoder` to a dev/scripts group, add `asyncpg-stubs`), `apps/agent/agent/utils/logger.py` (delete `LogContext`/`LogTimer`), `apps/agent/agent/infrastructure/supabase/client.py` + `client_types.py` (drop the importlib hack + hand-written Protocols, use `import asyncpg`), `apps/agent/agent/agents/web_tools.py` (official `duckduckgo_search_tool()`, SD-19 wrapping kept outside), `apps/agent/agent/tests/eval/datasets/{agent_eval_v2,plan_quality_v1,agent_eval_smoke,frontend_flows_v1}.json` (deleted), `apps/agent/agent/interfaces/persistence.py` (resolve the 2 TODOs).

**Dependencies**: none (soft-touch on S0.1 for the eval-dataset deletions — coordinate so a deleted fixture isn't referenced by S0.1's L0/L1 gating).
