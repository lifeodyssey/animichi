> **⚠️ STALE (2026-06-12):** distilled from pre-v0.9.5 upstream. Superseded by `frontend/DESIGN.md` (transcribed from upstream v0.9.5) and the live upstream docs at https://github.com/guokaigdg/animal-island-ui (`skill/SKILL.md` · `DESIGN_PROMPT.md` · `PROMPT.md`). Local mirror: `~/Documents/animal-island-ui-upstream-original`. On conflict, upstream source wins.

# Color System + 3D Depth

Reference distilled from [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) (MIT). Values are exact pixel/hex from source. Adaptation notes compare against our `globals.css`.

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

**Ours:** `--color-primary: #19c8b9` / `--color-primary-hover: #3dd4c6` / `--color-primary-active: #50B9AB` / `--color-primary-soft: #e6f9f6` -- Aligned except active value differs slightly (#11a89b vs #50B9AB). Consider adopting #11a89b for deeper press contrast.

### Text (Warm Brown)
| Token | Value | Usage |
|-------|-------|-------|
| text-color | `#794f27` | Headers, sidebar titles |
| text-color-body | `#725d42` | Component body text |
| text-color-secondary | `#9f927d` | Muted labels, placeholders |
| text-color-muted | `#8a7b66` | Modal body, subtle content |
| text-color-disabled | `#c4b89e` | Disabled state text |

**Ours:** `--color-fg: #725d42` / `--color-fg-heading: #794f27` / `--color-muted-fg: #9f927d` -- Aligned. Missing: `#8a7b66` muted variant (used for modal body text in animal-island).

### Background (Cream/Parchment)
| Token | Value | Usage |
|-------|-------|-------|
| bg-color | `#f8f8f0` | Main background (slightly warm) |
| bg-color-content | `rgb(247, 243, 223)` | Modal/Card interiors |
| bg-color-secondary | `#f0e8d8` | Hover backgrounds |
| bg-color-disabled | `#f0ece2` | Disabled inputs |
| bg-color-input | `rgb(247, 243, 223)` | Input backgrounds |

**Ours:** `--color-bg: #ffffff` (white, not cream) / `--color-card: rgb(247, 243, 223)` / `--color-muted: #f0e8d8` -- Our page bg is white (#fff) vs animal-island's warm #f8f8f0. This is intentional per DESIGN.md three-layer depth: white page > cream components > content.

### Status Colors
| Token | Value | Active | Usage |
|-------|-------|--------|-------|
| success | `#6fba2c` | `#5a9e1e` | Switch ON green, weekday text |
| warning | `#f5c31c` | `#dba90e` | Caution states |
| error | `#e05a5a` | `#c94444` | Error states |

**Ours:** Mostly aligned. Our error uses same `#e05a5a`. Our success/warning BGs are different (semantic cards use lighter tints).

### Game-Special Colors
| Token | Value | Usage |
|-------|-------|-------|
| focus-yellow | `#ffcc00` | Input focus border (NOT blue) |
| focus-yellow-dark | `#e0b800` | Focus shadow |
| sidebar-active-bg | `#B7C6E5` | Menu active item |
| sidebar-hover-bg | `#d6dff0` | Menu hover |

**Ours:** `--color-focus: #ffcc00` / `--color-focus-dark: #e0b800` / `--color-sidebar-active: #B7C6E5` -- Fully aligned.

### Border Colors
| Token | Value | Usage |
|-------|-------|-------|
| border-standard | `#9f927d` | Default borders (2px solid) |
| border-input | `#c4b89e` | Input borders |
| border-input-hover | `#a89878` | Input hover state |

**Ours:** `--color-border: #c4b89e` / `--color-border-hover: #a89878` -- Our default border matches their input border. Their standard border (#9f927d) is darker. Consider this for heavier UI elements like Collapse outlines.

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

**Ours:** Only 3 NookPhone colors (`--color-nook-yellow/teal/red`). Add remaining 10 to globals.css when needed for card color variants.

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

**Ours:** `--shadow-3d-sm/md/lg` and `--color-3d-shadow: #bdaea0` are aligned. Missing: input shadow color (`#d4c9b4`) as `--color-input-shadow` (we have it!), per-size shadow depths, focus glow combination shadow, danger/warning shadow variants.

### Focus Ring Strategy
```css
/* Inputs */  border-color: #ffcc00; box-shadow: 0 3px 0 0 #e0b800, 0 0 0 3px rgba(255,204,0,0.15);
/* Buttons */ outline: 2px solid #19c8b9; outline-offset: 2px;
/* Switch */  outline: 2px solid #ffcc00; outline-offset: 2px;
```

**Key rule:** Inputs use yellow (#ffcc00). Buttons use teal (#19c8b9). Never cold blue.

---

## Forbidden

- No pure black #000 or #111 text — always warm brown tones
- No cold gray backgrounds — always warm parchment
- No cold blue focus rings (#0066ff etc.)
- No flat design without bottom box-shadow on interactive elements
- No drop shadows using pure black rgba(0,0,0,*) — use warm rgba(61,52,40,*)
