---
paths:
  - "apps/web/**/*.tsx"
  - "apps/web/**/*.css"
---
# CSS / UI rules (frontend, auto-enforced)

Relocated from the root context file — scoped here so it only loads when editing frontend UI.

- Read `apps/web/AGENTS.md` before any design or UI work — it is the design-system source of truth.
- Animal Island UI reference: `docs/design/animal-island-ref/` (color / typography / interaction /
  component specs) — read before component-redesign work.
- Tokens live in `apps/web/src/styles/globals.css :root`; registered in `@theme inline` for Tailwind utilities.
- Use semantic Tailwind classes (`bg-primary`, `text-foreground`, `border-border`) — never `bg-[var(--color-*)]`.
- Never use `style={{ }}` for values with Tailwind equivalents (color, spacing, font, radius, opacity).
- Never use `space-y-*` / `space-x-*` — use `flex flex-col gap-*` (shadcn rule).
- Never use template-literal `className` ternaries — use `cn()` from `@/lib/utils`.
- Never hardcode `oklch()` / hex in components — extract to a CSS variable if used 2+ times.
- Extract repeated animation strings to CSS classes in `globals.css` (`.entrance-up`, `.entrance-slide-right`, …).
- Use the shadcn `<Skeleton>` for loading states — never a hand-written `animate-pulse` div.
- Run `/css-audit` before committing frontend changes.
