# Seichijunrei — Progress Log

## Session 2026-04-05: Full Project Review + Planning

### Completed
- [x] /office-hours — Design doc approved (Smart Route Planner)
- [x] /plan-eng-review — 4 issues resolved, Codex outside voice, 31 test gaps identified
- [x] /plan-design-review — 4/10 → 8/10, 7 design decisions
- [x] /health — 10/10, all gates green
- [x] /cso — 0 critical, 3 medium
- [x] /qa — P1 bug found (missing tables), magic link auth working
- [x] /investigate — Root cause found + fixed (applied 2 DB migrations)
- [x] /setup-browser-cookies → qa_auth.py magic link flow
- [x] QA infra: scripts/qa_auth.py, .env.test.example, QA test user
- [x] CLAUDE.md: skill routing rules added
- [x] Comprehensive task plan created with backlog

### Commits
- `ae56de3` chore: add gstack skill routing rules to CLAUDE.md
- `7cdc49c` chore: add QA test infrastructure and review artifacts

### Next session
- Create feature branch `feat/smart-route-planner`
- Start Iteration 1 (backend: route_optimizer + route_export)
- Use git worktree for isolated development

## Session 2026-07-26: S1.x sprint — 9 PRs merged

Full handoff: [`handoff-2026-07-26-s1x.md`](./handoff-2026-07-26-s1x.md) — carries the
working method, the confirmed traps, and four decisions still waiting on the owner.

### Merged
- `#435` S1.4 search content shapes + static map (C3a/C3b)
- `#436` S1.9 Cloudflare Turnstile edge gate — **dormant**, not wired to any live path
- `#439` S1.5 route card (TimedItinerary, map promotion, Walk CTA seam)
- `#438` S1.8 anonymous access + edge rate limiting + daily budget breaker
- `#440` S1.13 L0 smoke gate — classified actionable failures; delivers `#434`'s fix (issue stays open: non-default-branch merges don't fire `Closes`)
- `#442` `#303` CatalogClient connection reuse
- `#430` C1 — tool lifecycle on pydantic-ai's official event stream
- `#433`, `#431` earlier in the session

Closed with evidence rather than reimplemented: `#256` (S1.1), `#258` (S1.2).

### Filed
`#437` (S1.4 follow-ups) · `#441` (expired JWT degrades to anonymous) ·
`#443` (search_nearby repeat guard fires intermittently — **do not widen the guard**) ·
`#432` (architecture PRD)

### Carried forward
- `#260` (S1.3) and `#282` (S1.10) in flight
- `#284` (S1.11 BYOK + SSRF) not started — highest security risk of the batch
- `#273` (S1.7) not in the approved order; 3 of its 13 ACs already satisfied
