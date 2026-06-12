---
version: beta
name: Seichijunrei
description: Anime pilgrimage spot search and route planning — animal-island-ui (動森) design language, transcribed from upstream v0.9.5
upstream:
  repo: https://github.com/guokaigdg/animal-island-ui
  docs: skill/SKILL.md · DESIGN_PROMPT.md · AI_USAGE.md · PROMPT.md
  synced: v0.9.5 (2026-06-02) — on conflict, upstream source wins
colors:
  bg: "#f8f8f0"
  card: "#f7f3df"
  bg-secondary: "#f0e8d8"
  fg: "#725d42"
  fg-heading: "#794f27"
  muted-fg: "#9f927d"
  text-muted: "#8a7b66"
  border: "#c4b89e"
  border-standard: "#aaa69d"
  primary: "#19c8b9"
  primary-fg: "#ffffff"
  success: "#6fba2c"
  warning: "#f5c31c"
  error: "#e05a5a"
  focus: "#ffcc00"
  3d-shadow: "#bdaea0"
  input-shadow: "#d4c9b4"
  explore: "oklch(67% 0.17 47)"
  brand: "oklch(58% 0.19 28)"
typography:
  display:
    fontFamily: Nunito
    fontSize: clamp(44px, 4.3vw, 62px)
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: -0.005em
  heading:
    fontFamily: Nunito
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: Nunito
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: 0.01em
  numeral:
    fontFamily: Nunito
    fontWeight: 900
  placeholder:
    fontWeight: 400
rounded:
  sm: 12px
  md: 18px
  lg: 24px
  pill: 50px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
---

## Overview

Seichijunrei is an anime pilgrimage (聖地巡礼) spot search and route planning service. Users discover meaningful scenes from anime, see them on a map, and turn selected spots into a realistic walking route.

The visual language is **animal-island-ui** (Animal Crossing-inspired, MIT): *温暖大地色系 + 大圆角 pill 形 + 游戏按键立体感 + 柔和动效 + 有机不规则形状* — natural & pastoral, cozy, tactile. The UI stays quiet; photography and the map carry the color richness.

**Brand personality:** warm · handmade · wonder
**Anti-references:** generic SaaS dashboards, "AI chat assistant" chrome, cold blue/gray, gradient text, glassmorphism, deep-cream "AI beige" grounds

## The Seven Iron Rules (upstream §6, binding)

1. **Color** — earthy brown text + mint-teal primary + cream-white grounds. Never pure black, never cold gray.
2. **Radius** — minimum 12px anywhere; buttons and inputs are always 50px pill.
3. **Depth** — thick 3D bottom shadows (`0 Npx 0 0 <dark>` + hover-rise / active-press) are reserved for **primary buttons, danger-primary buttons, inputs, and switches only**. Everything else (cards, panels, default/text/link buttons) uses soft warm elevation (`0 2px 4px` / `0 3px 10px rgba(61,52,40,…)`).
4. **Type** — Nunito rounded family; buttons/headings weight 600+; never use thin weights (<400).
5. **Motion** — transitions 0.15–0.35s, easing `cubic-bezier(0.4, 0, 0.2, 1)`; smooth, never abrupt.
6. **Focus** — inputs focus **yellow `#ffcc00`**, buttons focus **teal `#19c8b9`**; never blue.
7. **Forbidden** — right-angle interactive elements, pure-black `#000` text, cold blue tones, flat shadow-less design.

## Color System

### Three-layer ground (the depth story)

```
Ground   #f8f8f0          page background  (--animal-bg-color)
Surface  rgb(247,243,223) cards, modals, inputs, header pill (--animal-bg-color-content)
Content  photography / map / illustration  (the only saturated layer)
```

Ground is the **lightest** layer; surfaces sit one step warmer/deeper; photos pop on top. Never pure white (`#ffffff`) and never deep cream (`#f7f1e6` was an unsanctioned drift — it flattens the three layers into beige and muddies photography).

### Core tokens (upstream literals)

| Role | Token | Value |
|---|---|---|
| Primary (mint teal) | `--color-primary` | `#19c8b9` (hover `#3dd4c6`, active `#50b9ab`, tint `#e6f9f6`) |
| Text heading | `--color-fg-heading` | `#794f27` |
| Text body | `--color-fg` | `#725d42` |
| Text secondary | `--color-muted-fg` | `#9f927d` *(large/decorative only — see A11y)* |
| Text muted | — | `#8a7b66` |
| Border (input) | `--color-border` | `#c4b89e` (hover `#a89878`) |
| Border (standard) | — | `#aaa69d` 2px |
| Success / Warning / Error | semantic | `#6fba2c` / `#f5c31c` / `#e05a5a` |
| Game focus yellow | `--color-focus` | `#ffcc00` (dark `#e0b800`) |
| Button 3D shadow | `--color-3d-shadow` | `#bdaea0` |
| Input 3D shadow | `--color-input-shadow` | `#d4c9b4` |

### NookPhone accent palette (playful tier)

Thirteen pastel app-tile colors. Use sparingly for chips, tags, markers, and card variants — this tier carries the "cute" without ever becoming the ground:

`default rgb(247,243,223)` · `app-pink #f8a6b2` · `purple #b77dee` · `app-blue #889df0` · `app-yellow #f7cd67` · `app-orange #e59266` · `app-teal #82d5bb` · `app-green #8ac68a` · `app-red #fc736d` · `lime-green #d1da49` · `yellow-green #ecdf52` · `brown #9a835a` · `warm-peach-pink #e18c6f`

Homepage usage: example chips wear `app-teal` / `app-yellow` / `app-pink` with a 3D press shadow in the tile's own darker shade.

### App-extension tokens (ours, not upstream)

- **Explore orange** `oklch(67% 0.17 47)` ≈ `#e8742e` — the single dominant marketing action per surface ("Start Exploring"). Mockup-locked; ties to fox + torii warmth. Upstream has no orange; this is a deliberate brand addition.
- **Brand vermillion** `oklch(58% 0.19 28)` — torii logo + eyebrow only. Never a UI surface color.
- **Walk green** `#e6f5e0 / #4a7a3a`, **leaf** `#7fae6b` — route/walk-segment accents.

## Typography

One family, weights do the talking (upstream has **no display serif** — headings are the same rounded family, heavier):

```
Stack: Nunito, 'Noto Sans SC', 'Zen Maru Gothic', 'HarmonyOS Sans SC', 'MiSans',
       -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif
```

- Latin **Nunito** · Simplified Chinese **Noto Sans SC** · Japanese **Zen Maru Gothic** (丸ゴシック)
- Weights: body **500** · buttons/headings **600–700** · hero display **800** (app extension) · numerals/clock **900** · placeholder **400**
- Letter-spacing: body `0.01em` · buttons/headings `0.02em` · hero display `-0.005em`
- Never weight <400; never mono for UI text (code blocks excepted)
- *Retired:* Noto Serif JP display headings (pre-v0.9.5 app choice). The serif fought the rounded, tactile language; hero headline is now Nunito 800.

## Shape

- Radius scale: `12 / 18 / 24 / 50px`; pills for every interactive element; **minimum 12px anywhere**
- Organic shapes are part of the language: title cards may use organic radius `40px 35px 45px 38px / 38px 45px 35px 40px`; modals clip with the upstream SVG blob path
- Borders 2px default, inputs 2.5px (large 3px)

## Depth & Interaction (the defining feature)

**Nintendo button press** — only on press-ables (iron rule 3):

```css
/* primary button */  box-shadow: 0 5px 0 0 #bdaea0;            /* default  */
                      box-shadow: 0 6px 0 0 #bdaea0; translateY(-1px);  /* hover  */
                      box-shadow: 0 1px 0 0 #bdaea0; translateY(2px);   /* active */
/* input */           box-shadow: 0 3px 0 0 #d4c9b4;  /* sm 2px · lg 4px */
/* input focus */     border-color:#ffcc00; box-shadow: 0 3px 0 0 #e0b800, 0 0 0 3px rgba(255,204,0,.15);
/* switch handle */   box-shadow: 0 3px 0 0 #bdaea0;  /* ON: #5a9e1e */
```

**Cards and containers float, they don't press:**

```css
box-shadow: 0 4px 10px rgba(107,92,67,0.42);     /* card base   */
box-shadow: 0 8px 24px rgba(114,93,66,0.15);     /* card hover  */
transform: translateY(-4px);                      /* hover float */
```

All shadows are warm-tinted (`rgba(61,52,40,…)` family) — never pure-black rgba.

## Motion

- Durations `0.15 / 0.25 / 0.35s`; easing `cubic-bezier(0.4, 0, 0.2, 1)` (entrances may use `ease-out-expo`)
- Hover rises: buttons/inputs `-1px`, switch handle `-2px`, cards `-4px`; button active presses `+2px`
- Upstream keyframes: `animal-zoom-in`, `animal-fade-in`, `ac-fade-up`; app entrances: `.entrance-up` family
- No bounce/elastic. `prefers-reduced-motion: reduce` zeroes animations and forces `.entrance-*` opacity to 1 (already in globals.css — keep it)

## Accessibility (app policy — stricter than upstream where they conflict)

- WCAG AA contrast on every text/ground pair. On cream surfaces: body text uses `#725d42`+; `#9f927d` secondary only at ≥18.66px bold or as decorative labels; **placeholders must hit 4.5:1** (upstream's `#c4b89e` placeholder fails AA — we deviate deliberately and use a darker value)
- Touch targets ≥44px (upstream middle button = 45px ✓; chips must pad up to ≥44px)
- Focus always visible: yellow (inputs) / teal (buttons) per iron rule 6 — never suppressed, never blue
- Headings in order; decorative SVG `aria-hidden`; photos carry meaningful localized `alt`

## Homepage composition (app-specific)

Elements (segmentation map: `agent-review/segmentation-target.png`): pill header (kept) · brand-red eyebrow · Nunito-800 three-line headline · lead · chunky search pill + explore CTA · pastel example chips · hand-drawn route trail · polaroid showcase card (anime|real halves, cream tags, slider handle) · fox mascot riding the tilted top-right corner · footer bar.

- **Route trail:** dashed warm-brown line threading the search→chips gap, diving under the card; pins = teal departure · espresso waypoints · gold destination (with ground-shadow ellipse). SVG fills must use Tailwind `fill-*` classes — `var()` does not resolve in SVG presentation attributes.
- **Showcase card:** thick cream polaroid frame owning its aspect; photos `object-cover` per half; *soft elevation shadow, not 3D press* (iron rule 3).
- **Fox (FoxGuide):** hand-vectorized asset, `pose="lean"`; belly on the frame edge, paws into the photo — never floating detached.

## Do / Don't

### Do
- Tokens via semantic Tailwind classes (`bg-background`, `bg-card`, `text-fg`, `fill-cta`); extend `@theme` when a token lacks a utility
- `cn()` for conditional classes; `flex gap-*`; property-specific transitions
- Let photography glow on the light ground; keep UI quiet
- One dominant action per surface (explore orange); everything else cream/teal

### Don't
- Pure white or deep-cream page grounds; pure black text; cold blue/gray anything
- 3D press shadows on cards/panels (float them instead)
- Display serif headings; thin weights; mono UI text
- `space-y-*` / `space-x-*`; `transition-all`; `style={{}}` for tokenable values; hardcoded hex in components (2+ uses → token)
- Gradient text, glassmorphism, side-stripe accents, bounce easing, dark mode

## Token Alignment Map (package = source of truth)

`animal-island-ui/dist/core.css` owns the `--animal-*` primitives; `app/globals.css :root` aliases them as `--color-*`. CI-locked by `tests/design-token-alignment.test.ts`:

| App token | Package token | Value |
|---|---|---|
| `--color-primary` | `--animal-primary-color` | `#19c8b9` |
| `--color-error-fg` | `--animal-error-color-active` | `#c94444` |
| CTA button bg | `--animal-warning-color` | `#f5c31c` (package-owned) |

**To add when the v0.9.5 ground migration lands:** `--color-bg ↔ --animal-bg-color (#f8f8f0)` and `--color-card ↔ --animal-bg-color-content (rgb(247,243,223))` — lock the layering so it can't drift again.

When upgrading the package, run the alignment test first; a failure means a primitive moved and the semantic layer needs reconciling.
