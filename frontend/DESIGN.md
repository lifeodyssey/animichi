---
version: alpha
name: Seichijunrei
description: Anime pilgrimage spot search and route planning service — リズと青い鳥 light blue palette, WCAG AA verified
colors:
  bg: "#f6f9fb"
  fg: "#0e171e"
  card: "#ffffff"
  muted: "#d8dfe4"
  muted-fg: "#4c575f"
  border: "#afb9c0"
  primary: "#67addd"
  primary-fg: "#0e2433"
  secondary: "#eaeff3"
  brand-soft: "#e3f1fb"
  marker-active: "#d33c33"
  success: "#cadeca"
  success-fg: "#003306"
  error: "#f8d4d3"
  error-fg: "#4c0f15"
  warning: "#f6d9b2"
  warning-fg: "#411f00"
  walk-bg: "#dde8dd"
  walk-fg: "#254326"
  gradient-soft: "#c9e3ec"
  gradient-hero: "#daebf1"
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
    fontFamily: Noto Sans JP
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: Noto Sans JP
    fontSize: 16px
    fontWeight: 300
    lineHeight: 1.6
  body-sm:
    fontFamily: Noto Sans JP
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: Noto Sans JP
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.02em
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  full: 9999px
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-fg}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: 44px
    padding: 0 20px
  button-primary-hover:
    backgroundColor: "{colors.primary}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    height: 44px
    padding: 0 20px
  card-spot:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.lg}"
  badge-episode:
    backgroundColor: "{colors.overlay-soft}"
    textColor: "#ffffff"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
  header:
    backgroundColor: "{colors.bg}"
    height: 56px
  group-toggle:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
---

## Overview

Seichijunrei is an anime pilgrimage (聖地巡礼) spot search and route planning service. Users discover meaningful scenes from anime, see them on a map, and turn selected spots into a realistic walking route.

The interface feels like a **pilgrimage planning studio** — cinematic, editorial, and dependable. It reduces blank-page anxiety and replaces it with momentum: users feel oriented, inspired, and ready to go out.

**Brand personality:** cinematic, editorial, dependable
**Anti-references:** generic SaaS dashboards, "AI chat assistant" aesthetics, heavy card stacks, purple gradients

## Colors

The palette is inspired by **リズと青い鳥** (Liz and the Blue Bird) — a light blue, airy aesthetic verified against WCAG AA contrast requirements.

- **Primary** (`primary`): Light blue used for CTAs and interactive elements. Text on primary buttons uses dark foreground (`primary-fg`) for WCAG AA compliance — not white text.
- **Background** (`bg`): Near-white with a subtle blue tint. Never pure white.
- **Foreground** (`fg`): Near-black with blue undertone. Never pure black.
- **Muted** (`muted` / `muted-fg`): For secondary text, placeholders, and subtle backgrounds.
- **Marker Active** (`marker-active`): Coral/orange for selected route markers on the map — distinct from the blue palette for clear visual separation.
- **Walk Segment** (`walk-bg` / `walk-fg`): Soft green for walking segments in route timelines.
- **Status colors** follow the same hue-tinting approach: green for success, red for error, amber for warning.

All neutrals are tinted toward hue 240 (blue) for subconscious cohesion with the brand.

## Typography

Two font families from the Noto family:

- **Display / Headings:** Noto Serif JP (weights 400, 600, 700) — editorial presence for anime titles and section headings
- **Body / UI:** Noto Sans JP (weights 300, 400, 500, 600, 700) — clean readability for all interface text
- **Chinese fallback:** Noto Sans SC for zh locale
- **Latin fallback:** Geist for system UI elements

Type scale follows **Perfect Fourth (1.333 ratio)**: 12 / 14 / 16 / 18 / 24 / 28 / 42 / 72px. Body text uses light weight (300) for the airy feel; headings use bold (700) for contrast.

Sizing uses Tailwind rem tokens (`text-xs` through `text-4xl`), never hardcoded pixel values.

## Layout & Spacing

**Adaptive hybrid layout** — the interface reshapes based on state, not fixed columns:
- **Chat-focused** (no results): chat centered at ~640px reading width
- **Split** (results arrive): chat narrows, result panel slides in as primary focus
- **Mobile** (<768px): single column with bottom sheet for results

Spacing follows a 4px base grid via Tailwind's default scale. Content areas max out at 1200px (`max-w-[1200px]`). Card grids use `gap-4` (16px) between items.

Touch targets are 44px minimum for all interactive elements (WCAG requirement for outdoor/mobile use).

## Elevation & Depth

Shadows are **hue-tinted toward blue (240)** for cohesion, using five levels:

- `shadow-xs`: Subtle header shadow (1px blur)
- `shadow-sm`: Card hover, toolbar active state (3px blur)
- `shadow-md`: Floating panels, chat popup (24px blur)
- `shadow-lg`: Modals, elevated cards (32px blur)
- `shadow-hero`: Hero welcome card (80px blur)

No pure black shadows — all use `oklch(20% 0.02 240 / alpha)`.

Overlays use three levels: `overlay` (0.7 alpha for modals), `overlay-soft` (0.55 for badges/scrims), `overlay-image` (0.75 for text-over-image gradients).

## Shapes

Border radius uses a 3-level scale:
- `sm` (4px): Badges, small tags, inline elements
- `md` (8px): Buttons, inputs, cards
- `lg` (12px): Large cards, panels, containers
- `full` (9999px): Pills, avatar circles

## Components

### Buttons
Primary buttons use light blue background with **dark text** (`primary-fg` on `primary`). This is intentional — white text on light blue fails WCAG AA. Outline buttons invert this: `primary` border/text on transparent background.

### Spot Cards
Anime screenshot with episode badge overlay. Badge uses `overlay-soft` background with white text and `backdrop-filter: blur(4px)`. Card name truncates with ellipsis.

### Group Toggle
Segmented control for switching between episode/area grouping. Uses `primary` background + `primary-fg` text for active state, `muted-foreground` for inactive.

### Route Timeline
Vertical timeline with dots, dashed walk segments (green), and stop cards. Active stop pulses with `dot-pulse` animation. Walk segments use `walk-bg`/`walk-fg` tokens.

### Filmstrip
Horizontal scroll strip of anime scene screenshots with gradient overlay for name labels. Edge-fade mask prevents hard scroll cutoff.

## Do's and Don'ts

### Do
- Use design tokens from `globals.css` — never hardcode colors
- Use Tailwind utility classes (`bg-primary`, `text-foreground`) not arbitrary values
- Use `cn()` for conditional className logic
- Use `flex gap-*` for spacing between siblings
- Use shadcn Skeleton for loading states
- Let photography and map textures carry visual weight
- Keep the UI quiet — panels appear when there is content, not before

### Don't
- Use `space-y-*` or `space-x-*` (shadcn rule: use `gap-*`)
- Use template literal ternaries for className (use `cn()`)
- Hardcode oklch/hex values in component files
- Use `animate-pulse` divs for loading (use Skeleton component)
- Add generic SaaS purple gradients or "AI assistant" chrome
- Put white text on the light blue primary color (fails WCAG)
- Use bounce or elastic easing — use `ease-out-quint` or `ease-out-expo`
- Add dark mode (light-only by design decision)
