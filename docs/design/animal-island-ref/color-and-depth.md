> **⚠️ STALE (2026-06-12):** distilled from pre-v0.9.5 upstream. **Superseded** by the design authority in `apps/web/AGENTS.md` and the live token sheet in `apps/web/src/styles/globals.css`. Upstream source of truth: https://github.com/guokaigdg/animal-island-ui (`skill/SKILL.md` · `DESIGN_PROMPT.md` · `PROMPT.md`). Local mirror: `~/Documents/animal-island-ui-upstream-original`. On conflict, the live token sheet wins, and upstream source wins over this distillation.

# Color System + 3D Depth

Reference distilled from [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) (MIT). Values are exact pixel/hex from source. Every `**Ours:**` line is verified against the live sheet by `apps/web/tests/unit/design-reference-tokens.test.ts`: every token named must exist in `apps/web/src/styles/globals.css :root`, every `token: #value` pair must match, and every AA cell is recomputed. Fix the doc or the token sheet — do not hand-edit a ratio.

## Principle

Three-layer color system: 90% ground (cream/brown), 8% interactive (teal), 2% emphasis (gold). Photography and map provide all color richness — UI stays warm and quiet.

## Color Palette

### Primary (Mint Teal)
| Token | Value | Usage |
|-------|-------|-------|
| primary | `#19c8b9` | Buttons, links, active states, Collapse icon |
| primary-hover | `#3dd4c6` | Hover enhancement |
| primary-active | `#11a89b` | Active press / checked state |
| primary-bg | `#e6f9f6` | Light background tint |

**Ours:** `--color-primary: #19c8b9`, `--color-primary-hover: #3dd4c6`, `--color-primary-active: #50b9ab`, `--color-primary-soft: #e6f9f6`, `--color-primary-strong: #0e7d72`, `--color-primary-ink: #073f3a`, `--color-primary-fg: #ffffff`. Delta: upstream `primary-active` (`#11a89b`) is upstream-only; our press tone sits one step lighter. The bright teal carries `--color-primary-ink` for text; `--color-primary-fg` (white) sits on the dark grounds — `--color-primary-strong`, the `--color-overlay` scrim (`DoorwaySummary.tsx` compare labels) and the `--color-map-pin-orange` highlighted map pin (`globals.css`, map-spike pin highlight rule). That is the day palette: the night block (`[data-theme="night"]`, `globals.css`) sets `--color-primary-fg` to the dark ink `#10201d` and leaves those three grounds at their day values, so at night the same usages carry dark text on them.

### Text (Warm Brown)
| Token | Value | Usage |
|-------|-------|-------|
| text-color | `#794f27` | Headers, sidebar titles |
| text-color-body | `#725d42` | Component body text |
| text-color-secondary | `#9f927d` | Muted labels, placeholders |
| text-color-muted | `#8a7b66` | Modal body, subtle content |
| text-color-disabled | `#c4b89e` | Disabled state text |

**Ours:** `--color-fg: #725d42` (upstream `text-color-body`), `--color-fg-ink: #794f27` (upstream `text-color`), `--color-muted-fg: #6f6353`. The header tone has no token of its own: upstream `text-color` is live as `--color-fg-ink`. Upstream `text-color-secondary` (`#9f927d`) and `text-color-disabled` (`#c4b89e`) are upstream-only as text tones; the muted tone decision is recorded under the AA pairings below.

### Background (Cream/Parchment)
| Token | Value | Usage |
|-------|-------|-------|
| bg-color | `#f8f8f0` | Main background (slightly warm) |
| bg-color-content | `rgb(247, 243, 223)` | Modal/Card interiors |
| bg-color-secondary | `#f0e8d8` | Hover backgrounds |
| bg-color-disabled | `#f0ece2` | Disabled inputs |
| bg-color-input | `rgb(247, 243, 223)` | Input backgrounds |

**Ours:** `--color-bg: #f0e8d8` (the page floor, upstream `bg-color-secondary`), `--color-paper: #f8f8f0` (upstream `bg-color`), `--color-card: #f7f3df` (upstream `bg-color-content`), `--color-muted: #e8ddc8`. The floor is cream, not white; `--color-card` and `--color-paper` float above it, `--color-bg` is the darkest layer. Upstream `bg-color-disabled` (`#f0ece2`) is upstream-only.

### Status Colors
| Token | Value | Active | Usage |
|-------|-------|--------|-------|
| success | `#6fba2c` | `#5a9e1e` | Switch ON green, weekday text |
| warning | `#f5c31c` | `#dba90e` | Caution states |
| error | `#e05a5a` | `#c94444` | Error states |

**Ours:** `--color-success-fg: #6fba2c`, `--color-success-deep: #5a9e1e`, `--color-warning-fg: #f5c31c`, `--color-error-fg: #e05a5a`, `--color-error-strong: #b03030`, `--color-error-bg: #fdecec`. Upstream-only: `warning-active` (`#dba90e`) and `error-active` (`#c94444`). Error copy that must clear AA rides `--color-error-strong` on `--color-error-bg`.

### Game-Special Colors
| Token | Value | Usage |
|-------|-------|-------|
| focus-yellow | `#ffcc00` | Input focus border (NOT blue) |
| focus-yellow-dark | `#e0b800` | Focus shadow |
| sidebar-active-bg | `#B7C6E5` | Menu active item |
| sidebar-hover-bg | `#d6dff0` | Menu hover |

**Ours:** `--color-focus: #ffcc00`. Upstream-only: `focus-yellow-dark` (`#e0b800`) and both sidebar tones were never adopted as tokens; the yellow focus ring is the only game-special value in the live sheet.

### Border Colors
| Token | Value | Usage |
|-------|-------|-------|
| border-standard | `#9f927d` | Default borders (2px solid) |
| border-input | `#c4b89e` | Input borders |
| border-input-hover | `#a89878` | Input hover state |

**Ours:** `--color-border: #8d8272`, `--color-border-soft: #e8e2d6`, `--color-switch-off-border: #c4b89e`. `--color-border` deliberately diverges from the package primitive (`#aaa69d`) so the operable boundary clears WCAG 1.4.11's 3:1; `--color-border-soft` is the hint-of-an-edge tone for non-operable surfaces. Upstream-only: `border-standard` (`#9f927d`) and `border-input-hover` (`#a89878`). Upstream `border-input` (`#c4b89e`) is live as `--color-switch-off-border`.

### NookPhone Card Palette (13 colors)
| Name | Background | Text |
|------|-----------|------|
| default | `rgb(247, 243, 223)` | `#725d42` |
| app-pink | `#f8a6b2` | `#fff` |
| purple | `#b77dee` | `#fff` |
| app-blue | `#889df0` | `#fff` |
| app-yellow | `#f7cd67` | `#725d42` |
| app-orange | `#e59266` | `#fff` |
| app-teal | `#82d5bb` | `#fff` |
| app-green | `#8ac68a` | `#fff` |
| app-red | `#fc736d` | `#fff` |
| lime-green | `#d1da49` | `#3d5a1a` |
| yellow-green | `#ecdf52` | `#725d42` |
| brown | `#9a835a` | `#fff` |
| warm-peach-pink | `#e18c6f` | `#fff` |

**Ours:** `--color-nook-yellow: #f7cd67`, `--color-nook-teal: #82d5bb`, `--color-nook-pink: #f8a6b2`, `--color-nook-ink: #5c4813`. Three pastel chips and one shared ink pair; the remaining ten upstream pairs are upstream-only and are added only when a card variant needs one.

## Per-surface AA pairings (small bold text, WCAG AA 4.5:1)

Ratios are measured with the same helper the token tests use (`apps/web/tests/unit/stylesheet-probe.ts`), so the reference cannot drift from the sheet: the suite recomputes each cell and fails on any difference. `AA` means ≥ 4.5:1.

| Text token | Value | On `--color-card` | On `--color-muted` | On `--color-paper` |
|------------|-------|-------------------|--------------------|--------------------|
| `--color-fg` | `#725d42` | 5.608 AA | 4.645 AA | 5.856 AA |
| `--color-fg-ink` | `#794f27` | 6.364 AA | 5.272 AA | 6.646 AA |
| `--color-muted-fg` | `#6f6353` | 5.255 AA | 4.353 fail | 5.488 AA |

`--color-muted-fg` is judged on the card ground its own comment names (5.255:1). On `--color-muted` it reaches only 4.353:1, below AA for small text — a failing pairing, not an exemption. Live small-text uses of that pair are open accessibility debt (`SpotSheet.tsx`, `SkeletonCard.tsx`, `ClarifyCandidateOption.tsx` cover; the disabled send in `ChatInput.tsx` is an inactive control, which WCAG 1.4.3 exempts); new work must not add more. Use `--color-fg-ink` on `--color-muted`, where `--color-fg` clears AA by only 4.645:1 — thin enough that an entrance-animation alpha spends it (#1207 measured 4.43:1 on `.route-map__stage`).

### Upstream-only tones

Listed so the ramp is complete; none is adopted as a live token.

| Upstream-only tone | Value | On `--color-card` | On `--color-muted` | On `--color-paper` |
|--------------------|-------|-------------------|--------------------|--------------------|
| text-color-muted (upstream-only) | `#8a7b66` | 3.690 fail | 3.057 fail | 3.854 fail |
| text-color-secondary (upstream-only) | `#9f927d` | 2.738 fail | 2.268 fail | 2.859 fail |
| text-color-disabled (upstream-only) | `#c4b89e` | 1.761 fail | 1.459 fail | 1.839 fail |

**Decision (upstream `text-color-muted`):** `#8a7b66` is **not adopted**. It clears AA on no ground — 3.057:1 on `--color-muted` — so the live secondary tone stays `--color-muted-fg` (`#6f6353`), which clears AA on the card ground its comment names.

---

## 3D Depth System (Defining Feature)

The most distinctive visual feature: all clickable elements have a bottom box-shadow simulating physical Nintendo game buttons. Shadow depth communicates hierarchy.

### Button Shadows
```css
/* Default — floating */
box-shadow: 0 5px 0 0 #bdaea0;
transform: none;

/* Hover — rise up */
box-shadow: 0 6px 0 0 #bdaea0;
transform: translateY(-1px);

/* Active — pressed down */
box-shadow: 0 1px 0 0 #bdaea0;
transform: translateY(2px);

/* Danger variant — red shadow */
box-shadow: 0 5px 0 0 #c94444;
```

### Input Shadows (lighter, thinner)
```css
/* Small */   box-shadow: 0 2px 0 0 #d4c9b4;
/* Middle */  box-shadow: 0 3px 0 0 #d4c9b4;
/* Large */   box-shadow: 0 4px 0 0 #d4c9b4;

/* Focus */   box-shadow: 0 3px 0 0 #e0b800, 0 0 0 3px rgba(255, 204, 0, 0.15);
/* Error */   box-shadow: 0 3px 0 0 #c94444;
/* Warning */ box-shadow: 0 3px 0 0 #dba90e;
```

### Switch Shadows
```css
/* Handle OFF */ box-shadow: 0 3px 0 0 #bdaea0;
/* Handle ON */  box-shadow: 0 3px 0 0 #5a9e1e;
/* Small OFF */  box-shadow: 0 2px 0 0 #bdaea0;
/* Small ON */   box-shadow: 0 2px 0 0 #5a9e1e;
/* Track OFF */  inset 0 2px 4px rgba(114, 93, 66, 0.15);
/* Track ON */   inset 0 2px 4px rgba(90, 158, 30, 0.2);
```

### Card Shadows (elevation, not press)
```css
/* Default */  box-shadow: 0 4px 10px rgba(107, 92, 67, 0.42);
/* Hover */    box-shadow: 0 8px 24px rgba(114, 93, 66, 0.15);
/* Cards float up on hover, they do NOT press down */
transform: translateY(-4px);  /* hover */
```

**Ours:** `--shadow-3d: #bdaea0`, plus `--shadow-press`, `--shadow-press-sm`, `--shadow-press-lg`, `--shadow-switch-off`, `--shadow-switch-on`, `--shadow-menu`. The press family composes `--shadow-3d`; the per-size input shadow colour (`#d4c9b4`) is live as `--color-switch-off` (there is no separate input-shadow token). Upstream-only: the focus glow combination, the danger/warning shadow variants, and the per-size input depths.

### Focus Ring Strategy
```css
/* Inputs */  border-color: #ffcc00; box-shadow: 0 3px 0 0 #e0b800, 0 0 0 3px rgba(255,204,0,0.15);
/* Buttons */ outline: 2px solid #19c8b9; outline-offset: 2px;
/* Switch */  outline: 2px solid #ffcc00; outline-offset: 2px;
```

**Key rule:** Inputs use yellow (`#ffcc00`). Buttons use teal (`#19c8b9`). Never cold blue.

---

## Forbidden

- No pure black #000 or #111 text — always warm brown tones
- No cold gray backgrounds — always warm parchment
- No cold blue focus rings (#0066ff etc.)
- No flat design without bottom box-shadow on interactive elements
- No drop shadows using pure black rgba(0,0,0,*) — use warm rgba(61,52,40,*)
