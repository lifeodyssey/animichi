<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Component Architecture

SharedHeader + split panel layout: `AppShell` (header + chat + result panel).

Key components and their responsibilities:
- `components/layout/AppShell.tsx` — layout root; owns `activeMessageId` state
- `components/layout/SharedHeader.tsx` — site-wide header with torii logo + brand; right side accepts children
- `components/layout/ResultPanel.tsx` — right column; renders active result
- `components/layout/ConversationDrawer.tsx` — mobile bottom sheet (vaul); conversation history
- `components/layout/ResultSheet.tsx` — mobile result sheet
- `components/icons/ToriiIcon.tsx` — shared torii gate SVG, uses --color-brand
- `components/generative/registry.ts` — `COMPONENT_REGISTRY`; add new components here
- `components/generative/GenerativeUIRenderer.tsx` — registry lookup; entry point for all results
- `components/chat/MessageBubble.tsx` — bot messages: text + `◈` anchor only (no inline results)

**Adding a new result component:** register in `registry.ts` only. No other file changes needed.

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
