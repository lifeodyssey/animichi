<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Storybook stories — MANDATORY design tab

Every `*.stories.tsx` MUST wire the `@storybook/addon-designs` Design tab so the
component can be reviewed against its blueprint, side by side:

```ts
parameters: {
  design: { type: "image", url: "/design-targets/<target>.png" },
},
```

- If a blueprint region exists for the component, crop it into
  `public/design-targets/` and point `design.url` at it.
- If no target exists yet, add a literal `// no-design-target: <reason>` comment
  in the story so the omission is a deliberate, reviewed choice — never a slip.

This is NOT optional. A story created or edited without either a `design`
parameter or the `// no-design-target` escape is a defect — applies to you and to
any sub-agent you dispatch to write stories. Reference:
`components/auth/LandingHeader.stories.tsx`.

## Component Architecture

**Homepage-only since the 2026-06 cleanup.** All post-login pages (chat, search,
anime guide, settings) and their component trees (`components/chat`, `components/map`,
`components/spots`, `components/settings`, the generative registry, the AppShell
layout family, `lib/api`, `hooks/`) were deleted; rebuild them fresh when those
pages return. What remains:

- `app/page.tsx` → `HomeContent` → `components/landing/LandingPage` (hero screen)
- `components/landing/*` — Hero, HeroCopy, ShowcaseCard (fox + photo frame), RouteTrail
- `components/auth/` — LandingHeader, LoginModal, LoginForm; `app/login` + `app/auth/*` routes
- `components/layout/` — SharedFooter (homepage), SharedHeader (login page)
- `components/generative/FoxGuide.tsx` — the fox mascot (used by ShowcaseCard)
- `components/icons/ToriiIcon.tsx` — shared torii gate SVG, uses --color-brand
- `proxy.ts` + `lib/auth/` — Next middleware: session refresh + /v1 JWT gate

### Component Ownership Table

`components/ui/` is split into two categories. Call sites always import from `@/components/ui/*`; the shim is the swap point.

**Package-backed (shims) — thin 2-line re-exports from `animal-island-ui`:**

| File | Package export | Package API notes |
|---|---|---|
| `button.tsx` | `Button`, `ButtonProps`, `ButtonType`, `ButtonSize` | `type` (not `variant`): `primary\|default\|dashed\|text\|link`; sizes `small\|middle\|large`; `danger`/`ghost`/`loading`/`block` booleans. **Used app-wide (~32 call sites)** — `animal-island-ui` is NOT just a token layer, it supplies the Button/Input primitives. |
| `input.tsx` | `Input`, `InputProps`, `InputSize` | `size`: `small\|middle\|large`; `prefix`/`suffix`/`allowClear`/`status`/`shadow`. ~7 call sites. |
| `typewriter.tsx` | `Typewriter`, `TypewriterProps` | 1 call site. |

**App-owned (local composites) — unstyled primitive (base-ui / Radix) + tokens:**

| File | Why local |
|---|---|
| `sheet.tsx` | base-ui `Dialog` composite for slide-over panels |
| `tabs.tsx` | base-ui `Tabs` composite, `variant="line"` + app styling |
| `accordion.tsx` | `CollapseCard` FAQ pattern |
| `badge.tsx` | base-ui `useRender` badge with app variants |
| `scroll-area.tsx` | Radix ScrollArea |
| `skeleton.tsx` | simple `animate-pulse` div |
| `chip.tsx` | example-suggestion pill, cva tone dot (hero) |
| `pill.tsx` | frosted label pill: `hint` / `corner` / `tag` variants |
| `search-bar.tsx` | hero search field + flush `ExploreButton` in one pill |
| `explore-button.tsx` | pumpkin CTA — cva sizes + Radix `Slot` `asChild` |

**Primitive direction (decided 2026-06):** new unstyled primitives use **Radix Primitives**.
The existing base-ui composites (sheet, tabs, accordion, badge) are a *planned* base-ui→Radix
migration, **deferred** (behaviour-preserving infra; touches chat/app pages, not the homepage).
Dead `@radix-ui/*` deps (`checkbox`/`select`/`switch`/`radio-group`/`tooltip`/`accordion`/`tabs`;
keep `slot`) should be pruned **during** that migration. Do NOT adopt a pre-styled library
(Radix Themes / HeroUI / MUI): this is a brand-led product, so unstyled-primitive + tokens (the
shadcn model) is the chosen shape. Dropping `animal-island-ui` is a real migration (re-implement
Button/Input), not a token move — undecided, deferred.

**Cleanup log (2026-06):** homepage stripped to the hero screen only; removed unused ui/
orphans (`card`, `checkbox`, `select`, `switch`, `separator`, `toggle`, `toggle-group`,
`tooltip`, `image-compare`) + the lower landing sections. Hero rebuilt as the journal-card
composition aligned to the generated redraw (`agent-review/hero-redraw.png`);
`components/landing/scene-card/` (`SceneFrameCard`, `CornerLabel`) removed — the centre
seam + corner tags now live inside `HeroSceneCard`.

**Rule:** reach for the `animal-island-ui` shim only for a lossless primitive (Button / Input);
otherwise compose locally on an unstyled primitive + tokens and annotate here.

## Token Ownership

The package `animal-island-ui` owns the `--animal-*` primitive token layer, delivered via `animal-island-ui/style/core` (imported at line 2 of `app/globals.css`). The app's `globals.css :root` defines the `--color-*` semantic alias layer on top.

Alignment contract: the equality between selected `--color-*` tokens and their `--animal-*` counterparts is asserted by `tests/design-token-alignment.test.ts`. This test must remain green; a package upgrade that shifts a primitive token value will fail CI before reaching production. See `DESIGN.md` "Token Alignment Map" for the full mapping table.

**Rule:** never delete or rename an `--animal-*` reference in `globals.css` without updating the contract test. Never change a `--color-*` value that is documented as equal to an `--animal-*` value without checking the current package value first.

## Design System

Light theme — no dark mode toggle. Palette is 動森キャンプ (Animal Crossing x Yuru Camp, warm cream/brown).

CSS variables (defined in `app/globals.css`):
```css
--color-bg:        #ffffff              /* white page background */
--color-fg:        #725d42              /* warm brown text */
--color-card:      #faf8f3              /* cream surfaces */
--color-muted:     #f0e8d8              /* disabled/skeleton */
--color-muted-fg:  #9f927d              /* secondary text */
--color-border:    #c4b89e              /* warm border */
--color-primary:   #19c8b9              /* teal — interactive */
--color-primary-fg: #ffffff             /* white text on teal */
--color-cta:       #f0b429              /* gold — important actions */
--color-focus:     #ffcc00              /* yellow focus ring */
--shadow-3d:       #bdaea0              /* 3D bottom shadow */

--app-font-display: "Noto Serif JP", Georgia, serif
--app-font-body:    "Nunito", "Zen Maru Gothic", "Noto Sans SC", system-ui, sans-serif
```

Use CSS variables, not Tailwind color classes, for brand colors.
All interactive elements (buttons, inputs, chips) are pill-shaped (50px radius).
Buttons use 3D bottom shadow (`0 5px 0 0 #bdaea0`), not color saturation, for hierarchy.

## API Calls

All API calls in `lib/api.ts` must include the Supabase JWT (including SSE via `sendMessageStream()`):
```typescript
const { data: { session } } = await supabase.auth.getSession();
headers: { Authorization: `Bearer ${session?.access_token}` }
```

## Build

Output mode is SSR via `@opennextjs/cloudflare`. Server Components, `generateMetadata()`,
and ISR-style `{ next: { revalidate } }` are supported. Dynamic routes (`[bangumiId]`)
work without `generateStaticParams` — pages are rendered on-demand at the edge.

`npm run build` produces an OpenNext bundle deployed to Cloudflare Workers.
## Design System

Before any design or UI work, read `DESIGN.md` in this directory. It contains the complete visual identity specification (colors, typography, spacing, components, do's and don'ts) in Google's open DESIGN.md format. The authoritative token values live in `app/globals.css :root`.

<!-- END:nextjs-agent-rules -->
