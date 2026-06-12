> **⚠️ STALE (2026-06-12):** distilled from pre-v0.9.5 upstream. Superseded by `frontend/DESIGN.md` (transcribed from upstream v0.9.5) and the live upstream docs at https://github.com/guokaigdg/animal-island-ui (`skill/SKILL.md` · `DESIGN_PROMPT.md` · `PROMPT.md`). Local mirror: `~/Documents/animal-island-ui-upstream-original`. On conflict, upstream source wins.

# Typography, Spacing, Radius & Borders

Reference distilled from [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) (MIT).

## Typography

### Font Stack
```css
font-family: Nunito, 'Noto Sans SC', 'Zen Maru Gothic',
  -apple-system, 'PingFang SC', 'Hiragino Sans GB', sans-serif;
```

**Ours:** Same fonts, loaded via `next/font/google`. Our stack adds `"Hiragino Sans"` and `system-ui`. Aligned.

### Weight Ladder
| Weight | Usage |
|--------|-------|
| 400 | Placeholder text, subtle descriptions |
| 500 | Body text, card content, input text |
| 600 | Button text, menu items, headings |
| 700 | Strong headings, Collapse question text, modal title |
| 800 | Time component month/day digits |
| 900 | Time component clock digits, weekday label |

**Ours:** We use 300-700. Missing: 800/900 weights (only needed if we add a Time/Clock HUD component). Otherwise aligned.

### Letter Spacing
| Context | Value |
|---------|-------|
| Body text | `0.01em` |
| Buttons, headings | `0.02em` |
| Weekday labels (uppercase) | `1.5px` |

**Ours:** Not explicitly set. Consider adding `letter-spacing: 0.02em` to button classes.

### Size Scale
| Level | Size | Usage |
|-------|------|-------|
| sm | 12px | Small buttons, badges, meta text |
| base | 14px | Body text, default buttons, input text |
| lg | 16px | Large buttons, Collapse question text |
| heading | 28px | Modal title, page headings |

**Ours:** Our type scale uses 12/14/16/20/28px (4 levels). Aligned at base sizes. We additionally have display font (Noto Serif JP) for headings which animal-island doesn't use.

### Rules
- Minimum text size: 12px. Never smaller.
- Never use font-weight below 400.
- Never use system monospace fonts for UI text (code blocks excluded).

---

## Spacing

### Scale
| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Inline gaps, icon margins |
| sm | 8px | Chip gaps, compact grid |
| md | 12px | Card grid gap, filter padding, Collapse margin |
| lg | 16px | Section padding, content margins, card padding-y |
| xl | 24px | Major section gaps, card padding-x, Collapse answer padding |

**Ours:** Documented in DESIGN.md with same values: 2xs=4, xs=8, sm=12, md=16, lg=24, xl=32, 2xl=48. Our scale extends further (32, 48) which animal-island doesn't need. Aligned at core values.

### Component-Specific Spacing
| Component | Inner Padding | Gap |
|-----------|--------------|-----|
| Button sm | `0 16px` | - |
| Button md | `0 20px` | - |
| Button lg | `0 32px` | - |
| Input sm | `0 14px` | - |
| Input md | `0 18px` | - |
| Input lg | `0 22px` | - |
| Card default | `16px 24px` | - |
| Card title | `12px 32px` | - |
| Collapse header | `16px 24px` | `12px` |
| Collapse body | `0 24px` (+ bottom 24px open) | - |
| Tabs list | `16px` | `4px` |
| Tab item | `8px 16px` | - |
| Checkbox group | horizontal `gap 12px` / vertical `gap 8px` | - |
| Modal body | `48px 48px 32px` | - |

---

## Border Radius

### Scale
| Token | Value | Usage |
|-------|-------|-------|
| sm | 12px | Small buttons, sidebar items, badges, checkbox box (8px) |
| base | 18px | Collapse card, Time component |
| lg | 24px | Cards (20px), Tabs container, large buttons, modals |
| pill | 50px | **All interactive elements** — buttons (middle), inputs, chips, Switch |

**Ours:** `--r-sm: 12px` / `--r-md: 18px` / `--r-lg: 24px` / `--r-pill: 50px` -- Exact match.

### Special Shapes
```css
/* Title Card — organic irregular corners */
border-radius: 40px 35px 45px 38px / 38px 45px 35px 40px;

/* Modal — SVG blob clip-path (no traditional border-radius) */
clip-path: url(#animal-modal-clip);
```

### Rules
- Minimum radius anywhere: 12px
- No sharp right-angle (0px radius) on any interactive element
- All buttons and inputs MUST use pill (50px)

---

## Borders

### Width Scale
| Context | Width |
|---------|-------|
| Standard (Card, Collapse, buttons) | `2px solid` |
| Input (default) | `2.5px solid` |
| Input (large) | `3px solid` |
| Time component | `3px solid` |

**Ours:** We use `1px solid` for most borders. Consider increasing to `2px` for components that need the animal-island tactile feel. The thicker borders are part of the "game UI" aesthetic.

### Border Colors by State
| State | Color |
|-------|-------|
| Default (Collapse) | `#9f927d` (darker) |
| Default (Input) | `#c4b89e` (lighter) |
| Hover (Input) | `#a89878` |
| Focus (Input) | `#ffcc00` (yellow) |
| Disabled | `#d4c9b4` |
| Error | `#c94444` (shown via shadow, not border) |

---

## Component Size Scale

### Heights
| Size | Height | Usage |
|------|--------|-------|
| sm | 32px | Small buttons, small inputs |
| base/middle | 40-45px | Default inputs (40px), default buttons (45px) |
| lg | 48px | Large buttons, large inputs |

**Ours:** Not explicitly tokenized. Our buttons use CVA with fixed heights. Consider adding `--height-sm/base/lg` tokens for consistency.

### Touch Targets
- Minimum: 44px (WCAG requirement)
- Button middle (45px) naturally exceeds this
- Small elements (32px) need additional padding or hit area

---

## Adaptation Gaps Summary

| Gap | Priority | Action |
|-----|----------|--------|
| Border width 2px vs 1px | High | Increase borders on Collapse, inputs for tactile feel |
| Letter spacing on buttons | Medium | Add `tracking-wide` (0.02em) to button classes |
| Height tokens | Medium | Add `--height-sm/base/lg` to globals.css |
| NookPhone full 13-color palette | Low | Add when implementing colored Card variants |
| Font weight 800-900 | Low | Only needed for Time/Clock HUD |
