# Design System — Seichijunrei 聖地巡礼

## Product Context
- **What this is:** AI-powered anime pilgrimage search and route planning
- **Who it's for:** Anime fans planning seichi junrei trips (desktop at home + mobile at station)
- **Space/industry:** Anime tourism, pilgrimage planning
- **Project type:** Chat-first web app with map integration
- **Languages:** ja, zh, en (UI follows browser locale)

## Aesthetic Direction
- **Direction:** 動森キャンプ (Animal Crossing x Yuru Camp) — warm, tactile, cozy
- **Decoration level:** Intentional — torii logo, film frame corners, real anime screenshots tell the story. No decorative blobs, no gradients on text, no glassmorphism.
- **Mood:** The anticipation before a trip. Recognition of a real place from a beloved anime. Warm and inviting, like opening a camp guidebook.
- **Anti-references:** AI-generated warm cream everywhere, generic SaaS dashboards, cold blue palettes, gradient text.

## Logo
- Torii gate + film frame corners (SVG)
- Brand vermillion fill on torii, muted-fg for film corners
- Sizes: 28px (collapsed sidebar), 32px (expanded contexts), 36px (welcome hero)
- White fill variant for dark backgrounds (hero overlay)

## Typography

All fonts loaded via `next/font/google`, self-hosted in static export. Zero external requests.

| Role | Font | Weights | Rationale |
|------|------|---------|-----------|
| **Display/Headings** | Noto Serif JP | 400, 600, 700 | Editorial authority for page titles and section headers. |
| **Body (Latin)** | Nunito | 300, 400, 500, 600, 700 | Rounded, friendly geometric sans. Matches the cozy 動森キャンプ aesthetic. |
| **Body (CJK)** | Noto Sans SC | 300, 400, 500, 700 | Consistent CJK rendering across Chinese/Japanese/Korean. |
| **Body (Japanese)** | Zen Maru Gothic | 400, 500, 700 | Rounded Japanese sans that pairs with Nunito's warmth. |
| **Mono** | IBM Plex Mono | 400 | Coordinates, technical data only. Fallback: SFMono-Regular. |

### Type Scale (4 levels, ~1.4x ratio)
| Level | Size | Font | Weight | Usage |
|-------|------|------|--------|-------|
| 1 | 28px | Noto Serif JP | 700 | Page titles, welcome heading |
| 2 | 20px | Noto Serif JP | 600-700 | Section headers, anime titles, panel headers |
| 3 | 14px | Nunito / Noto Sans SC / Zen Maru Gothic | 300-500 | Body text, card names, descriptions, buttons |
| 4 | 12px | Nunito / Noto Sans SC / Zen Maru Gothic | 500 | Labels, badges, meta text, timestamps |

**Rules:**
- Minimum body text: 12px. Never smaller.
- `text-wrap: balance` on headings (prevent orphans)
- `font-variant-numeric: tabular-nums` on time, distance, and count columns
- Loading text ends with `…` (real ellipsis, not `...`)

### Font Loading
```css
--app-font-display: "Noto Serif JP", "Hiragino Mincho ProN", Georgia, serif;
--app-font-body: "Nunito", "Zen Maru Gothic", "Noto Sans SC", "Hiragino Sans", "Yu Gothic UI", system-ui, sans-serif;
--app-font-mono: "IBM Plex Mono", "SFMono-Regular", monospace;
```
All loaded via `next/font` with `display: 'swap'`. Subset to `latin` (CJK loaded on demand by unicode-range).

## Color

**Approach:** Three-layer system — 90% ground (cream/brown), 8% interactive (teal), 2% emphasis (gold). Brand vermillion for logo only.

### Brand
| Token | Value | Usage |
|-------|-------|-------|
| `--color-brand` | `oklch(58% 0.19 28)` | Logo, torii vermillion — branding only |
| `--color-brand-soft` | `#faf0e6` | Logo background square, brand tint areas |

### Interactive
| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#19c8b9` | Teal — buttons, links, selections, checkmarks, active nav |
| `--color-primary-fg` | `#ffffff` | Text on primary teal backgrounds |
| `--color-primary-soft` | `#e0f7f5` | Active nav highlight, selection tint |
| `--color-cta` | `#f0b429` | Gold — important actions, key operations |
| `--color-cta-fg` | `#5c4813` | Dark text on gold backgrounds |

### Neutrals (動森キャンプ palette, warm cream/brown)
| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#ffffff` | Page background (white) |
| `--color-fg` | `#725d42` | Primary text (warm brown) |
| `--color-card` | `#faf8f3` | Card/panel/surface backgrounds (cream) |
| `--color-muted` | `#f0e8d8` | Disabled backgrounds, skeleton base |
| `--color-muted-fg` | `#9f927d` | Secondary text, labels, placeholders |
| `--color-border` | `#c4b89e` | Borders, dividers (warm) |

### Shadows & Depth
| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-3d` | `#bdaea0` | 3D bottom shadow on buttons/inputs |
| `--color-focus` | `#ffcc00` | Yellow focus ring (game-style) |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` / `-fg` | `#e8f5e9` / `#2e7d32` | Route saved, action completed |
| `--color-warning` / `-fg` | `#fff8e1` / `#f57f17` | Caution states |
| `--color-error` / `-fg` | `#fce4ec` / `#c62828` | Error states, failed requests |
| `--color-info` / `-fg` | `#e0f7f5` / `#00796b` | Informational hints |
| `--color-walk-bg` / `-fg` | `#e8f5e9` / `#2e7d32` | Walking segments in timeline |

### Map Pin Colors
| Token | Value | Usage |
|-------|-------|-------|
| Pin teal | `--color-primary` | Current anime pins |
| Pin green | `#4caf50` | Other anime (K-On!, etc.) |
| Pin orange | `#ff9800` | Other anime (Tamako, etc.) |
| Pin brand | `--color-brand` | Active/highlighted pin |

### Dark Mode
Not supported. Light only. `color-scheme: light` on `<html>`.

## Spacing

**Base unit:** 4px. **Density:** Comfortable.

| Token | Value | Usage |
|-------|-------|-------|
| `2xs` | 4px | Inline gaps, icon margins |
| `xs` | 8px | Chip gaps, card grid gap (compact) |
| `sm` | 12px | Card grid gap (default), filter padding |
| `md` | 16px | Section padding, content margins |
| `lg` | 24px | Major section gaps, content area padding |
| `xl` | 32px | Page-level padding |
| `2xl` | 48px | Section dividers |

## Layout

**Approach:** Hybrid — grid-disciplined for content, creative for welcome hero.

### Sidebar
- Always collapsed: 60px
- Icon-only navigation with hover tooltips
- Items: New Chat, History, Favorites, Settings
- Logo: 44px rounded square with brand-soft background
- No expanded state. No anime context panel. Anime info lives in content header.

### Content Area
- `flex: 1`, no max-width constraint (fills available space)
- Photo grid: `repeat(4, 1fr)` on desktop, `repeat(2, 1fr)` on mobile
- Gap: 12px

### Chat Panel
- **Chat mode** (no results): centered, max-width 640px
- **Popup mode** (results visible): 320×380px floating popup, bottom-right, anchored to chat toggle
- **Mobile**: full-screen overlay

### Breakpoints
| Breakpoint | Behavior |
|-----------|----------|
| Desktop ≥1024px | 60px sidebar + full content + popup chat |
| Tablet 768-1023px | Hamburger menu + full content |
| Mobile <768px | No sidebar, full-width, bottom sheet for results, full-screen chat |

## Border Radius

4-level system with large rounded corners throughout.

| Token | Value | Usage |
|-------|-------|-------|
| `--r-sm` | 12px | Small elements: badges, inline tags, confirm items |
| `--r-md` | 18px | Medium: cards, tooltips, panels |
| `--r-lg` | 24px | Large: frames, modals, popup chat |
| `--r-pill` | 50px | Pill: buttons, chips, inputs, all interactive elements |

All interactive elements (buttons, inputs, chips) use `--r-pill` (50px) for full pill shape.

## Motion

**Approach:** Intentional — every animation serves a purpose.

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances, popup open, card hover |
| `--ease-out-quint` | `cubic-bezier(0.22, 1, 0.36, 1)` | Layout transitions, sidebar, screen changes |
| `--duration-fast` | 150ms | Hover states, chip toggle, button press |
| `--duration-base` | 250ms | Screen transitions, popup, detail sheet |
| `--duration-slow` | 400ms | Welcome hero fade, skeleton shimmer cycle |

**Rules:**
- `prefers-reduced-motion: reduce` → disable all animations + transitions
- Animate `transform` and `opacity` only (compositor-friendly)
- Never `transition: all` — list specific properties
- Skeleton shimmer: `background-size: 200%`, linear gradient sweep

## Shadows

**3D depth system** — buttons and inputs use bottom shadows to create tactile, game-inspired depth.

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-3d` | `0 5px 0 0 #bdaea0` | Primary button/input 3D bottom shadow |
| `--shadow-3d-pressed` | `0 2px 0 0 #bdaea0` | Pressed state (reduced depth) |
| `--shadow-card` | `0 2px 8px rgba(114,93,66,0.08)` | Card elevation |
| `--shadow-popup` | `0 8px 32px rgba(114,93,66,0.15)` | Popup chat, modals |

**Rules:**
- Button hierarchy via shadow depth, NOT color saturation
- Pressed state: remove shadow + `translateY(3px)` to simulate push
- Focus ring: `0 0 0 2px #ffcc00` (yellow, game-style)

## Component Patterns

### Photo Card (`.gc`)
- Aspect ratio: 4:3
- Border: 1px solid --color-border
- Bottom overlay bar: 32px, dark semi-transparent, name + EP badge
- Selected: teal border + 22px checkmark circle top-right
- Hover: translateY(-1px) + border-color change
- Radius: --r-md (18px)

### Chat Bubble
- User (right): primary (teal) bg, white text, radius 18/18/4/18
- AI (left): card (cream) bg, fg text, radius 18/18/18/4
- Max-width: 85%

### Chip / Filter
- Height: auto, padding 4px 12px
- Border: 1px solid --color-border
- Active: primary (teal) bg, white text
- Radius: --r-pill (50px)

### Button
- Primary: card (cream) bg, fg text, 40px height, radius --r-pill, 3D bottom shadow
- CTA: cta (gold) bg, cta-fg text, 40px height, radius --r-pill, 3D bottom shadow
- Ghost: transparent bg, muted-fg text, 40px height
- Danger: error bg, white text, 40px height, radius --r-pill, 3D bottom shadow
- Touch target: minimum 44px
- `touch-action: manipulation` on all buttons
- Pressed: `translateY(3px)` + reduced shadow

### Input
- Background: card (cream)
- Border: 1px solid --color-border
- Radius: --r-pill (50px)
- 3D bottom shadow: `0 5px 0 0 #bdaea0`
- Focus: yellow ring #ffcc00

### Timeline Stop
- Time column: 56px, right-aligned, tabular-nums
- Dot column: 24px, 12px dots (16px for first with glow ring)
- Content column: flex-1, min-width 0
- Walk legs: dashed line (opacity .55) + green pill badge
- Active stop: card bg tint (not border-left stripe)

### Popup Chat
- Size: 320x380px, radius --r-lg (24px)
- Shadow: `0 8px 32px rgba(114,93,66,0.15)`
- Pointer arrow at bottom-right (CSS triangle)
- Header: title + close button
- Body: scrollable messages
- Footer: input (pill) + send button (pill)

### Map
- Provider: Leaflet + OpenStreetMap tiles (free, no API key)
- Pins: 32-36px circles with number/letter, colored by anime
- Walking polyline between route pins
- Floating popup card on active pin (photo + name + EP)

## Accessibility

- `focus-visible` ring (2px solid #ffcc00, 2px offset) on all interactive elements (game-style yellow)
- All icon buttons: `aria-label`
- Semantic HTML: `<button>` for actions, `<a>` for navigation
- Touch targets: minimum 44px
- Color contrast: warm brown text (#725d42) on white/cream backgrounds exceeds WCAG AA
- `<meta name="theme-color">` matches --color-bg

## Anti-Patterns (Never Do)

- No gradient text (background-clip)
- No border-left > 1px decorative stripes on cards
- No glassmorphism decoration (functional backdrop-filter for chat OK)
- No bounce/elastic animations
- No pure #000 text — use --color-fg (warm brown). #fff is OK for --color-bg (page background)
- No hardcoded Tailwind palette colors — use CSS variables
- No 11px or smaller text
- No `transition: all`
- No emoji as interactive icons (use SVG)
- No cards inside cards
- No cold blue palettes — the palette is warm cream/brown
- No AI-generated warm cream everywhere — be intentional with the three-layer depth

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-20 | Logo: Torii + film frame corners | Connects anime (film) + pilgrimage (torii). User chose option A from 4 variants. |
| 2026-04-20 | Dual accent: vermillion brand + blue interactive | Vermillion = torii, blue = trust/interactive. Mixed palette confirmed by user. |
| 2026-04-20 | Chat-first flow | Users describe intent in natural language, AI responds with results. Not a database search tool. |
| 2026-04-21 | Sidebar always collapsed 60px | Eliminates "shape-shifting" between expanded/collapsed. Sidebar = navigation only. |
| 2026-04-21 | Chat popup (not side panel, not bottom sheet) | User chose popup style (like Intercom) over side panel or bottom sheet. Confirmed via mockup comparison. |
| 2026-04-21 | Chat IS search | No separate search page or bar. Chat input is always the way to search. |
| 2026-04-21 | Leaflet + OpenStreetMap for maps | Free, no API key, good enough quality. Real tiles, not gradient blobs. |
| 2026-04-21 | Body font: Noto Sans SC via next/font | Self-hosted, subset, swap. Best CJK rendering. Outfit kept for Latin. |
| 2026-04-21 | All fonts self-hosted via next/font | Zero external requests. Fonts in out/_next/static/media/. |
| 2026-04-21 | Route minimum: 2 spots | Fewer than 2 doesn't make a "route". |
| 2026-04-21 | Favorites: spots + routes | Both can be favorited with ❤️. |
| 2026-04-21 | History = conversation history | Each search = one conversation. History shows past conversations. |
