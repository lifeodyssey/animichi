## Design Context

### Users
Primary users are anime fans planning a seichi junrei trip, plus travelers who are already near a station or neighborhood and want to decide whether a detour is worthwhile.

The product supports users in Chinese, Japanese, and English. Their core jobs are:
- discover meaningful scenes from a specific anime
- understand what is worth visiting nearby right now
- turn selected scenes into a realistic half-day or one-day route

### Brand Personality
The interface should feel like a high-quality travel planning tool with warmth, not a generic AI chat app or a cold SaaS dashboard.

Working personality:
- warm (Animal Crossing-inspired parchment palette with earthy browns)
- cozy (3D tactile buttons, pill shapes, rounded everything)
- practical (map-first, content-driven, photos speak)

The emotional goal is to reduce blank-page anxiety and replace it with momentum: users should feel oriented, inspired, and ready to go out.

### Aesthetic Direction

**動森キャンプ (Animal Crossing x Yuru Camp) palette** — warm, tactile, cozy. White page background with cream component surfaces and warm brown text. UI stays quiet so photos and map do the visual work.

Three-layer color system: 90% ground (cream/brown), 8% interactive (teal), 2% emphasis (gold).

**Color tokens (WCAG AA verified):**
```
Page bg:       #ffffff                   white — clean page background
Card/Surface:  rgb(247,243,223) / #faf8f3  cream — component backgrounds
Text:          #725d42 / #794f27         warm brown — primary text
Muted:         #9f927d / #f0e8d8         muted brown — secondary text, disabled bg
Border:        #c4b89e                   warm border — cards, dividers
Primary:       #19c8b9                   teal — interactive feedback (buttons, links, active)
CTA:           #f0b429                   gold — important actions, key operations
Focus:         #ffcc00                   yellow ring — game-style focus indicator
Brand:         oklch(58% 0.19 28)        torii vermillion — logo only
3D Shadow:     #bdaea0                   earthy shadow — bottom shadow on buttons/inputs
```

**Button hierarchy via shadow depth, NOT color saturation:**
- Primary button: cream background + 3D bottom shadow (`0 5px 0 0 #bdaea0`)
- CTA button: gold (#f0b429) background + 3D shadow
- Danger button: red background + 3D shadow
- All interactive elements are pill-shaped (50px border-radius)

**Typography:**
- Body font: Nunito (rounded, friendly Latin)
- CJK font: Noto Sans SC (consistent CJK rendering)
- Japanese font: Zen Maru Gothic (rounded Japanese, matches Nunito warmth)
- Display font: Noto Serif JP (editorial authority for headings)
- Type scale: Perfect Fourth 1.333 ratio — 12/14/16/18/24/28/42/72

**Radius scale:** Large rounded corners throughout — 12/18/24/50px. All interactive elements (buttons, inputs, chips) use 50px (full pill). Cards use 18-24px. Badges use 12px.

**3D depth system:** Bottom shadows on buttons and inputs: `0 5px 0 0 #bdaea0`. Pressed state removes shadow and shifts down. Focus ring: 2px yellow #ffcc00 (game-style).

**Three-layer depth:** White page (#ffffff) → cream components (#faf8f3) → content (photos, map). Components float on the page with subtle warmth.

**Header:** White background, nav links, cream Login button with 3D shadow. Breadcrumb navigation on inner pages.

**Cards:** Cream background (#faf8f3) with warm border (#c4b89e). Hover: translateY(-2px) + stronger shadow.

**Photography and map provide all color richness.** UI is warm neutrals (cream/brown) + teal for interaction + gold for emphasis. Minimal color, maximum warmth.

Avoid: AI-generated warm cream everywhere (be intentional), generic SaaS dashboards, cold blue palettes, gradient text, overly saturated colors.

### Reference Library

Design language distilled from [animal-island-ui](https://github.com/guokaigdg/animal-island-ui):
- `docs/design/animal-island-ref/color-and-depth.md` — Color palette + 3D shadow system
- `docs/design/animal-island-ref/typography-and-spacing.md` — Fonts, spacing, radius, borders
- `docs/design/animal-island-ref/interaction-and-motion.md` — Interactive states, animation, focus
- `docs/design/animal-island-ref/component-specs.md` — Per-component pixel specs + mapping to our components

Local source: `/tmp/animal-island-ui/` (key files: `skill/SKILL.md`, `DESIGN_PROMPT.md`, `AI_USAGE.md`, `src/styles/variables.less`)

Read the 4 distilled docs before any component redesign. Each includes adaptation notes comparing against our `globals.css` and `DESIGN.md`.

### Technical Context

Stack: Next.js 16 (SSR via @opennextjs/cloudflare), Tailwind v4, base-ui + shadcn/ui, Mapbox GL + react-map-gl, Supabase auth.
Build: SSR on Cloudflare Workers (migrated from static export).
Components: ~60 total, shared spot components (SpotCard, SpotGroup, Filmstrip, GroupToggle).
Generative UI: registry-based (`registry.ts`) mapping backend intents to visual components.
i18n: ja/zh/en, dictionary-based dynamic imports.

### Layout Direction

**Map-first layout** — the interface centers on geographic data, not chat.

- **Landing** (`/`): Left-text hero + right comparison image, anime gallery grid
- **Guide** (`/anime/[id]`): Cover + title hero → filmstrip → map → CTA → episode/area grouped spots
- **AppShell** (`/chat`): ResultPanel full width (map + spot grid), ChatPopup as floating assistant
- **Mobile** (<768px): single column, chat panel when no results, result panel when results exist

Chat is a floating popup assistant for route planning, NOT the primary interface.

**Shared components:** SharedHeader, SharedFooter, SpotCard (browse/select modes), SpotGroup (collapsible, with thumbnail preview), Filmstrip, GroupToggle (episode/area).

**Smart grouping:** TV series → by episode. Movies → by geographic area. User can toggle.

### Accessibility

- WCAG AA target — all text/background pairs verified
- Touch targets: 44px minimum
- Reduced motion: `prefers-reduced-motion` respected
- Outdoor use: sufficient contrast for bright-screen readability
- Focus visible: 2px yellow #ffcc00 ring with offset (game-style)
- Border token: warm decorative (#c4b89e)
- Button pattern: cream bg + 3D shadow for primary; gold for CTA

### Design Principles
1. UI stays quiet — let photos and map do the visual work.
2. Three-layer depth: white page → cream components → content.
3. Shadow depth = importance. Color = interaction feedback.
4. Start from user intent, not from an empty chat box.
5. Keep scenes, map, and route in the same working context.
6. Make the next action obvious (gold CTA for key operations).
7. Every screen size gets a considered experience.
