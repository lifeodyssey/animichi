# Spec: Unified Spot Display System

## Problem

Three pages show pilgrimage spot data but with completely different design languages:
- **Landing** (`/`): cinematic editorial (animations, gradient, display serif, asymmetric gallery)
- **Guide** (`/anime/[id]`): Excel spreadsheet (70 identical cards, zero animation, no footer)
- **AppShell ResultPanel**: tool UI (grid/map toggle, PhotoCard, selection bar)

Users experience a jarring visual drop from Landing → Guide → AppShell.

## Goal

Unify spot display into a shared design system. Users should feel "same product, different mode" across all three contexts.

## Shared Components to Extract

### 1. SharedHeader
- Solid bg + border-bottom + boxShadow
- Logo left (28px bold serif + 12px tracking subtitle, inline baseline)
- Right: Login button (public pages) or UserMenu (authenticated pages)
- Animation: seichi-fade-down on mount

### 2. SharedFooter
- Border-top, py-10
- Left: brand "聖地巡礼 · seichijunrei" (14px)
- Right: clickable locale switcher (ja/zh/en cycle)

### 3. SpotCard (replaces both Guide's div cards and PhotoCard)
Two modes via props:
- **browse mode** (Guide page): screenshot + name + EP, read-only, no checkbox
- **select mode** (AppShell): + checkbox overlay, + detail button on hover

Visual specs:
- aspect-[16/10] screenshot, rounded-xl, object-cover
- Name: 14px medium, single line truncate
- EP badge: absolute top-left, 10px semibold, bg-fg/55 backdrop-blur
- Hover: -translate-y-0.5 + shadow-lg (browse) or border-primary (select)
- Scroll reveal: seichi-reveal-pop via useScrollReveal

### 4. EpisodeGroup
- Collapsible group header: display serif, "EP 1-3" or "第1-3話"
- Default: first group expanded, rest collapsed
- Grid inside: repeat(auto-fill, minmax(200px, 1fr))
- Staggered animation delay on cards within group

### 5. SpotMap (wrapper around BaseMap)
- rounded-2xl border
- Height: 320px mobile, 420px desktop
- Markers clickable → popup with name + thumbnail
- scrollWheelZoom: false (prevent accidental zoom)
- Touch: touch-action manipulation

## Page-Specific Layouts

### Guide Page (`/anime/[id]`)

```
SharedHeader
Background gradient (linear-gradient 160deg, same as Landing)

Editorial Hero:
  Cover image (larger: 120x170px) + Title (clamp 28-42px serif)
  + subtitle (CN/JP alternate) + "70 spots · 宇治市"
  Animation: seichi-fade-up staggered

SpotMap (full width, 420px)
  Animation: seichi-fade-up with delay

CTA Card:
  "用 AI 規劃巡禮路線 →" bg-card rounded-xl
  Left: text, Right: primary button
  Animation: seichi-fade-up

EpisodeGroups:
  EP1 (expanded) → SpotCard grid (browse mode)
  EP2 (collapsed)
  EP3 (collapsed)
  ...
  Virtualize if total > 50

SharedFooter
```

### AppShell ResultPanel

```
ResultPanelToolbar (filter chips + view toggle)

Two-pane split (desktop):
  Left 55%: SpotMap (sticky)
    Bottom: floating selection bar when items selected
  Right 45%: scrollable
    EpisodeGroups
      SpotCard grid (select mode, with checkboxes)

Mobile: single column
  SpotMap (fixed height 280px)
  EpisodeGroups below

ChatPopup: right-bottom floating (existing component)
  Only opens on user action or "Plan route" CTA
```

## Type Scale (shared, Perfect Fourth 1.333)

| Token | Size | Usage |
|-------|------|-------|
| xs | 12px | captions, badges |
| sm | 14px | secondary text, labels, footer |
| base | 16px | body, CTA sub-text |
| lg | 18px | lead text |
| xl | 24px | section headings (Guide) |
| 2xl | 28px | h2, logo |
| 3xl | clamp(28px,5vw,42px) | Guide h1 |
| 4xl | clamp(48px,7vw,72px) | Landing h1 |

## Animation System (shared)

All animations use cubic-bezier(0.16,1,0.3,1) (exponential ease-out).
All respect prefers-reduced-motion.

| Animation | Duration | Delay pattern | Used in |
|-----------|----------|---------------|---------|
| seichi-fade-down | 0.5s | — | Header |
| seichi-fade-up | 0.7s | staggered 0.08s | Hero elements, CTA |
| seichi-reveal-pop | 0.5s | staggered 0.04s | SpotCards (scroll reveal) |
| slide-in-right | 0.3s | — | ResultPanel transitions |

## Accessibility Fixes

- [ ] Skip-to-content link in SharedHeader
- [ ] Loading spinner: role="status" + aria-label
- [ ] SpotCard browse mode: remove hover if not clickable, or make clickable (scroll map)
- [ ] SpotCard select mode: aria-pressed on checkbox
- [ ] Images: explicit width/height attributes
- [ ] Focus-visible rings on all interactive elements
- [ ] Virtualize spot lists > 50 items

## SEO (Guide page only)

- [ ] Dynamic `<title>`: "{title} 聖地巡礼ガイド | Seichijunrei"
- [ ] Dynamic meta description
- [ ] JSON-LD structured data (Anime + LocationPage)
- [ ] Heading hierarchy: h1 (title) → h2 (episode groups) → h3 (spot names)

## i18n Fixes

- [ ] CTA link passes locale-appropriate title to /chat?q=
- [ ] City names localized where possible
- [ ] Episode labels: "EP{n}" (ja/en) vs "第{n}集" (zh)

## Migration Plan

1. Extract SharedHeader, SharedFooter → `components/layout/`
2. Extract SpotCard, EpisodeGroup → `components/spots/`
3. Extract SpotMap → `components/spots/`
4. Rewrite Guide page with shared components
5. Refactor ResultPanel to use shared components
6. Update tests
