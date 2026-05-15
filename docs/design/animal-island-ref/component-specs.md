# Per-Component Pixel Specifications

Reference distilled from [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) (MIT). Exact values from source. Each section maps to our components.

---

## Button

### Size Table
| Property | Small | Middle | Large |
|----------|-------|--------|-------|
| Height | 32px | **45px** | 48px |
| Padding | `0 16px` | `0 20px` | `0 32px` |
| Font size | 12px | 14px | 16px |
| Border radius | 12px | **50px** (pill) | 24px |
| Border width | 2px | 2px | 2px |

### Types (5)
- **primary:** cream bg (#f8f8f0), brown text (#794f27), 3D shadow
- **default:** outlined, 2px border #9f927d, no shadow
- **dashed:** dashed border variant of default
- **text:** transparent bg, no border, no shadow, only text color
- **link:** teal (#19c8b9) text, no bg/border/shadow, underline on hover

### Special States
- **danger:** red bg/shadow variant for each type
- **ghost:** transparent bg (for dark backgrounds)
- **block:** `width: 100%`
- **loading:** diagonal stripe animation (see interaction-and-motion.md)

**Our Button:** Has 8 variants (primary, default, cta, outline, ghost, link, chip, danger). Need to add 3D shadow to primary/cta/danger. Our `cta` (gold) maps to their `primary` + gold BG.

---

## Input

### Size Table
| Property | Small | Middle | Large |
|----------|-------|--------|-------|
| Height | 32px | 40px | 48px |
| Padding | `0 14px` | `0 18px` | `0 22px` |
| Font size | 12px | 14px | 16px |
| Border radius | 40px | 50px | 50px |
| Border width | 2.5px | 2.5px | **3px** |
| Box shadow | `0 2px` | `0 3px` | `0 4px` |

### Features
- **prefix/suffix:** Color #a0936e, margin 6px
- **allowClear:** 20x20px circle button, hover bg rgba(114,93,66,0.1)
- **status="error":** 3D shadow turns #c94444
- **status="warning":** 3D shadow turns #dba90e

**Our Input:** Single size, pill shape, has prefix/suffix. Need to add: size variants, border-width scale, per-size shadow depths, clear button.

---

## Switch

### Default Size
| Property | Value |
|----------|-------|
| Track | 52x28px, border 2.5px, radius 50px |
| Handle | 21x21px, positioned 2px from edge, radius 50% |
| Handle float | `translateY(-2px)` always |

### Small Size
| Property | Value |
|----------|-------|
| Track | 38x20px, border 2px |
| Handle | 14x14px, positioned 1px from edge |

### ON/OFF Visual
| State | Track BG | Handle shadow |
|-------|----------|---------------|
| OFF | `#d4c9b4` | `0 3px 0 0 #bdaea0` |
| ON | `#86d67a` | `0 3px 0 0 #5a9e1e` |

### Inner Text (optional labels)
- Font: 11px weight 700 white
- OFF padding: `0 8px 0 28px`
- ON padding: `0 28px 0 8px`

**Our Switch:** Already close (105 lines). Verify handle float (`translateY(-2px)`) and exact shadow values match.

---

## Checkbox

### Size Table
| Property | Small | Middle | Large |
|----------|-------|--------|-------|
| Box size | 18px | 22px | 28px |
| Border width | 2px | 2.5px | 3px |
| Border radius | 8px | 8px | 8px |
| Label font | 12px | 14px | 16px |
| Checkmark | 10px | 12px | 16px |

### Group Layout
- Horizontal: `flex gap-12px`
- Vertical: `flex-direction: column gap-8px`

### Pop Animation on Check
```css
@keyframes animal-checkbox-pop {
  0%   { transform: scale(0.4); opacity: 0; }
  60%  { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}
```

**Our Checkbox:** 157 lines with size variants. Verify pop animation exists and matches.

---

## Select

### Trigger
- Height: auto (flexible), padding `8px 13px`
- BG: `#fff`, border 2px `#e8dcc8`, radius 12px
- Font: 14px weight 600

### Dropdown
- BG: `#FFEEA0` (soft yellow) -- distinctive!
- Border radius: 28px
- Padding: 12px 0
- Fade-in animation: 0.2s ease

### Options
- Padding: `10px 30px 10px 14px`
- Hovered: font-weight 700, shows cursor SVG

### Pill Bar Indicator (behind active option)
- Height: 14px, bg `#FFCC00` opacity 0.3, radius 7px

**Our Select:** 132 lines. Significant visual difference -- our dropdown is standard cream, theirs is yellow. Consider adopting the yellow dropdown for more 動森 feel.

---

## Tabs

### Container
- BG: `#f8f8f0`, border 2px `#c4b89e`, radius 24px

### Tab Item
- Padding: `8px 16px`, radius 24px
- Default: color `#8a7b66`
- Active: bg `#0CC0B5` (teal), color `#FFF9E3`, weight 600
- Active shadow: `0 3px 0 0 rgba(61,52,40,0.08)`

### Leaf Decoration (optional)
- Leaf wiggle animation: 2s ease-in-out infinite

### Content
- Padding: 24px
- Entry: fade-in + translateY(4px -> 0), 0.25s

**Our Tabs:** 93 lines. Need to verify active state uses teal bg + warm white text, add content fade animation.

---

## Card

### Default Type
- Radius: 20px
- BG: `rgb(247, 243, 223)`
- Padding: `16px 24px`
- Shadow: `0 4px 10px rgba(107, 92, 67, 0.42)`
- Hover: `translateY(-4px)`

### Title Type (organic shape)
- Radius: `40px 35px 45px 38px / 38px 45px 35px 40px`
- BG: `#fdfdf5` (slightly whiter)
- Padding: `12px 32px`
- Weight: 600

**Our Card:** 148 lines with subcomponents. Shadow value differs -- ours is `--shadow-card: 0 4px 10px rgba(107,92,67,0.12)` (lighter). Consider darkening to 0.42 opacity for more presence, or keep lighter for our white-page-background context.

---

## Collapse (Accordion)

### Container
- Radius: 18px, border 2px `#9f927d`, margin-bottom 12px

### Header
- Padding: `16px 24px`, gap 12px

### Toggle Icon
- 28x28px circle, bg `#19c8b9`, white `+/-` text
- Shadow: `0 2px 4px rgba(25,200,185,0.3)`
- Rotates 180deg when expanded

### Leaf Decoration
- Color `#19c8b9`, opacity 0.5 -> 1 on expand
- Rotates 45deg on expand

### Expand (CSS Grid)
```css
display: grid;
grid-template-rows: 0fr; /* collapsed */
grid-template-rows: 1fr; /* expanded */
transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

**Our Accordion:** Exists as `ui/Accordion.stories.tsx`. Verify CSS Grid expand technique is used, add teal icon circle + leaf decoration for 動森 feel.

---

## Modal

### Container
- Clip-path: SVG blob shape (organic, irregular outline)
- BG: `rgb(247, 243, 223)`
- Padding: `48px 48px 32px`
- Max-width: `calc(100vw - 32px)`
- Entry: scale(0.92) -> 1, 0.3s

### SVG Blob Path (exact)
```svg
<clipPath id="animal-modal-clip" clipPathUnits="objectBoundingBox">
  <path d="M0.501,0.005 L0.523,0.005 L0.549,0.006
    C0.704,0.01,0.796,0.017,0.825,0.027 L0.827,0.028
    C0.872,0.045,0.939,0.044,0.978,0.17
    C1,0.254,1,0.365,0.99,0.505 L0.988,0.513
    C0.979,0.558,0.971,0.598,0.965,0.633
    C0.956,0.689,0.979,0.77,0.964,0.865
    C0.953,0.928,0.921,0.966,0.869,0.979
    C0.821,0.986,0.773,0.992,0.726,0.995
    L0.712,0.996 L0.694,0.997
    C0.648,1,0.586,1,0.507,1 L0.501,1 L0.464,1
    C0.385,1,0.325,0.998,0.283,0.995
    C0.234,0.992,0.184,0.987,0.133,0.979
    C0.081,0.966,0.05,0.928,0.039,0.865
    C0.023,0.77,0.047,0.689,0.037,0.633
    C0.031,0.595,0.023,0.552,0.013,0.505
    C-0.006,0.365,-0.002,0.254,0.024,0.17
    C0.064,0.045,0.13,0.045,0.174,0.028 L0.175,0.028
    C0.204,0.017,0.303,0.009,0.474,0.005 L0.501,0.005"/>
</clipPath>
```

### Footer
- Standard button: 40px height, border `rgba(114,93,66,0.3)`, radius 39.81px
- Confirm button: **BG #ffcc00** (game yellow), color #725d42, font 18px

**Our Modal:** Uses Sheet component (138 lines). Blob clip-path is the most distinctive 動森 feature. Consider adding for confirmation dialogs.

---

## Decorative Components

### Time (HUD Clock)
- Container: gradient bg, border 3px `#d4cfc3`, radius 18px
- Weekday: green `#6fba2c`, weight 900, 14px, uppercase
- Time digits: brown `#8b7355`, weight 900, 48px
- Colon blink: `animation: blink 1s step-end infinite`

### Phone (NookPhone)
- Shell: 527x788px, radius 136px (capsule)
- App grid: 3 columns, gap 32px, tiles 123x123px, radius 45px
- 9 app colors (see color-and-depth.md NookPhone palette)
- Hover: bounce animation (scale 1 -> 1.2 -> 1.1, slight rotation)

### Footer
- Sea: SVG wave illustration, height 80px, `contain`
- Tree: webp forest silhouette, height 60px, `cover bottom`

### Divider (5 types)
- All: width 100%, height 12px, background-image
- Types: line-brown, line-teal, line-white, line-yellow, wave-yellow

### Cursor
- Custom game-style finger pointer PNG
- `cursor: url(cursor-icon.png) 4 0, auto !important`

### CodeBlock (dark theme)
- BG: `#2b2118`, border 1px `#3d3028`, radius 20px
- Font: SF Mono/Fira Code, weight 600, 14px
- 9 syntax token colors (warm-tinted, not cold)

**Relevance to our project:** Decorative components are low priority. Time/Phone/Footer/Divider/Cursor are game-world elements. We may adopt the CodeBlock dark theme if showing code snippets, and the wave Divider for section breaks.

---

## Component Mapping: Animal Island -> Seichijunrei

| Animal Island | Our Component | Adaptation Priority |
|---------------|---------------|-------------------|
| Button | `ui/button.tsx` | HIGH — add 3D press, size scale |
| Input | `ui/input.tsx` | HIGH — add size variants, 2.5px border |
| Switch | `ui/switch.tsx` | MEDIUM — verify handle float + shadows |
| Checkbox | `ui/checkbox.tsx` | MEDIUM — verify pop animation |
| Select | `ui/select.tsx` | MEDIUM — consider yellow dropdown |
| Tabs | `ui/tabs.tsx` | MEDIUM — add teal active + content fade |
| Card | `ui/card.tsx` | MEDIUM — verify shadow + hover float |
| Collapse | `ui/Accordion` | LOW — add teal icon + leaf decoration |
| Modal | `ui/sheet.tsx` | LOW — consider blob clip-path |
| Typewriter | `ui/typewriter.tsx` | DONE — already aligned |
| (none) | `chat/ChatInputV2` | HIGH — needs 3D shadow + overflow story |
| (none) | `chat/WelcomeScreen` | HIGH — needs unique identity |
| (none) | `chat/MessageBubble` | MEDIUM — verify bubble radius pattern |
| (none) | `chat/FeedbackButtons` | HIGH — currently renders blank |
| (none) | `chat/ResultAnchor` | HIGH — too tight, needs redesign |
| (none) | `chat/ToolPartRenderer` | HIGH — style inconsistency |
| (none) | `generative/Clarification` | MEDIUM — spacing fix |
| (none) | `generative/NearbyBubble` | MEDIUM — spacing fix |
| (none) | `generative/RouteConfirm` | MEDIUM — spacing fix |
| (none) | `generative/RouteTimeline` | LOW — already good |
| (none) | `generative/PhotoCard` | LOW — already good |
