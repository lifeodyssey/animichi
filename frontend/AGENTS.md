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

Light theme — no dark mode toggle. Palette is リズと青い鳥 (light blue, KyoAni-inspired).

CSS variables (defined in `app/globals.css`):
```css
--color-bg:      oklch(98% 0.004 240)   /* near-white */
--color-fg:      oklch(20% 0.020 240)   /* near-black */
--color-card:    oklch(100% 0 0)
--color-muted:   oklch(90% 0.010 240)
--color-muted-fg: oklch(45% 0.020 240)
--color-border:  oklch(78% 0.015 240)
--color-primary: oklch(72% 0.100 240)   /* light blue */
--color-primary-fg: oklch(25% 0.040 240) /* dark text on light blue */

--app-font-display: "Noto Serif JP", Georgia, serif
--app-font-body:    "Noto Sans JP", system-ui, sans-serif
```

Use CSS variables, not Tailwind color classes, for brand colors.

## API Calls

All API calls in `lib/api.ts` must include the Supabase JWT (including SSE via `sendMessageStream()`):
```typescript
const { data: { session } } = await supabase.auth.getSession();
headers: { Authorization: `Bearer ${session?.access_token}` }
```

## Build

Output mode is `output: 'export'` (static site). No server-side Next.js features
(`next/headers`, `cookies()`, Route Handlers with dynamic responses).

`npm run build` writes static output to `out/` (served by the Cloudflare Worker via the `ASSETS` binding).
## Design System

Before any design or UI work, read `DESIGN.md` in this directory. It contains the complete visual identity specification (colors, typography, spacing, components, do's and don'ts) in Google's open DESIGN.md format. The authoritative token values live in `app/globals.css :root`.

<!-- END:nextjs-agent-rules -->
