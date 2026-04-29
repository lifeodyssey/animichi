# Frontend Architecture Migration: Static Export → SSR on Cloudflare

## Status: Planning (2026-04-28)

## Problem Statement

Current architecture uses `output: "export"` (static HTML) served via Cloudflare Worker ASSETS binding.
This means: no SSR, no ISR, no RSC, no dynamic routes, no SEO, no shareable URLs.
The entire app is a single-page client-rendered shell behind an auth wall.

## Target Architecture

Next.js SSR running on Cloudflare Workers via `@opennextjs/cloudflare`.
Python backend continues running in Cloudflare Container (unchanged).

```
Before:  Worker (auth + static) → ASSETS (out/) + Container (Python)
After:   Worker (Next.js SSR)   → Container (Python, unchanged)
```

## Migration Phases

### Phase 0: Install @opennextjs/cloudflare + remove output: "export"

**Files to change:**
- `frontend/next.config.ts` — remove `output: "export"`, remove `trailingSlash: true`
- `frontend/package.json` — add `@opennextjs/cloudflare`, add build/preview/deploy scripts
- `wrangler.toml` — rewrite for Workers-based Next.js (remove ASSETS binding)

**Verification:** `npm run preview` starts Next.js on Cloudflare Workers locally.

### Phase 1: Landing Page — public, SSR

**Goal:** Landing page renders server-side, no auth required, SEO-ready.

**Files to change:**
- `frontend/app/page.tsx` — SSR landing page (move LandingPage content here)
- `frontend/components/auth/AuthGate.tsx` — no longer the root, only used in /chat
- `frontend/app/layout.tsx` — keep as-is (fonts, metadata, providers)

**New route structure:**
```
/              → Landing page (public, SSR/SSG)
/chat          → AuthGate → AppShell (client, requires login)
/auth/callback → OAuth callback (keep)
/settings      → Settings (requires login)
```

**Design fixes applied during this phase:**
- P0: Fix floating cards mobile overlap
- P1: Fix font-extrabold → font-bold
- P1: Fix placeholder color to --color-muted-fg
- P1: Fix stats gap-12 mobile overflow
- P1: Search bar → honest CTA button (or anonymous preview)
- P1: Gallery cards → remove fake onClick, add hover "登录查看" tooltip

### Phase 2+3 (merged): Anime Detail Pages — `/anime/[bangumiId]`

> **Grill-me decision (2026-04-29):** Phase 2 (search preview) and Phase 3 (anime
> detail) merged into one. The page is NOT a search engine — it's a **作品圣地指南**
> (anime pilgrimage guide) for a single anime. Content is fully public (zero token
> cost — only SQL queries). Login is required only for route planning (LLM token cost).

**Key decisions from grill-me:**
- User intent: "确认这部动漫有圣地可去，判断值不值得跑一趟"
- 3-second proof: cover image + stats + map with markers (combined)
- Page identity: SEO landing page (作品圣地指南), not a search engine
- Free boundary: ALL spots free to view. Login only for "Plan route with AI"
- CTA: "用 AI 规划巡礼路线 →" (not "Log in to see all")
- Layout: map as primary visual, spot list below

**Backend API endpoint:**

```
GET /v1/bangumi/{bangumi_id}/guide

Response 200:
{
  "bangumi_id": "115908",
  "title": "響け！ユーフォニアム",
  "title_cn": "吹响吧！上低音号",
  "cover_url": "https://image.anitabi.cn/bangumi/115908.jpg",
  "spot_count": 70,
  "city": "宇治市",
  "spots": PilgrimagePoint[],     // ALL spots (no limit)
  "bounds": {                      // map viewport
    "north": 34.92, "south": 34.88,
    "east": 135.82, "west": 135.77
  }
}
```

**No auth required.** Rate-limited by IP (10 req/min).

**Frontend route:**
```
/anime/[bangumiId]  → public guide page (SSR)
```

**Page layout:**
```
Header (shared with Landing — logo + login button)
┌─────────────────────────────────────────┐
│ Cover + Title + "70 spots · 宇治市"     │
├─────────────────────────────────────────┤
│                                         │
│   ┌───────────────────────────┐         │
│   │        🗺️ MAP              │         │
│   │   📍📍  📍  📍             │         │
│   │     📍📍📍📍               │         │
│   └───────────────────────────┘         │
│                                         │
│  [用 AI 规划巡礼路線 →]                  │
│                                         │
│  ┌────┐ 大学堂書店前  EP1               │
│  │ 📷 │ screenshot + location           │
│  └────┘                                 │
│  ┌────┐ JR宇治駅      EP2              │
│  │ 📷 │ screenshot + location           │
│  └────┘                                 │
│  ... all spots ...                      │
├─────────────────────────────────────────┤
│ Footer                                   │
└─────────────────────────────────────────┘
```

**Files to change:**
- `backend/interfaces/routes/bangumi.py` — add `GET /v1/bangumi/{id}/guide`
- `frontend/app/anime/[bangumiId]/page.tsx` — new page
- `frontend/app/search/page.tsx` — redirect to `/anime/[id]` when single match
- `frontend/components/auth/LandingPage.tsx` — gallery links to `/anime/[id]`
- `frontend/components/auth/LandingData.ts` — already has bangumi IDs
- Reuse existing map components (react-leaflet / mapbox-gl)

**CTA flow:**
```
/anime/115908 → user sees all 70 spots on map
  → clicks "用 AI 规划巡礼路線 →"
  → redirects to /chat?q=響け！ユーフォニアム
  → if not logged in: /chat redirects to /?login=true
  → after login: /chat auto-sends "帮我规划響け！ユーフォニアム的巡礼路线"
```

**SEO:** 180+ anime pages indexable. Each with structured data (JSON-LD).
Dynamic `<title>`: "響け！ユーフォニアム 聖地巡礼ガイド | Seichijunrei"

**What happens to /search?** Kept as a lightweight redirect:
- `/search?q=響け` → finds bangumi_id → redirects to `/anime/115908`
- `/search?q=ambiguous` → shows disambiguation list (multiple matches)

### Phase 4: Auth Middleware Migration

**Goal:** Replace `worker/worker.js` auth logic with Next.js middleware.

**Files to change:**
- `frontend/middleware.ts` — new file, protects /chat, /settings, /v1/*
- `worker/worker.js` — simplify to only Container proxy + image proxy
- `wrangler.toml` — update routing

**Auth flow:**
```
Public routes (/, /search, /anime/*):    no auth check
Protected routes (/chat, /settings):     middleware checks Supabase session
API routes (/v1/*):                      middleware validates JWT → forwards X-User-Id
```

**Request/Response contract for middleware:**

```
// Protected page request without session:
GET /chat → 302 redirect to /?login=true

// API request without valid token:
GET /v1/runtime → 401 { error: { code: "unauthorized", message: "..." } }

// API request with valid token:
GET /v1/runtime
  → middleware validates JWT via Supabase
  → adds X-User-Id, X-User-Type headers
  → proxies to Container :8080
```

### Phase 5: URL State Management

**Goal:** Chat state reflected in URL for shareability.

**Route:**
```
/chat                    → new chat
/chat?s={sessionId}      → resume existing session
```

**Files to change:**
- `frontend/app/chat/page.tsx` — read session_id from URL params
- `frontend/hooks/useSession.ts` — sync with URL
- `frontend/hooks/useChat.ts` — on new session, update URL

---

## Design Review Findings (from gstack + impeccable audit)

### P0 — Must Fix

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | Floating cards overlap hero text on mobile | `LandingPage.tsx` + `LandingData.ts` | Hide all cards <640px or reposition |
| 2 | Fake search bar (submit → auth modal) | `LandingPage.tsx:137-160` | Phase 2: real search; Phase 1: honest CTA |
| 3 | Fake gallery clicks (all → auth modal) | `LandingPage.tsx:258` | Phase 3: link to /anime/[id]; Phase 1: remove pointer + add tooltip |

### P1 — Should Fix

| # | Issue | File | Fix |
|---|-------|------|-----|
| 4 | font-extrabold(800) on Shippori Mincho | `LandingPage.tsx:125` | Change to `font-bold` (700) |
| 5 | Placeholder uses --color-border (1.8:1 contrast) | `LandingPage.tsx:150` | `placeholder:text-[var(--color-muted-fg)]` |
| 6 | Stats gap-12 no mobile breakpoint | `LandingPage.tsx:164` | `gap-6 sm:gap-12` |
| 7 | Subtitle font-light too thin for CJK | `LandingPage.tsx:131` | `font-normal` + raise color to oklch(45%) |
| 8 | Float card opacity 0.85 forever | `globals.css` seichi-float-in | Change to `opacity: 1` |
| 9 | Hardcoded rgba shadows, not OKLCH | Multiple locations | Convert to oklch() with alpha |
| 10 | Type scale not modular (10 different sizes) | Landing page | Reduce to 5-6 sizes with 1.25 ratio |
| 11 | All sections centered, no rhythm | Entire landing page | Left-align at least one section |

### P2 — Nice to Have

| # | Issue | File | Fix |
|---|-------|------|-----|
| 12 | Body font-weight 300 too thin for CJK | `globals.css:232` | 400 for body, 300 only for specific elements |
| 13 | Scroll cue infinite bounce | `LandingPage.tsx:185` | Stop after 2-3 cycles or on scroll |
| 14 | Gallery cards all identical | `LandingPage.tsx:251` | First 1-2 cards span-2 |
| 15 | Footer missing legal links + language switch | `LandingPage.tsx:290` | Add privacy, contact, locale switcher |
| 16 | 3-step cards are AI slop pattern | `LandingPage.tsx:207` | Redesign as timeline or illustrated flow |
| 17 | Stats row is AI slop pattern | `LandingPage.tsx:162` | Integrate with map thumbnail or imagery |
| 18 | No memorable visual (anime-vs-reality comparison) | Hero section | Add signature visual element |

---

## Execution Order

| Phase | Status | Commit | Description |
|-------|--------|--------|-------------|
| 0 | **Done** | `8b42c81` | SSR migration (@opennextjs/cloudflare) |
| 1 | **Done** | `8b42c81` | Landing page redesign (impeccable craft) |
| 2 | **Done** | `82308eb` | Search preview API + /search page |
| 2+3 | **Next** | — | Anime guide pages `/anime/[id]` (grill-me redesign) |
| 4 | Later | — | Auth middleware migration |
| 5 | Later | — | URL state for /chat |

Branch: `feat/ssr-cloudflare` (worktree at `.claude/worktrees/ssr-migration/`)
