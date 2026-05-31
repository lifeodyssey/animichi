# Animal Island Full Redesign — Wave Plan (Coordinator)

Spec: `docs/superpowers/specs/2026-05-31-animal-island-full-redesign.md` (16 cards, 62 ACs)
Branch: `feat/ssr-cloudflare` (worktree `.claude/worktrees/ssr-migration/`)

## Execution model (Coordinator decisions)

- **Where:** cards run as `executor` agents working **in the ssr-migration worktree** (branch `feat/ssr-cloudflare`), committing one commit per card. No GitHub PR ceremony (solo dev); local commits to the branch. Reviewer agent for risky cards (A1, C1–C3).
- **Parallelism:** serial-within-wave by default. Parallel only when files are truly disjoint. Shared seams that force serialization: `lib/dictionaries/{ja,en,zh}.json` (nearly every card), `LandingPage.tsx` (B1/B2/B3), `registry.ts` (A4/C4), `globals.css` (A1/A3).
- **Gate per card:** `make check` (lint + typecheck + frontend tests) + `ac_total == ac_with_test`. Gate per wave: `npm run build` (OpenNext) + Coordinator diff review. Checkpoint with user at each wave boundary.
- **Package is in scope (user-approved):** design-SYSTEM changes (Button/Card/Switch/tokens) may be made in the `animal-island-ui-tailwind` package itself (rebuild → `npm install` to refresh `file:` link). Product-specific pieces (BeforeAfter, FoxGuide, SelectionTray, SpotDetail) stay app-layer. Package stays generic = single source of truth.
- **Skill-driven (project HARD rule):** every executor **MUST invoke `/impeccable` before writing any frontend code** — it carries the design principles, anti-AI-slop guardrails, and Context Gathering Protocol (reads `DESIGN.md` / `globals.css` / `AGENTS.md` first). Design-heavy cards (A4, A5, B1–B3, C1–C4, D1–D4) also run `/critique` or `/design-review` after implementing. Use `/frontend-tdd` for the TDD loop.

## Resolved risks

- **R5 (coverage floor):** working floor = the **config value** in `vitest.config.ts`: lines≥72, statements≥68, functions≥61, branches≥59. Never lower. Backlog: re-enable `DesktopConversationSidebar` disabled test so `functions` can ratchet back to 62 (do it if a card touches that component).
- **R1/R2 (CSS + token desync) — CONFIRMED CONCRETE:** `node_modules/animal-island-ui/dist/index.css` is **stale (38KB, built May 17)** vs the clone source **(65KB, built May 31)**. The vendored `frontend/app/animal-island-ui.css` also = 38KB (old). So A1 must FIRST rebuild + refresh the package link (node_modules → 65KB) BEFORE swapping the import, or it will still load stale tokens. A2's contract test then locks alignment.
- **R3 (`BeforeAfter` vs `ImageCompare`):** A4 extracts shared internals; hero consumes `BeforeAfter` (one motif owner).
- **R6 (i18n literal debt):** `LandingPage.tsx` hardcodes JP literals — B1 migrates to dictionaries.
- **R7 (fox policy):** A5 enforces placement by a typed `surface` allowlist (compile-time); D3 adds runtime assertion fox absent on 05/09/10.

## Wave graph

| Wave | Cards | Order | Depends on | Gate |
|---|---|---|---|---|
| **0 — Foundation** | A1, A2, A3, A4, A5 | A1→A2 serial; A3 serial (globals); A4, A5 parallel-safe (disjoint new files) | — | `npm run build` green; tokens resolve |
| **1 — Guest homepage** | B1, B2, B3 | B1 (hard gate #1) ‖ (B2→B3) — but all touch LandingPage → serialize B1→B2→B3 | A4, A5 | example-search fires; i18n clean |
| **2 — Core components** | C1, C2, C3, C4 | serialize on shared dictionaries; disjoint component files otherwise | A1, A2, A4 | long-data states proven (0/12/30/20 + broken img) |
| **3 — App states** | D1, D2, D3, D4 | D1 (header, hard gate #2) first → D2/D3/D4 | Wave 1 + Wave 2 | unified nav; fox policy; hydrate works |

After all waves: Coordinator pulls, `make dev-local`, Tester validates all ACs against running app (:3001), tags `vX.Y.Z` → CI deploys.

## Hard gates (block the wave)

1. **B1 Hero** — pill search + gold CTA `#f0b429` + `BeforeAfter` primary visual + one-tap example search (no dead `readOnly` input).
2. **D1 Header** — one shared nav constant rendered identically across all app states.
3. **C1 SelectionTray** — 0-empty + 8–12 overflow + collapse + CTA-disabled, no layout break at 12 / 30 / 20 long data.
