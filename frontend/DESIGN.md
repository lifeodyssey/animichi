---
version: alpha
name: Seichijunrei
description: Anime pilgrimage spot search and route planning service — 動森キャンプ warm cream palette, WCAG AA verified
colors:
  bg: "#ffffff"
  fg: "#725d42"
  card: "#faf8f3"
  muted: "#f0e8d8"
  muted-fg: "#9f927d"
  border: "#c4b89e"
  primary: "#19c8b9"
  primary-fg: "#ffffff"
  cta: "#f0b429"
  cta-fg: "#5c4813"
  secondary: "#e0f7f5"
  focus: "#ffcc00"
  brand: "oklch(58% 0.19 28)"
  3d-shadow: "#bdaea0"
  marker-active: "#d33c33"
  success: "#cadeca"
  success-fg: "#003306"
  error: "#f8d4d3"
  error-fg: "#4c0f15"
  warning: "#f6d9b2"
  warning-fg: "#411f00"
typography:
  display:
    fontFamily: Noto Serif JP
    fontSize: 42px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.01em
  heading:
    fontFamily: Noto Serif JP
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.2
  subheading:
    fontFamily: Nunito
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: Nunito
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Nunito
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: Nunito
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.02em
rounded:
  sm: 12px
  md: 18px
  lg: 24px
  pill: 50px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  section: 48px
components:
  button-primary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.pill}"
    height: 48px
    padding: 0 32px
    boxShadow: "0 5px 0 0 {colors.3d-shadow}"
  button-cta:
    backgroundColor: "{colors.cta}"
    textColor: "{colors.cta-fg}"
    rounded: "{rounded.pill}"
    height: 48px
    padding: 0 32px
    boxShadow: "0 5px 0 0 {colors.3d-shadow}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.fg}"
    border: "2px solid {colors.border}"
    rounded: "{rounded.pill}"
    height: 40px
    padding: 0 20px
  card-spot:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    boxShadow: "{shadows.card}"
  badge-episode:
    backgroundColor: "rgba(0,0,0,0.55)"
    textColor: "#ffffff"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
    backdropFilter: "blur(4px)"
  header:
    backgroundColor: "{colors.card}"
    height: 56px
    borderBottom: "2px solid {colors.border}"
  group-toggle:
    rounded: "{rounded.pill}"
    boxShadow: "0 3px 0 0 {colors.3d-shadow}"
    border: "2px solid {colors.border}"
---

## Overview

Seichijunrei is an anime pilgrimage (聖地巡礼) spot search and route planning service. Users discover meaningful scenes from anime, see them on a map, and turn selected spots into a realistic walking route.

The interface feels like a **high-quality travel planning tool** — warm, cozy, and practical. It reduces blank-page anxiety and replaces it with momentum: users feel oriented, inspired, and ready to go out.

**Brand personality:** warm, cozy, practical
**Aesthetic:** 動森キャンプ (Animal Crossing x Yuru Camp)
**Anti-references:** generic SaaS dashboards, "AI chat assistant" chrome, cyan-on-dark, purple gradients, glassmorphism

## Colors

The palette is inspired by **動森キャンプ** — warm cream and brown tones with teal interactive accents and gold CTAs, verified against WCAG AA contrast requirements.

Three-layer color system:
- **90% Ground** (cream/brown): Page bg white, card surfaces cream, warm brown text
- **8% Interactive** (teal #19c8b9): Buttons, links, active states, toggles
- **2% Emphasis** (gold #f0b429): Important actions, key CTAs

Key tokens:
- **Background** (`bg`): Pure white (#ffffff). Clean page surface.
- **Card** (`card`): Warm cream (#faf8f3). Component surfaces.
- **Foreground** (`fg`): Warm brown (#725d42). Primary text. Never pure black.
- **Muted** (`muted` / `muted-fg`): #f0e8d8 / #9f927d. Secondary text, disabled states.
- **Primary** (`primary`): Teal (#19c8b9). Interactive elements — buttons, links, active indicators.
- **CTA** (`cta`): Gold (#f0b429). High-importance actions only.
- **Focus** (`focus`): Yellow (#ffcc00). Game-style focus ring.
- **3D Shadow** (`3d-shadow`): Earthy (#bdaea0). Bottom shadow on buttons and inputs.
- **Brand**: Torii vermillion (oklch(58% 0.19 28)). Logo only — never in UI surfaces.

All neutrals are tinted warm (toward brown hue) for subconscious cohesion with the brand.

## Typography

Four font families for warmth and CJK support:

- **Display / Headings:** Noto Serif JP (weights 400, 600, 700) — editorial authority
- **Body Latin:** Nunito (weights 300-700) — rounded, friendly
- **Body CJK:** Zen Maru Gothic + Noto Sans SC — consistent CJK rendering
- **Mono:** IBM Plex Mono — technical data only

Type scale follows **Perfect Fourth (1.333 ratio)**: 12 / 14 / 16 / 18 / 24 / 28 / 42 / 72px. Body text uses weight 400; headings use bold (700).

## Layout & Spacing

**Adaptive hybrid layout** — the interface reshapes based on state:
- **Landing** (`/`): Hero with anime gallery, public
- **Guide** (`/anime/[id]`): Cover + map + grouped spots, public
- **Chat** (`/chat`): Three-column (sidebar + chat + results), protected
- **Mobile** (<768px): Single column with bottom sheet for results

Spacing follows a 4px base grid. Content areas max out at 1200px. Card grids use `gap-4` (16px) between items.

Touch targets are 44px minimum for all interactive elements (WCAG requirement for outdoor/mobile use).

## Elevation & Depth

The 動森キャンプ depth system uses **3D bottom shadows** for tactile feel, not traditional elevation:

- **3D shadow** (`0 5px 0 0 #bdaea0`): Primary buttons, inputs. Pressed state removes shadow + translateY(2-3px).
- **Card shadow** (`--shadow-card`): `0 4px 10px rgba(107, 92, 67, 0.32)`. Cards, containers.
- **Card hover** (`--shadow-card-hover`): `0 8px 24px rgba(114, 93, 66, 0.15)`. Elevated hover state.
- **Hero shadow** (`--shadow-hero`): `0 24px 80px rgba(61, 52, 40, 0.08)`. Hero welcome card.

No pure black shadows — all use warm brown tints for cohesion.

## Shapes

Border radius uses a 4-level scale — large and rounded throughout:
- `sm` (12px): Badges, small elements
- `md` (18px): Cards, panels
- `lg` (24px): Large containers, map
- `pill` (50px): All interactive elements — buttons, inputs, chips, toggles

Borders are 2px throughout (header, footer, cards, accordions, toggles) for tactile depth matching the 3D shadow system.

## Components

### Buttons
Button hierarchy is via **shadow depth, not color saturation**:
- **Primary**: Cream bg + brown text + 3D bottom shadow. The default.
- **CTA**: Gold bg + dark text + 3D shadow. For important actions only.
- **Outline**: 2px border + no shadow. Secondary actions.
- **Ghost**: No border, no shadow. Tertiary/nav actions.

All buttons are pill-shaped (50px radius). Hover lifts 1px (`translateY(-1px)`). Active presses down (`translateY(2px)`, shadow shrinks).

### Spot Cards
Anime screenshot with episode badge overlay. Badge uses backdrop-blur on photo. Card has `--shadow-card` base. In select mode, hover lifts with shadow transition. In browse mode, static (no hover lift — no click handler).

### Group Toggle
Pill-shaped segmented control with 3D bottom shadow. Active state uses teal background + inset shadow. Inactive state: muted text, hover reveals cream background.

### Route Timeline
Vertical timeline with dots, dashed walk segments, and stop cards.

### Map
Rounded container (24px radius) with 2px border and card shadow. Loading uses skeleton shimmer. Error shows fallback with location icon.

## Do's and Don'ts

### Do
- Use design tokens from `globals.css` — never hardcode colors
- Use semantic Tailwind classes (`bg-primary`, `text-foreground`) not arbitrary CSS variable values
- Use `cn()` for conditional className logic
- Use `flex gap-*` for spacing between siblings
- Use shadcn Skeleton for loading states
- Use property-specific transitions (`transition-[transform,box-shadow]`)
- Let photography and map textures carry visual weight
- Keep the UI quiet — panels appear when there is content, not before
- Use 2px borders consistently

### Don't
- Use `space-y-*` or `space-x-*` (use `gap-*`)
- Use `transition-all` (specify exact properties)
- Use template literal ternaries for className (use `cn()`)
- Hardcode oklch/hex values in component files (extract to CSS variable)
- Use `style={{}}` for values with Tailwind equivalents
- Use `animate-pulse` divs for loading (use Skeleton component)
- Add generic SaaS purple gradients or "AI assistant" chrome
- Use bounce or elastic easing — use `ease-out-quint` or `ease-out-expo`
- Add dark mode (light-only by design decision)
- Use gradient text or glassmorphism
- Use side-stripe borders (border-left > 1px as accent)

## Token Alignment Map (package = source of truth)

`animal-island-ui/dist/core.css` defines the `--animal-*` primitive layer. `app/globals.css :root` defines the `--color-*` semantic alias layer. The following equalities are locked and CI-guarded by `tests/design-token-alignment.test.ts`.

| App token (`--color-*`) | Package token (`--animal-*`) | Relationship | Value |
|---|---|---|---|
| `--color-primary` | `--animal-primary-color` | literal equality | `#19c8b9` |
| `--color-error-fg` | `--animal-error-color-active` | literal equality | `#c94444` |
| CTA button background | `--animal-warning-color` | direct reference | `#f5c31c` (package-owned) |

Note on CTA: `--color-cta` (`#f0b429`) is an app-defined alias used for non-button CTA tokens (e.g. text labels). The `.animal-btn-cta` class in `globals.css` consumes `var(--animal-warning-color)` directly, making the rendered button color package-owned. If the package changes `--animal-warning-color`, the CTA button color changes automatically; update `--color-cta` in globals.css to match if the semantic alias should track it.

When upgrading `animal-island-ui`, run `npm run test -- --run tests/design-token-alignment.test.ts` immediately. A test failure means a primitive token value changed and the semantic layer must be reconciled.
