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

A card with a user-visible surface in `apps/web` differs in three ways: kimi writes it; its PR
comment carries before/after comparison screenshots and screenshots of the flow; and the
coordinator does not merge it — the owner accepts it. A change inside `apps/web` with no
user-visible surface (a test helper, a build config) is not a visible-UI card. Its review looks at
whether the component looks right as well as at the code ("不光要看代码，还要看组件是否好看",
2026-09-13). Before it is submitted, its author starts it locally and shows it to the owner
("在你提交之前本地启动给我看看", 2026-09-05); the screenshots come from that run.

The same 2026-09-21 message said "不需要等机器人窗口，你看一下memory，之前给你提过机器人的事情". It
pointed back to the rule that a bot which left nothing does not block (`docs/ops/review-gate.md`),
and it is not an exception for visible-UI cards. Because the coordinator does not merge a
visible-UI card, no bot window stands between the card and the owner's look; the merge itself
still passes the merge hook in `docs/ops/review-gate.md`, including its refusal in the first
minutes before the bots have spoken.

## Cite the installed API, never a remembered major version

Read the installed `.d.ts` and the lockfile (`node -p "require('ai/package.json').version"` from
`apps/web`) before naming an API or a version in a brief.
