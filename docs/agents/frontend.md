# Frontend — what `apps/web/AGENTS.md` and the CSS rule do not say

The design-system source of truth is `apps/web/AGENTS.md` (visual direction, tokens, pitfalls);
the CSS rules are `.claude/rules/css.md`. This file keeps the lineage, the skill entry points and
a pointer to the visible-UI card rule.

## Design-system lineage: do not re-propose the rejected generations

The current system is the third generation, 動森 (Animal Crossing × ゆるキャン) on
`animal-island-ui`; its current visual direction is the one `apps/web/AGENTS.md` states.
Generation one (京吹夏季 double-accent blue, 2026-04-21) and generation two (リズ浅蓝 `#7aade4`,
2026-04-30, rejected by the owner as "太淡") were dropped; do not bring either back as an option.
The original design contract files are archived under `docs/archive/root-docs/`, and every file in
`docs/design/animal-island-ref/` carries a stale, superseded banner.

## Design work goes through the design skills first

The owner caught manual px→rem fixes, a header redesign and i18n done by hand and required a
restart ("在做刚刚的那些事情的时候你用了对应的 skill 了吗"). `.claude/rules/css.md` requires
`/css-audit` before a frontend commit; the wider habit is to invoke the skill before the work:
`/css-audit` or `/shadcn` before CSS, `impeccable` before redesigning a component and its
`typeset`, `harden` and `animate` commands for fonts, for i18n and error states, and for motion,
`/design-overhaul` to orchestrate a multi-step redesign.

## Visible-UI cards (owner, 2026-09-21)

The coordinator skill's roster section holds the three rules for a card with a user-visible
surface in `apps/web`: who writes it, what its PR comment carries, who accepts it.

## Cite the installed API, never a remembered major version

Read the installed `.d.ts` and the lockfile (`node -p "require('ai/package.json').version"` from
`apps/web`) before naming an API or a version in a brief.
