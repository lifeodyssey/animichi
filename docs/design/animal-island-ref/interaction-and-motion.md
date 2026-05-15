# Interaction States + Animation + Focus

Reference distilled from [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) (MIT).

## Principle

Every interactive element has 6 states with distinct visual feedback. The "Nintendo button press" (3D shadow shift on click) is the single most defining interaction pattern.

## The 6 Interactive States

### Button States
```css
/* 1. Default */
box-shadow: 0 5px 0 0 #bdaea0;
transform: none;

/* 2. Hover — float up */
box-shadow: 0 6px 0 0 #bdaea0;
transform: translateY(-1px);

/* 3. Active — press down (Nintendo game button) */
box-shadow: 0 1px 0 0 #bdaea0;
transform: translateY(2px);

/* 4. Focus-visible */
outline: 2px solid #19c8b9;
outline-offset: 2px;

/* 5. Disabled */
opacity: 0.5;
cursor: not-allowed;
pointer-events: none;

/* 6. Loading (animated diagonal stripes) */
background: #0ec4b6;
border: 4px solid #4de2da;
color: #fff;
background-image: repeating-linear-gradient(
  -45deg,
  #0ec4b6, #0ec4b6 10px,
  #01b0a7 10px, #01b0a7 20px
);
background-size: 28.28px 28.28px;
animation: animal-btn-loading 1s linear infinite;
```

### Input States
```css
/* 1. Default */
border: 2.5px solid #c4b89e;
box-shadow: 0 3px 0 0 #d4c9b4;
background: rgb(247, 243, 223);

/* 2. Hover */
border-color: #a89878;

/* 3. Focus */
border-color: #ffcc00;
box-shadow: 0 3px 0 0 #e0b800, 0 0 0 3px rgba(255, 204, 0, 0.15);

/* 4. Disabled */
background: #ece8dc;
border-color: #d4c9b4;
box-shadow: none;
opacity: 0.6;

/* 5. Error */
box-shadow: 0 3px 0 0 #c94444;

/* 6. Warning */
box-shadow: 0 3px 0 0 #dba90e;
```

### Switch States
```css
/* OFF — default */
background: #d4c9b4;
border: 2.5px solid #c4b89e;
handle box-shadow: 0 3px 0 0 #bdaea0;

/* ON */
background: #86d67a;
border-color: #6fba2c;
handle box-shadow: 0 3px 0 0 #5a9e1e;

/* Handle always floats */
transform: translateY(-2px);

/* Focus */
outline: 2px solid #ffcc00;
outline-offset: 2px;

/* Disabled */
opacity: 0.5;

/* Loading */
11x11px spinner, border 2px, rotates 360deg in 0.6s
```

### Card States (float, not press)
```css
/* Default */
box-shadow: 0 4px 10px rgba(107, 92, 67, 0.42);

/* Hover — gentle float up */
transform: translateY(-4px);
box-shadow: 0 8px 24px rgba(114, 93, 66, 0.15);

/* Cards do NOT have active/press states */
```

### Checkbox States
```css
/* Default */
background: rgb(247, 243, 223);
border: 2.5px solid #c4b89e;
border-radius: 8px;

/* Hover */
border-color: #19c8b9;
transform: translateY(-1px);

/* Checked */
background: #19c8b9;
border-color: #11a89b;
/* checkmark pop animation: 0.15s, scale 0.4 -> 1.2 -> 1 */

/* Disabled */
background: #f0ece2;
border-color: #d4c9b4;
opacity: 0.55;
```

---

## Motion Tokens

### Duration
| Token | Value | Usage |
|-------|-------|-------|
| fast | `0.15s` | Hover states, clear button, checkbox pop |
| base | `0.25s` | General transitions, button press, modal mask |
| slow | `0.3-0.35s` | Card hover, Collapse expand, modal zoom-in |

**Ours:** `--duration-fast: 150ms` / `--duration-base: 250ms` / `--duration-slow: 400ms` -- Aligned (our slow is 400ms vs 350ms, minor).

### Easing
```css
/* Primary easing — smooth, snappy (used everywhere) */
cubic-bezier(0.4, 0, 0.2, 1)

/* Fast operations use linear timing */
/* Card transitions use ease */
```

**Ours:** `--ease-animal: cubic-bezier(0.4, 0, 0.2, 1)` -- Exact match.

### Transform Vocabulary
| Element | Hover | Active |
|---------|-------|--------|
| Button | `translateY(-1px)` | `translateY(2px)` |
| Input | `translateY(-1px)` | - |
| Card | `translateY(-4px)` | - |
| Switch handle | `translateY(-2px)` (always) | - |
| Checkbox | `translateY(-1px)` | - |
| Collapse icon | `rotate(180deg)` | - |
| Collapse leaf | `rotate(45deg)` | - |

---

## Entry Animations

### Zoom In (Modal)
```css
@keyframes animal-zoom-in {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1); }
}
/* Duration: 0.3s ease */
```

### Fade In (Modal mask, general)
```css
@keyframes animal-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
/* Duration: 0.25s ease */
```

### Fade Up (Tabs content, Time)
```css
@keyframes ac-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Duration: 0.25s ease */
```

### Checkbox Pop
```css
@keyframes animal-checkbox-pop {
  0%   { transform: scale(0.4); opacity: 0; }
  60%  { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}
/* Duration: 0.15s cubic-bezier(0.4, 0, 0.2, 1) */
```

### Button Loading Stripe
```css
@keyframes animal-btn-loading {
  0%   { background-position: 0 0; }
  100% { background-position: -28.28px 0; }
}
/* Duration: 1s linear infinite */
```

### Switch Spinner
```css
@keyframes animal-spin {
  to { transform: rotate(360deg); }
}
/* Duration: 0.6s linear infinite */
```

### Leaf Wiggle (Tabs decoration)
```css
@keyframes leafWiggle {
  0%, 100% { transform: rotate(0deg); }
  25%      { transform: rotate(-10deg); }
  75%      { transform: rotate(10deg); }
}
/* Duration: 2s ease-in-out infinite */
```

### Icon Bounce (Phone apps)
```css
@keyframes iconBounce {
  0%   { transform: scale(1) rotate(0deg); }
  50%  { transform: scale(1.2) rotate(-5deg); }
  100% { transform: scale(1.1) rotate(-4deg); }
}
/* Duration: 0.3s ease-in-out forwards */
```

### Colon Blink (Time)
```css
@keyframes blink {
  50% { opacity: 0; }
}
/* Duration: 1s step-end infinite */
```

---

## Accordion Expand (CSS Grid, no JS)

The Collapse component uses a pure CSS technique for smooth height animation:

```css
/* Container */
display: grid;
grid-template-rows: 0fr;
transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);

/* Inner wrapper */
overflow: hidden;

/* Expanded */
grid-template-rows: 1fr;
```

This is superior to `max-height` hacks (no need to guess height) and eliminates JavaScript measurement. Our Accordion component should adopt this pattern.

---

## Focus Ring Strategy

| Element | Ring Style |
|---------|------------|
| Inputs | `border-color: #ffcc00` + combined 3D + glow shadow |
| Buttons | `outline: 2px solid #19c8b9; outline-offset: 2px` |
| Switch | `outline: 2px solid #ffcc00; outline-offset: 2px` |
| Checkbox | `outline: 2px solid #ffcc00; outline-offset: 2px` |

**Rule:** Yellow (#ffcc00) for form controls, teal (#19c8b9) for action buttons. Never cold blue.

**Ours:** `--color-focus: #ffcc00` with `--shadow-focus-glow`. Aligned, but we should ensure buttons specifically use teal outlines vs inputs using yellow.

---

## Adaptation Gaps Summary

| Gap | Priority | Action |
|-----|----------|--------|
| Button hover translateY(-1px) | High | Add to all button variants |
| Button active translateY(2px) | High | Add pressed state to buttons |
| Card hover translateY(-4px) | High | Add to card components |
| Loading stripe animation | Medium | Add `animal-btn-loading` to globals.css |
| Checkbox pop animation | Medium | Add to checkbox checked transition |
| Differentiated focus (teal vs yellow) | Medium | Split focus ring by element type |
| CSS Grid accordion | Low | Already using similar pattern |
| Decorative animations (leaf, bounce) | Low | Nice-to-have, not essential |
