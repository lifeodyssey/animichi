# Proposal: context-doc structure for CLAUDE.md / AGENTS.md / docs

Status: **proposal — not implemented.** Nothing in this document has been applied to the repo.
It exists so the restructuring decisions below can be reviewed and approved before any file
gets moved, split, or symlinked differently.

Companion PR (already merged-ready, separate from this proposal): `docs/context-file-audit`
— fixed the corrupted-content bug and stale monorepo paths in CLAUDE.md/AGENTS.md/READMEs.
That PR is purely mechanical (paths, dead links, rename residue). This document covers
everything that PR deliberately did *not* touch because it requires a structural decision.

---

## 1. Research: what the ecosystem does in 2026

### 1.1 AGENTS.md vs CLAUDE.md — who reads what

- **AGENTS.md is the open, vendor-neutral standard.** It emerged in August 2025 from a
  collaboration between OpenAI, Google, Cursor, and Factory, and was donated to the Linux
  Foundation's Agentic AI Foundation in December 2025. It's read by 30+ tools (Codex, Cursor,
  Aider, Devin, Sourcegraph Amp, Google Jules, Zed, Continue, Roo Code, Factory, GitHub
  Copilot, Gemini CLI, Windsurf, Amazon Q). Format is deliberately minimal — plain Markdown,
  no required schema — sections are just convention ("Project overview", "Build and test
  commands", "Code style guidelines", "Testing instructions", "Security considerations").
  [agents.md](https://agents.md/)
- **Claude Code does NOT read AGENTS.md natively — this resolves a contradiction in
  secondary sources.** Several 2026 blog posts claim Claude Code reads AGENTS.md directly;
  that's wrong. Per Anthropic's own current docs: *"Claude Code reads `CLAUDE.md`, not
  `AGENTS.md`."* The documented pattern for a repo that already has AGENTS.md (for other
  tools) is either:
  1. A `CLAUDE.md` that does `@AGENTS.md` (plus optional Claude-only content below the
     import), or
  2. A symlink `CLAUDE.md -> AGENTS.md` (`ln -s AGENTS.md CLAUDE.md`).

  Note the **direction**: `CLAUDE.md` is the pointer, `AGENTS.md` is the canonical file.
  This is the opposite of what our repo currently does at the root (see §2.1).
  [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- Running `/init` in a repo that already has AGENTS.md reads it and folds the relevant
  parts into the generated CLAUDE.md — another signal that AGENTS.md is meant to be the
  primary authored content and CLAUDE.md the Claude-specific surface over it.
  [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)

### 1.2 How CLAUDE.md files actually load (this changes what "belongs in root" means)

Straight from the official docs, since this directly drives the file-tree proposal below:

- CLAUDE.md files **above** the current working directory (root, and any ancestor) are
  loaded **in full at launch** — every session pays their token cost regardless of what
  you're working on.
- CLAUDE.md files **in subdirectories under** the cwd load **on demand**, only when Claude
  reads a file in that subdirectory. A hypothetical `apps/agent/CLAUDE.md` would *not* load
  when you're only touching `workers/catalog/` or `frontend/`.
- All discovered files are **concatenated**, not overridden — root loads first, nested
  loads after (closer to cwd = read later = "last word" in context).
- HTML comments (`<!-- ... -->`) are **stripped before injection** into context — usable for
  maintainer-only notes, but this also means a corrupted block wrapped in HTML comments
  (like the bug this proposal's companion PR fixed) still burns full context on every
  session, since only the *comment markers* are stripped, not the content between them.
- Size guidance: **target under ~200 lines per CLAUDE.md file.** Longer files consume more
  context and measurably reduce instruction-following (files are delivered as a user
  message, not the system prompt, so adherence is probabilistic, not enforced).
- `@path` imports load at launch too (they don't defer cost), but they're useful for
  *organizing* content and for the AGENTS.md interop pattern above. Max import depth: 4 hops.
  [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)

### 1.3 `.claude/rules/` — the mechanism this repo isn't using yet

Claude Code supports topic-scoped rule files in `.claude/rules/*.md`. Rules without a
`paths:` frontmatter field load unconditionally (same priority as root CLAUDE.md). Rules
**with** a `paths:` glob load only when Claude touches a matching file:

```markdown
---
paths:
  - "frontend/**/*.tsx"
  - "frontend/**/*.css"
---
# CSS Rules
...
```

This is built for exactly the situation audited in §2.3 below: rules that are 100%
irrelevant outside one part of the tree (CSS rules when working in `apps/agent/`, Python
type-safety rules when working in `frontend/`) currently load on *every* session because
they live in root CLAUDE.md. `.claude/rules/` is not currently used anywhere in this repo
(`ls .claude/rules/` → does not exist; only `.claude/agents/` and `.claude/skills/` do).
[code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)

### 1.4 Monorepo layering pattern

Convergent guidance across sources: **thin root, rich per-package.**

- Root AGENTS.md/CLAUDE.md: org-wide standards, package manager, monorepo layout map,
  cross-cutting security/guardrail rules, links to everything else.
- Per-package AGENTS.md/CLAUDE.md: service-specific conventions (e.g. `apps/api/AGENTS.md`
  for Fastify conventions, `apps/web/AGENTS.md` for component/state conventions).
- Precedence: the file closest to the code being edited wins / adds the specifics; root
  sets the foundation. OpenAI's own monorepo reportedly has 88 nested AGENTS.md files.
- Explicit warning worth carrying into this repo's execution: **scope discipline** — a
  nested file that talks about an unrelated part of the stack "will load ... and confuse"
  when Claude is working in that directory. Each nested file must stay strictly scoped to
  its own directory's concerns.
  [morphllm.com/agents-md-guide](https://www.morphllm.com/agents-md-guide),
  [mcsee.medium.com — nested AGENTS.md](https://mcsee.medium.com/ai-coding-tip-014-use-nested-agents-md-files-23031bb0786a),
  [codegateway.dev — AGENTS.md playbook](https://www.codegateway.dev/en/blog/agents-md-playbook-2026),
  [agentrulegen.com — monorepo rules guide](https://www.agentrulegen.com/guides/agent-rules-for-monorepos)

### 1.5 Progressive disclosure / avoiding bloat

- "Don't tell Claude all the information you could possibly want it to know. Tell it how to
  find important information ... only when it needs to." Reference detailed docs from
  CLAUDE.md with a "read X when doing Y" trigger, rather than inlining them.
- Never duplicate what a linter/type-checker already enforces in prose.
- Context-rot is measurable, not folklore: a 2025 Chroma study found accuracy degrading
  from ~95% to ~60% as input context grows, across all 18 frontier models tested; the
  "lost in the middle" effect drops accuracy over 30% for content in the middle of a long
  context. This is the concrete cost of an over-long root file loaded every session.
  [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices),
  search summary citing Chroma (2025) and Morph (2025) — see also the official memory docs
  cited in §1.2 for the same "under 200 lines" guidance from Anthropic directly.

---

## 2. Audit: what this repo currently does, gap by gap

(Everything path/rename/dead-link related was already fixed in the companion PR. This
section covers what's *structurally* off — the reason those items weren't folded into that
PR.)

### 2.1 Root symlink direction is backwards

Currently: `AGENTS.md` (root) is a symlink → `CLAUDE.md` (root is the real file).
Per §1.1, Anthropic's documented pattern is the reverse: `CLAUDE.md` should be the pointer,
`AGENTS.md` the canonical file, so that the 30+ AGENTS.md-native tools get real content
without indirection, and Claude Code follows the pointer to reach the same content.

Interestingly, **`frontend/` already does this correctly**: `frontend/CLAUDE.md` contains
just `@AGENTS.md`, and `frontend/AGENTS.md` holds the real content. Root and `frontend/`
currently use two different, inconsistent mechanisms to achieve the same goal.

### 2.2 No per-package AGENTS.md/CLAUDE.md despite a monorepo layout

`apps/agent/` and `workers/catalog/` — the two service packages — have **no** CLAUDE.md or
AGENTS.md of their own. Every Python-specific rule (1-10-50 rule, type-safety rules, TDD
invocation) and every TS/catalog-specific rule currently lives in the *root* file, which
per §1.2 means they load into context on every single session, including sessions that
touch only `frontend/`.

`packages/contract/README.md` has accumulated some of what a `workers/catalog/AGENTS.md`
would otherwise own (the error-registry checklist, the "three mirrors, one registry"
convention) — useful content, but a README isn't a file any agent tooling auto-loads.

### 2.3 Root CLAUDE.md is over the size guidance, and mixes universal + scoped content

Post-corruption-fix (companion PR), root CLAUDE.md is **273 lines** — already over the
~200-line target in §1.2, before counting anything this proposal would add back. Sections
that are scoped to one part of the tree but currently load unconditionally for everyone:

| Section | Actually relevant to | Lines (approx) |
|---|---|---|
| `### CSS Rules (auto-enforced)` | `frontend/**` only | ~12 |
| `### Type Safety` | `apps/agent/**` only | ~5 |
| `### Test Quality` | all, but detailed enough to scope per-stack | ~4 |
| `## External API Reference` (Anitabi/Bangumi API details) | `apps/agent/**` (retriever/resolve_anime) | ~5 |
| `### Tools (@agent.tool registrations...)` table | `apps/agent/**` | ~10 |

These are exactly the candidates for `.claude/rules/*.md` with `paths:` scoping (§1.3), or
for relocation into the new per-package files (§2.2).

### 2.4 `docs/DOCS_POLICY.md` duplicates CLAUDE.md's "Source of Truth" table — and is itself stale

`docs/DOCS_POLICY.md` has its own "Single Sources Of Truth" table that overlaps almost
entirely with CLAUDE.md's "Source Of Truth" section — two tables, two places to keep in
sync, and they've already drifted: DOCS_POLICY.md still says `backend/agents/...` and
`worker/worker.js`, both pre-monorepo/pre-rename paths that no longer exist (`agent/` moved
under `apps/agent/`, `worker/worker.js` was renamed `worker/entry.ts`). DOCS_POLICY.md also
still calls `frontend/AGENTS.md` "Next.js static export," which was already wrong before
this audit (see companion PR).

This is a textbook case of the exact failure mode `DOCS_POLICY.md`'s own review checklist
warns against: *"Does it duplicate another file? Does it introduce a second architecture
narrative?"* Ironic, but a useful confirmation that the policy's principles are sound even
though its own content has drifted.

### 2.5 Directory-structure diagram omits real top-level dirs

`db/` (Neon/Catalog migrations, distinct from `supabase/migrations/`) and `infra/` (Pulumi
IaC) both exist at repo root and are absent from CLAUDE.md's "Directory Structure" diagram.
Deciding what belongs in a *curated* map (vs. an exhaustive one) is an editorial call, not
a mechanical fix — hence deferred here rather than silently added in the companion PR.

### 2.6 Duplicate `## Design System` heading in `frontend/AGENTS.md`

Two `## Design System` H2 sections exist in the same file (one with the actual token
values, one that just says "read DESIGN.md"). Low priority, but worth folding into
whatever pass implements this proposal, since it's a two-minute fix once someone's already
editing that file's structure.

### 2.7 Two files with confirmed stale `backend/` paths, deliberately not touched by the mechanical PR

- `.claude/skills/backend-tdd/SKILL.md`, `.claude/skills/e2e/SKILL.md` — skill definitions,
  a different genre of file from CLAUDE.md/AGENTS.md; still reference `backend/tests/...`
  paths that should be `apps/agent/agent/tests/...`.
- `docs/testing-strategy.md` — one illustrative fixture-factory code example uses
  `backend/tests/factories.py` / `from backend.agents.agent_result import ...`. Should
  become `agent/tests/factories.py` / `from agent.agents.agent_result import ...` (paths
  relative to `apps/agent/`, matching how the rest of that doc and CLAUDE.md's own
  "Commands" section already treat paths after `cd apps/agent`).

Neither blocks this proposal, but both should be swept up when this restructuring lands,
since both files exist specifically to be read by an agent before it writes code.

---

## 3. Proposed file tree

```
CLAUDE.md                    # → becomes a thin pointer (see §4 step 2)
AGENTS.md                    # → becomes the canonical root file (renamed from current CLAUDE.md)
docs/
  DOCS_POLICY.md              # refreshed; becomes the ONE source-of-truth table (§4 step 1)
  ARCHITECTURE.md             # unchanged — already a good example of the linked-doc pattern
  testing-strategy.md         # unchanged except the one stale backend/ example (§2.7)
  ops/deployment.md           # unchanged

apps/agent/
  CLAUDE.md                   # NEW: symlink → AGENTS.md
  AGENTS.md                   # NEW: Python-only conventions relocated from root
                               #   (1-10-50 rule, type safety, tool registry table,
                               #    Anitabi/Bangumi API reference, pytest notes)

workers/catalog/
  CLAUDE.md                   # NEW: symlink → AGENTS.md
  AGENTS.md                   # NEW: TS/catalog conventions, consolidating what's split
                               #   today between root CLAUDE.md and packages/contract/README.md
                               #   (oRPC contract rules, error-registry checklist)

frontend/
  CLAUDE.md                   # unchanged — already `@AGENTS.md`, already the correct pattern
  AGENTS.md                   # unchanged content, minus the duplicate heading (§2.6);
                               #   CSS Rules section either stays here or moves to
                               #   .claude/rules/css.md — see step 3 below, this is the
                               #   one open call this proposal does NOT prescribe

.claude/
  rules/                       # NEW directory
    css.md                     # paths: frontend/**/*.tsx, frontend/**/*.css
                               #   (moved from root CLAUDE.md's "CSS Rules" section)
    python-types.md            # paths: apps/agent/**/*.py
                               #   (moved from root CLAUDE.md's "Type Safety" section)
    testing.md                 # unconditional (all stacks) — "Test Quality" section
```

### File responsibilities

| File | Owns | Loads when |
|---|---|---|
| `AGENTS.md` (root) | Repo identity, monorepo map, universal commands (`make check` etc.), cross-cutting guardrails (no `Any`, no suppression, coverage ratchet), harness workflow, skill routing table | every session |
| `CLAUDE.md` (root) | Nothing but `@AGENTS.md` — optionally 1-2 lines of genuinely Claude-Code-only behavior if one ever comes up | every session (imports AGENTS.md) |
| `docs/DOCS_POLICY.md` | The one and only "Single Sources Of Truth" table; the review checklist for doc changes | on demand (linked from AGENTS.md, not loaded every session) |
| `apps/agent/AGENTS.md` | Everything a Python-only task needs and nothing else | only when reading files under `apps/agent/` |
| `workers/catalog/AGENTS.md` | Everything a catalog-worker-only task needs | only when reading files under `workers/catalog/` |
| `frontend/AGENTS.md` | Everything frontend-only (as today) | only when reading files under `frontend/` |
| `.claude/rules/*.md` | Narrow, path-scoped rules that would otherwise bloat root or a package file | only when a matching file is touched |

---

## 4. Migration steps

Ordered so each step is independently safe to stop after, and later steps don't depend on
content that would already be wrong if an earlier step is skipped.

1. **Refresh `docs/DOCS_POLICY.md`.** Fix its stale `backend/`/`worker/worker.js` paths
   (same audit basis as the companion PR). Decide: is this table staying, or is CLAUDE.md's
   "Source Of Truth" section the one that stays and DOCS_POLICY.md's copy gets deleted in
   favor of a link? Recommendation: keep `DOCS_POLICY.md`'s table as the single copy (it
   already has the right shape — topic → source path), and change root AGENTS.md's
   "Source Of Truth" section to a one-line link into it instead of a second table.
2. **Flip the root symlink direction.** Rename current `CLAUDE.md` content to `AGENTS.md`;
   replace `CLAUDE.md` with either `@AGENTS.md` (import, allows future Claude-only
   additions) or `ln -s AGENTS.md CLAUDE.md` (symlink, zero drift risk, matches what
   Anthropic's own docs show as the primary example). Recommend the symlink for the root,
   for consistency with the fact that there's no Claude-specific content planned right now
   — switch to the import form later only if a genuine Claude-only instruction shows up.
3. **Carve out `.claude/rules/css.md` and `.claude/rules/python-types.md`** from root
   AGENTS.md's CSS Rules / Type Safety sections, with `paths:` frontmatter. Verify with
   `/memory` inside a session that they actually load when expected (open a file under
   `frontend/` and confirm `css.md` shows as loaded; open a file under `apps/agent/` and
   confirm `python-types.md` does, and that `css.md` does *not*).
4. **Create `apps/agent/AGENTS.md` + `apps/agent/CLAUDE.md` (symlink).** Move the
   Python-only remainder (tool registry table, Anitabi/Bangumi API reference, pytest notes,
   the 1-10-50 rule if it's meant to be Python-specific — confirm, since today it reads as
   applying repo-wide) out of root. Keep scope discipline (§1.4): nothing about frontend or
   catalog belongs here.
5. **Create `workers/catalog/AGENTS.md` + `workers/catalog/CLAUDE.md` (symlink).**
   Consolidate the catalog-specific conventions currently split between root CLAUDE.md and
   `packages/contract/README.md`'s "Rules" section (import-type-only rule, error-code
   checklist). `packages/contract/README.md` keeps the contract-package-specific detail
   (mirror architecture, parity guard); `workers/catalog/AGENTS.md` covers what someone
   editing catalog code needs that isn't contract-specific.
6. **Re-measure.** Count lines on the new root `AGENTS.md`; confirm it's under ~200. If
   not, look for one more section that's genuinely package-scoped rather than universal.
7. **Fix `frontend/AGENTS.md`'s duplicate `## Design System` heading** (§2.6) while already
   touching agent-facing files in this pass.
8. **Sweep `.claude/skills/backend-tdd/SKILL.md`, `.claude/skills/e2e/SKILL.md`, and the
   one example in `docs/testing-strategy.md`** for the stale `backend/` references noted
   in §2.7.
9. **Add `db/` and `infra/` to the directory-structure diagram** (§2.5) as part of
   whichever step ends up rewriting that diagram anyway (step 4 or 6).
10. **Verify end to end**: start a fresh Claude Code session at repo root, run `/memory`,
    confirm root `AGENTS.md` (via `CLAUDE.md` symlink) loads and nothing else does
    unconditionally; `cd` into `apps/agent/` and read a file, confirm `apps/agent/AGENTS.md`
    and `.claude/rules/python-types.md` both load and `css.md` does not; repeat for
    `frontend/` and `workers/catalog/`.

---

## 5. Explicitly out of scope for this proposal

- **Product domain migration** (`seichijunrei.*` → `animichi.com`) — tracked separately as
  iter-0 #252. Nothing here touches domain references.
- **Breaking type/SDK renames** — `SeichijunreiClient`, `@seichijunrei/contract`. A package
  or class rename is a separate, larger decision with its own blast radius; not bundled
  into a docs-organization change.
- **Rewriting `docs/superpowers/plans/*.md` / `docs/superpowers/specs/*.md`** — these are
  dated, point-in-time artifacts (already good practice per `DOCS_POLICY.md` rule 5:
  "Planning docs may contain process detail; README and architecture docs should not").
  They document decisions *as of* their timestamp and should not be retroactively edited
  to match current reality.
- **Any change to `docs/ARCHITECTURE.md` or `docs/ops/deployment.md` content** — both
  already follow the progressive-disclosure pattern this proposal wants to extend
  elsewhere (linked from CLAUDE.md, not inlined). No changes proposed.

## Sources

- [agents.md](https://agents.md/) — the AGENTS.md spec site (sections, nested-file
  precedent, FAQ)
- [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) — official
  Anthropic docs: CLAUDE.md load order, `@import` syntax, AGENTS.md interop, `.claude/rules/`
  mechanism and `paths:` scoping, size guidance, HTML-comment stripping, `/memory` command
- [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices) —
  official Claude Code best-practices reference (surfaced via search; not directly fetched,
  content direction corroborated by the memory docs above)
- [morphllm.com/agents-md-guide](https://www.morphllm.com/agents-md-guide) — AGENTS.md
  spec guide, monorepo root/subpackage pattern
- [mcsee.medium.com — nested AGENTS.md](https://mcsee.medium.com/ai-coding-tip-014-use-nested-agents-md-files-23031bb0786a)
- [codegateway.dev — AGENTS.md playbook 2026](https://www.codegateway.dev/en/blog/agents-md-playbook-2026) —
  lookup order and monorepo templates
- [agentrulegen.com — agent rules for monorepos](https://www.agentrulegen.com/guides/agent-rules-for-monorepos) —
  scope-discipline warning for nested rule files

---

# v2 (2026-07-07): four follow-up questions

This section deepens the proposal above; it does **not** overturn it. It answers four
questions the v1 draft left open, using a fresh currency audit of the docs the repo actually
points agents at:

- **v2.1 (Q1)** — Are the doc references current? A corrected, single Source-of-Truth table,
  plus a verdict on whether `docs/ARCHITECTURE.md` should be *updated* or *marked superseded*.
  (This **revises one line of §5** — see v2.1.4.)
- **v2.2 (Q2)** — Concrete, drop-in *content drafts* for the root and per-package AGENTS.md
  files that §2.2/§3 only named.
- **v2.3 (Q3)** — Tool-routing: the split between **global** agent config (already in
  `~/.claude/…`, must not be duplicated) and **repo-specific** routing that belongs here.
- **v2.4 (Q4)** — Public skills / generators / practices for building and maintaining these
  files, and an adopt-vs-hand-write verdict.

Everything here remains a **proposal**. No CLAUDE.md/AGENTS.md/DOCS_POLICY.md content is
changed by this PR.

---

## v2.1 (Q1) · Doc references are pointing at stale architecture

### v2.1.1 The drift, confirmed

Two "source of truth" tables exist, and **both point agents at the pre-hybrid, pre-monorepo,
pre-rename world**:

1. **`CLAUDE.md` → "Source Of Truth"** sends *"Detailed architecture → `docs/ARCHITECTURE.md`"*.
   `docs/ARCHITECTURE.md` (undated, but pre-monorepo) describes: the Python agent at
   root-level `agents/…` paths, `worker/worker.js` as the auth layer, and a three-column
   chat frontend — **none of which is current**. The agent moved to `apps/agent/agent/…`; the
   edge worker is now `worker/entry.ts` (+ `app.ts` + `auth.ts`); and the three-column chat
   UI was **deleted** in the 2026-06 cleanup (`frontend/` is homepage-only now, per
   `frontend/AGENTS.md`). It also has **no mention** of the catalog service, the data platform,
   the oRPC contract, Neon, or the Supabase-auth-only split.
2. **`docs/DOCS_POLICY.md` → "Single Sources Of Truth"** is worse: it still lists
   `backend/agents/pilgrimage_runner.py`, `backend/agents/models.py`, and `worker/worker.js` —
   **pre-monorepo *and* pre-rename** paths that no longer resolve (`backend/` → `apps/agent/agent/`).

The genuinely authoritative architecture now lives in two dated specs, in an **authority
layering** the tables don't capture:

- **`docs/superpowers/specs/2026-06-13-architecture-adr.md`** — the foundational ADR: data
  platform as the core, the Catalog-from-Agent split, DB-per-service, and the framework
  picks (Hono / oRPC / Drizzle / AI SDK v5 / Workflows / MapLibre+Protomaps / Evalite /
  Logfire-CF). Its *decision-two* ("全 TS on Workers", i.e. rewrite the agent to TS) was
  **later refined**: the agent stays Python.
- **`docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md`** — the latest and most
  complete current-target doc. **SD-4 / D7 REJECTED the agent TS-rewrite as final** — the
  containerized Python PydanticAI agent is the permanent shape. It adds a third TS service
  (`workers/users`, Neon+Drizzle), the `apps/web` TanStack rebuild, Neon-data/Supabase-auth
  split, and the AI-SDK-UI-message-stream chat protocol.

So the true shape is a **hybrid microservice system**, and *where the two specs conflict on
agent language, the newer one (SD-4/D7) wins.* Neither "source of truth" table says any of this.

### v2.1.2 Corrected, single Source-of-Truth table

This is the merged, current table (paths verified on disk on the PR branch). It is meant to
live in **one** place (see v2.1.5), replacing both drifted copies.

| Topic | Current source of truth | Notes / was |
|---|---|---|
| **Why** the architecture is shaped this way | `docs/superpowers/specs/2026-06-13-architecture-adr.md` | Foundational ADR. Decision-two ("全 TS") refined by SD-4/D7 below |
| **Current target** architecture (hybrid, latest) | `docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md` | Latest; supersedes ADR on agent language; rebuild in progress (iter 0-7) |
| Live agent runtime call-path (reference) | `docs/ARCHITECTURE.md` **(needs refresh — v2.1.3)** + `apps/agent/agent/agents/pilgrimage_runner.py` | Runtime is still Python & live; the doc's *paths* + *frontend* section are stale |
| Agent entry | `apps/agent/agent/interfaces/fastapi_service.py` → `public_api.py` → `agents/pilgrimage_runner.py` | was `backend/interfaces/…` / `agent/interfaces/…` |
| Agent shared types | `apps/agent/agent/agents/models.py`, `…/agent_result.py` | was `backend/agents/…` |
| Agent tools | `apps/agent/agent/agents/pilgrimage_tools.py` | 7 `@agent.tool` regs |
| Catalog service (TS) + data platform | `workers/catalog/src/` — `ingest/` · `enrich/` · `publish/` · `api/` · `router.ts` | realizes the ADR's Ingest→Enrich→Publish |
| Cross-service contract (zod = SoT) | `packages/contract/src/` (`models.ts`, `contract.ts`, `errors.ts`) + `packages/contract/README.md` | error registry + parity guard live here |
| User-domain service | `workers/users/` — **planned, not yet created** (SD-2) | Neon+Drizzle, `/v1/users/*` oRPC |
| Edge worker / auth / routing | `worker/entry.ts` (+ `app.ts`, `auth.ts`) | was `worker/worker.js` |
| Deploy wiring | `wrangler.toml` + `worker/entry.ts` + `docs/ops/deployment.md` | deployment.md = canonical runbook |
| DB — catalog/user data | **Neon** (Drizzle query-only + Hyperdrive); migrations in `db/` (atlas) | SD-3 / D8 data plane |
| DB — auth | **Supabase** (auth-only); migrations in `supabase/migrations/` | SD-3 / D8 |
| Frontend — **current** (homepage-only) | `frontend/` (Next.js OpenNext) + `frontend/AGENTS.md` | chat/search trees deleted 2026-06 |
| Frontend — **rebuild target** | `apps/web/` — **planned, not yet created** (TanStack Start) | spec `2026-07-06-frontend-rebuild-spec.md` |
| Design tokens / system | `frontend/app/globals.css` + `frontend/DESIGN.md`; ref `docs/design/animal-island-ref/` | |
| Eval | `apps/agent/agent/tests/eval/` (Python, current) → Evalite/TS (planned, SD-30) | |
| Testing strategy | `docs/testing-strategy.md` | one stale `backend/` example (§2.7) |
| Deployment ops | `docs/ops/deployment.md`, `docs/ops/cloudflare-hardening.md` | |

### v2.1.3 Verdict: `docs/ARCHITECTURE.md` — **UPDATE, do not mark superseded**

I read `ARCHITECTURE.md` against the ADR and the rebuild spec. It is a **mix**: its
agent-runtime core (RuntimeAPI → runner → `pilgrimage_agent` → tools → `AgentResult`,
the tool table, the response contract) is **still accurate** — the hybrid decision keeps
that runtime in Python. What's stale is (a) every path (monorepo move), (b)
`worker/worker.js` → `worker/entry.ts`, (c) the entire missing hybrid dimension
(catalog / data platform / oRPC / Neon / Supabase-auth-only), and (d) the "Frontend
Architecture" section, which documents the **deleted** three-column chat UI.

**Update, don't supersede**, because:

1. You **cannot** redirect "detailed architecture" to the ADR or the rebuild-spec. Those are
   **dated, point-in-time decision records** — by DOCS_POLICY rule 5 and this proposal's own
   §5, they must not be retroactively edited and will drift *by design*. A living "current
   architecture" doc is a different genre and must always reflect what's running now.
2. The agent-runtime reference content has **no other home** in that form — marking the file
   "superseded" would delete a still-true reference and replace it with nothing.

**Concretely**, the refresh = fix the monorepo paths + `worker/entry.ts`; add a short
"hybrid platform" overview (agent / catalog / users / contract / edge, with the Neon-data
vs Supabase-auth split) that **links** to the ADR (for *why*) and the rebuild-spec (for the
*target*); and replace the "Frontend Architecture" section with a two-line pointer noting the
current frontend is homepage-only and the full UI is being rebuilt in `apps/web` (link the
rebuild-spec). That keeps ARCHITECTURE.md as the one linked-not-inlined "current" doc this
proposal wants everywhere else.

### v2.1.4 This revises §5's ARCHITECTURE.md line

§5 currently lists *"Any change to `docs/ARCHITECTURE.md` … No changes proposed"* on the
grounds that it "already follows the progressive-disclosure pattern." The v2.1 audit shows
that reasoning conflated **"is linked, not inlined"** with **"is accurate."** It is linked
but **stale**. So: keep it linked, but **it needs the content refresh above.** Because a full
rewrite is larger than a docs-*organisation* change, this should be a **scoped follow-up**
(its own PR), and in the meantime the Source-of-Truth table (v2.1.2) points architecture
*depth* at the ADR + rebuild-spec, not only at the stale file.

### v2.1.5 Kill the double table (merge into one)

Aligned with §4 step 1: keep **one** copy of the corrected table — in `docs/DOCS_POLICY.md`
(its topic→path shape already fits) — refresh it to v2.1.2, and change the root file's
"Source Of Truth" section into a **one-line link** into it. This removes the two-tables-that-
drift failure mode DOCS_POLICY.md's own review checklist warns against.

---

## v2.2 (Q2) · Concrete AGENTS.md content drafts

§2.2/§3 named the per-package files; here is **drop-in content** for each, drawn from the
actual repo (real commands, paths, rules). Symlink direction per §2.1/§4 step 2: each
`CLAUDE.md` is a thin pointer (`@AGENTS.md` or `ln -s AGENTS.md CLAUDE.md`); each `AGENTS.md`
is canonical — matching what `frontend/` already does.

### v2.2.1 Root `AGENTS.md` (target < 200 lines)

```markdown
# Animichi — AGENTS.md

Anime pilgrimage search + route planning. **Hybrid microservices**: a Python PydanticAI
agent (FastAPI, Cloudflare container) + TS Cloudflare Workers (catalog, and a planned users
service) + a TanStack web app (rebuild in progress). Data plane = Neon; auth = Supabase.

## Monorepo layout
- `apps/agent/`      — Python PydanticAI agent (FastAPI container). uv. → `apps/agent/AGENTS.md`
- `workers/catalog/` — TS Worker: anime catalog API + data platform (ingest/enrich/publish). → `workers/catalog/AGENTS.md`
- `workers/users/`   — TS Worker: user-domain data (Neon+Drizzle). PLANNED (SD-2).
- `packages/contract/` — Shared oRPC/zod contract (source of truth for cross-service types).
- `frontend/`        — Next.js OpenNext, **homepage-only** (chat/search deleted 2026-06). → `frontend/AGENTS.md`
- `apps/web/`        — TanStack Start rebuild. PLANNED (see rebuild spec).
- `worker/`          — CF edge worker (entry.ts): auth + `/v1` routing + image proxy.
- `db/`              — Neon migrations (atlas). `supabase/migrations/` — auth migrations.
- `infra/`           — Pulumi IaC (R2 binding only for now).

## Package managers
- **pnpm** workspace for all TS (`pnpm-workspace.yaml`). **uv** for Python (in `apps/agent/`).

## Core commands
- `make check`        — lint + typecheck + test. **Run before AND after any change.**
- `make dev-local`    — Supabase + backend + frontend (one command; never start services individually).
- `make test` / `make test-integration` / `make test-eval` / `make e2e`
- Per-package specifics live in that package's AGENTS.md.

## Cross-stack guardrails (apply everywhere)
- **1-10-50**: functions ≤10 lines, classes ≤50, files ≤300; ≤2 indent levels.
- **No suppression without user approval** — no `eslint-disable`/`@ts-ignore`/`type: ignore`/
  `noqa`/`pragma: no cover`/`continue-on-error`/`skip`. Fix the code.
- **Coverage floors ratchet UP only** — frontend lines≥72/stmts≥68/fns≥62/branches≥59; backend≥80.
- **No `Any`** (Python: `object` + `isinstance()`; TS: no `any`). No `dict[str, object]` — model it.
- **No local deploy** — CI/CD only (hook `block-local-deploy`). staging = merge to main; prod = tag `v*`.

## Authoritative docs (read when doing the matching work)
- Architecture WHY → `docs/superpowers/specs/2026-06-13-architecture-adr.md`
- Current TARGET → `docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md`
- Live runtime reference → `docs/ARCHITECTURE.md`
- Deploy runbook → `docs/ops/deployment.md`
- Single Source-of-Truth table + doc rules → `docs/DOCS_POLICY.md`

## Tool routing  (see v2.3 — global vs repo)
- Skill-first: bugs→/investigate · ship/PR→/ship · qa→/qa · review→/review · design system→
  /design-consultation · visual→/design-review · architecture→/plan-eng-review · quality→/health.
- Delegate code-writing / deep investigation to **Codex via `/codex` or `codex:codex-rescue`** —
  NEVER `codex exec --sandbox workspace-write` (hook `block-codex-exec-codewrite` blocks it).
- Web browsing → `/browse` (gstack). Never `mcp__claude-in-chrome__*`.
- TDD: `/backend-tdd` (Python) · `/frontend-tdd` (React).
- This repo has `.codegraph/` — follow the **global** CodeGraph rules (`~/.claude/CLAUDE.md`):
  spawn an Explore agent for exploration; only lightweight `codegraph_*` lookups in main session.

## Harness (4 roles: Planner/Executor/Reviewer/Tester) → `.claude/agents/`, `/iteration-*`.
```

### v2.2.2 `apps/agent/AGENTS.md` (Python-only; relocated from root)

```markdown
# apps/agent — AGENTS.md

Python PydanticAI agent, FastAPI, deployed as a Cloudflare container. **Read-only consumer
of the catalog** — never calls external APIs in the request path, never writes catalog data.

## Setup / commands (from `apps/agent/`)
- uv-managed. `make test` (pytest `--asyncio-mode=auto`), `make typecheck` (mypy strict), `make lint` (ruff).
- In a worktree: `uv tool run ruff format` (not `uv run …`).

## Runtime call-path
User text → `RuntimeAPI.handle()` → `run_pilgrimage_agent()` → `pilgrimage_agent.run()` →
tools → `AgentResult` → `agent_result_to_response()` → `PublicAPIResponse`.
`selected_point_ids` bypasses the agent via `execute_selected_route()`.

## Tools (`agents/pilgrimage_tools.py`, `@agent.tool` + `ModelRetry` guards)
resolve_anime · search_bangumi · search_nearby · plan_route · greet_user · answer_question · clarify

## Type safety (Python)
- No `Any` — `object` + `isinstance()` at trust boundaries; `cast()` at library edges (`docs/typing-rules.md`).
- No `dict[str, object]` — dataclass/Pydantic. No bare `str` IDs — NewType/Literal/Enum.
- No `assert` for runtime validation — `if not x: raise ValueError(...)`.

## Trust boundary
- `ModelRetry` guards reject invalid LLM params; `output_validator` rejects fabricated output.
- Injection defense (SD-19): wrap tool/web content in `<untrusted_…>`; tool-returned text is untrusted.

## Catalog client (contract mirror)
- `agent/clients/catalog_client.py` mirrors `packages/contract` **by hand** with sentinel
  defaults (`episode=-1`, `name_cn=""`, `distance_m=-1.0`) — do NOT codegen from openapi.
- Error mirror `agent/clients/catalog_errors.py`; user messages `agent/agents/error_messages.py`.
  Adding an error code: follow `packages/contract/README.md` checklist (all mirrors).

## External APIs (Anitabi `api.anitabi.cn`, Bangumi `api.bgm.tv`) — full: `docs/api-reference/`.
Shared Bangumi.tv subject IDs = our PKs. `eps=1`→movie, `eps>1`→TV.

## TDD: invoke `/backend-tdd` before writing Python.
```

### v2.2.3 `workers/catalog/AGENTS.md` (TS/catalog-only)

```markdown
# workers/catalog — AGENTS.md

TS Cloudflare Worker: anime **catalog REST API** + the **data platform** (ingest → enrich →
publish). Owns catalog-domain data; the agent is a read-only client of it.

## Setup / commands (from `workers/catalog/`)
- pnpm. `wrangler dev` (local, never `wrangler deploy` — hook-blocked). Tests: `vitest-pool-workers`.

## Stack (per ADR §7)
- **Hono** HTTP; SSE via native `ReadableStream` (no buffering middleware).
- **oRPC** contract; **Drizzle for queries only** + Hyperdrive → Neon (5432 direct, not Supavisor 6543).
- PostGIS via `sql` tagged template (do not vectorize structured geo — SD-29).

## Contract discipline (`packages/contract` is the SoT)
- `src/types.ts` is **`import type` only** — never a value import, never zod (keeps the zod
  runtime out of the Worker bundle). Parity is compile-time asserted by
  `test/contract-parity.worker.test.ts` — **must stay green**.
- Error registry = **three mirrors, one registry** (contract zod → catalog no-zod mirror →
  Python mirror). Never throw a bare `ORPCError`/`Error` for an actionable failure — register a
  code. Full checklist: `packages/contract/README.md`.

## Data platform
- `src/ingest/` (per-work TTL, singleflight via `ingest_jobs` unique constraint — never stampede
  Anitabi) · `src/enrich/` (dedup / clustering / city backfill / attribution) · `src/publish/`.
- Route ordering is unified HERE (`src/lib/route.ts`, haversine × 1.3, SD-28) — the Python
  `route_optimizer.py` is retired.
- Data-quality gate (X15): coordinate validation / dedup / episode completeness / volume-drift.
```

### v2.2.4 `apps/web/AGENTS.md` (write when the rebuild lands; carries over from `frontend/AGENTS.md`)

```markdown
# apps/web — AGENTS.md

TanStack Start, SPA + selective SSR (`/s/:id`, `/anime/:id`), Cloudflare Worker runtime.
Domain animichi.com. (Until this lands, the live frontend is `frontend/` — homepage only.)

## Design system
- Read `DESIGN.md` before any UI work. Tokens in `app/globals.css :root` (semantic `--color-*`
  over `animal-island-ui`'s `--animal-*`). Light theme only, warm cream/brown (動森キャンプ).
- Semantic Tailwind classes (`bg-primary`, `text-foreground`) — never `bg-[var(--color-*)]`,
  never raw hex/`oklch()` in components. New primitives = Radix + tokens (shadcn model).
- (Full CSS ruleset: candidate for `.claude/rules/css.md` with `paths: apps/web/**` — §1.3.)

## Data + auth
- `supabase-js` is **auth-only** — never touches a data table. All data via the public `/v1`
  oRPC surface (catalog + users). No private backdoor (X11).
- Platform capability layer `src/platform/` — product code never calls `navigator.*` directly (X10).

## Generative UI
- App-owned registry (`components/generative/registry.ts`); server sends **semantic payload**,
  app owns rendering. Adding a component = a registry entry only. Payload URLs render only from
  catalog/allowlisted sources (SD-13/C6a).

## Chat: AI SDK v7 `useChat` over the AI-SDK-UI-message-stream protocol (SD-9). i18n = Context+dictionary.

## TDD: invoke `/frontend-tdd` before writing React/TS.
```

---

## v2.3 (Q3) · Tool routing — the global-vs-repo split (the key call)

**Finding:** this repo has **no `.mcp.json`** — every MCP server is configured **globally**
(user config / plugins), not per-repo. And RTK + CodeGraph already live in **two global
files** that load as ancestors for every session in this repo: `~/.claude/CLAUDE.md`
(CodeGraph rules + `@RTK.md`) and `~/CLAUDE.md` (File-org + CodeGraph again). On the `main`
branch, the repo `CLAUDE.md` **also** carries a full `## CodeGraph` block — so CodeGraph is
**triple-stated** (2 global + 1 repo). That is exactly the duplication to remove.

### v2.3.1 GLOBAL — do NOT repeat in repo AGENTS.md

| Thing | Where it already lives | Repo AGENTS.md should say |
|---|---|---|
| **RTK** (Rust Token Killer) — hook-rewritten commands, `rtk gain`, etc. | `~/.claude/RTK.md` (via `~/.claude/CLAUDE.md`) | **nothing** — purely global tooling, no repo-specific angle |
| **CodeGraph** mechanics (Explore-agent rule, lightweight-tools table) | `~/.claude/CLAUDE.md` + `~/CLAUDE.md` | **one line**: "`.codegraph/` is initialized — follow the global CodeGraph rules." |
| File-org / parallel-exec / code-style house rules | `~/CLAUDE.md` | nothing (global) |

**Action:** when consolidating, **delete** the `## CodeGraph` block from the repo file (it
duplicates global). Keep only the one-line "this repo is indexed" pointer.

### v2.3.2 REPO-SPECIFIC — DO write in root AGENTS.md (terse, "when to use X" triggers)

1. **Codex plugin routing** *(new — this is the important one)*. The repo ships a hookify hook
   **`block-codex-exec-codewrite`** (`.claude/hookify.block-codex-exec.local.md`) that hard-blocks
   `codex exec` with a writable sandbox (`--sandbox workspace-write|danger-full-access`). Rule:
   > Delegate code-writing / deep investigation to Codex via **`/codex`** (`use-codex`) or
   > **`codex:codex-rescue`** (Skill, or an Agent `subagent_type="codex:codex-rescue"`), which
   > run the managed app-server runtime. **Never** `codex exec --sandbox workspace-write` (it hits
   > the machine-level concurrency guard → multi-lead false-blocks → hangs; measured 2026-07-07).
   > One-shot image-gen via app-server / read-only sandbox is fine.
2. **Skill routing** — the existing list in root CLAUDE.md is good; keep it (bugs→/investigate,
   ship→/ship, qa→/qa, review→/review, docs→/document-release, retro→/retro,
   design-system→/design-consultation, visual→/design-review, architecture→/plan-eng-review,
   quality→/health, brainstorm→/office-hours) **plus** `/codex` (item 1) and the two `*-tdd` skills.
3. **MCP servers — only the ones tied to THIS repo's infra** (one-line "when"). Skip the generic
   global plugins (chrome-devtools, claude-mem, computer-use, microsandbox, sentrux) — they're not
   repo-specific.

   | Server | Use it for |
   |---|---|
   | `supabase-seichijunrei` | Auth/Supabase project ops — `list_tables`, `get_logs`, `get_advisors`, edge functions, `apply_migration` (remote). Start here to debug auth/DB. |
   | Neon (`mcp__Neon__*`) | The **data plane** (catalog/user tables, Drizzle). Branch/query Neon. |
   | Cloudflare (`cloudflare-*`) | Workers/Wrangler docs, bindings, build + observability for the edge/catalog. |
   | context7 | Up-to-date library docs for the exact stack (Hono, Drizzle, oRPC, AI SDK v5/v7, TanStack Start, pydantic-ai). Prefer over memory. |
   | serena | LSP-backed semantic code nav/edits when codegraph isn't enough. |
   | logfire | Observability (the ADR's obs stack; agent + Workers share the Logfire dashboard). |
4. **gstack** — `/browse` for all web browsing; never `mcp__claude-in-chrome__*`. (Already present.)

### v2.3.3 Placement

Per progressive disclosure (§1.5): these are **every-session relevant**, so they belong in the
**root** AGENTS.md — but as **one-line triggers**, not inlined tool manuals. The global files
carry the "how"; the repo file carries "for *this* stack, reach for X when Y." Net effect vs.
today: **−1 duplicated CodeGraph block, +1 Codex-routing rule, +1 scoped MCP-when-to-use table.**

---

## v2.4 (Q4) · Public skills / generators / practices — adopt or hand-write?

I surveyed the 2026 ecosystem for tools that *build* and *maintain* AGENTS.md/CLAUDE.md. It
splits into four categories, and only two are worth adopting here.

### v2.4.1 Generators / scaffolders

| Tool | What it is | Verdict for this repo |
|---|---|---|
| **Claude Code `/init`** (built-in) | Scans code, generates a starter CLAUDE.md; **reads existing** CLAUDE.md/AGENTS.md/`.cursorrules` and folds them in ("suggests improvements rather than overwriting"); re-runnable. New multi-phase mode behind `CLAUDE_CODE_NEW_INIT=1` (asks which artifacts, explores via subagent, shows a reviewable proposal). | **ADOPT as the bootstrapper.** Run it *per package* to seed the nested files this proposal wants (`apps/agent/`, `workers/catalog/`, `apps/web/`), then hand-trim to <200 lines. It's the only generator that natively respects existing files + AGENTS.md + nesting. |
| **agentrulegen.com** (Agent Rules Builder) | Browser one-shot; pick language/framework, export CLAUDE.md/AGENTS.md/`.cursorrules`/etc. | **SKIP.** Root-only (no monorepo/nested model), no re-generation, generic community boilerplate. Nothing `/init` doesn't do better against your real code. |

### v2.4.2 Rules-**sync** tools (one source → many tool formats)

`rulesync` (https://github.com/dyoshikawa/rulesync — best-in-class, v9.2.0, ~1.2k★, very
active), `aicm`, `ai-nexus`, `ai-rules-sync`. All maintain **one** rules source and generate
`CLAUDE.md` + `AGENTS.md` + `.cursorrules` + `copilot-instructions.md` + Windsurf/Cline/Codex…

**Verdict: SKIP (for now).** Their entire value is *fan-out to multiple agent tools*. This
harness is Claude-Code-centric (rich CLAUDE.md, `.claude/agents/`, skills). Adopting one adds a
`.rulesync/` build layer + indirection to solve a multi-tool problem you don't have — and Claude
Code's own `@import` + `.claude/rules/` + user-scope already give single-source-of-truth *within*
your toolchain. Notably, `ai-nexus`'s headline feature ("semantic routing into `.claude/rules/`")
is now a **native** Claude Code mechanism (§1.3), so it's redundant here. **Revisit `rulesync`
only if a second agent tool (Cursor/Copilot/Codex-as-primary) ever joins the workflow.**

### v2.4.3 The AGENTS.md standard + monorepo playbook

- **agents.md** (Linux Foundation / Agentic AI Foundation): plain Markdown, **no required
  schema, no official linter/validator**. Nested-file convention is **official and explicit**:
  *"Place another AGENTS.md inside each package … agents read the nearest file, closest wins."*
  The **"OpenAI's own monorepo has 88 AGENTS.md files"** claim is **verified** on the agents.md
  homepage FAQ (and OpenAI's Codex guide). → **This proposal's thin-root + nested plan is the
  sanctioned pattern.** There is simply no official tooling to install for it.
- Community playbooks all converge on the same "thin root + nested, nearest-wins" shape
  (Augment, morphllm, blakecrosley, mcsee). Rule *content* packs worth borrowing structure from:
  `mattpocock/agent-rules-books`. → **Adopt the pattern; hand-shape the nesting** (no template
  fits a pnpm+uv+Workers+Next.js layout out of the box).

### v2.4.4 Tool-routing conventions (validates Q3)

The ecosystem answer to "how do I document *which tool when*" is **not** a hand-written prose
table — it's the structured, on-demand primitives, and Anthropic's own docs say so:

- **`.claude/rules/*.md` + `paths:` frontmatter** for path-scoped rules (exactly §1.3).
- **Skills carry procedures + "when to use"** in their *description* (progressive disclosure:
  frontmatter ~100 tokens always-on → body on-demand → `references/` only-when-needed). Anthropic:
  *"MCP connects Claude to data; Skills teach Claude what to do with it"* — so an MCP server's
  *existence* is config, but *when to use it* belongs in a skill/description, and only a **thin
  tool index** belongs in CLAUDE.md.
- **Global-vs-repo is solved natively, zero tools**: cross-project tooling goes in
  `~/.claude/CLAUDE.md` / `~/.claude/rules/` **once** (loads in every repo); `@path` imports
  reference-not-duplicate; `claudeMdExcludes` skips foreign packages. → **This is precisely the
  Q3 (v2.3) conclusion, and it's the documented Anthropic way** — our "don't re-state RTK/CodeGraph
  in the repo file" instinct is the official pattern, not a preference.

### v2.4.5 Drift / maintenance linters — the one net-new adoption

The standard ships no validator, but a small third-party category exists, and it targets
**exactly the failure modes this whole proposal + its companion PR fixed by hand**:

| Tool | Coverage | Integration |
|---|---|---|
| **ctxlint** (YawLabs) | ~39 rules: **stale path validation**, **command validation** (vs package.json/Makefile), staleness, **token-budget** analysis, **redundancy/contradiction** across files, secret detection, CI-coverage audit; supports CLAUDE.md + `.claude/rules/` + AGENTS.md | `npx @yawlabs/ctxlint`, **GitHub Action** `yawlabs/ctxlint-action@v1`, **pre-commit**, watch, MCP |
| **agents-lint** (giacomo) | zero-dep; stale filesystem paths, dead npm scripts, deprecated deps, over/undersized files, cross-file conflicts | CLI; designed to run **weekly in CI** |

**Verdict: ADOPT `ctxlint` in CI + pre-commit** (pinned — it's young, ~7★). It would have
*mechanically* caught every hand-found defect behind this effort: the stale `backend/`/
`worker/worker.js` paths (companion PR), the dead links, the **273-line over-budget root**
(§2.3), the **duplicated CodeGraph block** (v2.3), and the two drifted Source-of-Truth tables
(v2.1). Wiring it in closes the loop so this class of rot can't silently return. `agents-lint`
on a weekly schedule is the lighter zero-dep alternative if a pre-commit gate feels heavy.

### v2.4.6 Anthropic's maintenance loop (adopt the habits, they're free)

`/init` to bootstrap → **`#`** mid-session to append a learned rule to the right memory file →
**`/memory`** to list every loaded file and prune redundant ones → auto-memory
(`~/.claude/projects/<repo>/memory/MEMORY.md`) complements but must **not duplicate** CLAUDE.md.
Anthropic's explicit stance: *"Think of `/init` as a starting point, not a finished product… keep
it concise"* and *review nested CLAUDE.md/`.claude/rules/` periodically to remove stale/conflicting
instructions.* → **Bootstrap with a tool, maintain by hand + linter. No generator owns these files.**

### v2.4.7 Bottom line (Q4)

**Hand-author using Claude Code's native primitives; do not adopt a rules-sync generator; add
exactly one drift linter to CI.** The build side is a one-time `/init`-per-package bootstrap; the
maintain side is `.claude/rules/` + skills + `@import`/user-scope (all native, all already in this
proposal) + `ctxlint` in CI. The only *new* recommendation Q4 adds to this proposal is **ctxlint**
— everything else the ecosystem endorses, this proposal was already going to do by hand.

> **One open call for the user:** adding `ctxlint` to CI/pre-commit is a genuinely new tool
> dependency (young project, pin the version) — include it in the implementation follow-up, or
> leave it out and rely on periodic `/memory` review? My recommendation: include it, pinned, as a
> **non-blocking** CI check first (warn, don't fail) until it's proven on this repo's layout.

---

## v2 Sources

**Anthropic / Claude Code (official):**
- https://code.claude.com/docs/en/memory — load order, `@import`, `ln -s AGENTS.md CLAUDE.md`,
  `.claude/rules/` + `paths:`, `claudeMdExcludes`, `#`/`/memory`, <200-line + periodic-review guidance
- https://code.claude.com/docs/en/commands — `/init` (reads existing AGENTS.md; `CLAUDE_CODE_NEW_INIT=1`)
- https://claude.com/blog/using-claude-md-files — "starting point, not finished product"; tool index guidance
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills — progressive disclosure
- https://claude.com/blog/extending-claude-capabilities-with-skills-mcp-servers · https://claude.com/blog/skills-explained — "MCP = data, Skills = what to do with it"

**AGENTS.md standard + monorepo pattern:**
- https://agents.md/ (nested convention + verified "OpenAI 88 AGENTS.md files") ·
  https://aaif.io/projects/agents-md/ · https://github.com/agentsmd/agents.md/issues/53 (precedence) ·
  https://developers.openai.com/codex/guides/agents-md
- Playbooks: https://www.augmentcode.com/guides/how-to-build-agents-md ·
  https://www.morphllm.com/agents-md-guide · https://blakecrosley.com/blog/agents-md-patterns ·
  https://github.com/mattpocock/agent-rules-books

**Generators / sync (surveyed, mostly SKIP):**
- https://code.claude.com/docs/en/commands (`/init`) · https://www.agentrulegen.com/ ·
  https://github.com/dyoshikawa/rulesync · https://www.npmjs.com/package/aicm ·
  https://github.com/JSK9999/ai-nexus · https://github.com/PanisHandsome/ai-rules-sync

**Drift linters (ADOPT one — ctxlint):**
- https://github.com/YawLabs/ctxlint (+ Action `yawlabs/ctxlint-action@v1`) ·
  https://github.com/giacomo/agents-lint · https://github.com/felixgeelhaar/cclint ·
  https://fiberplane.com/blog/drift-documentation-linter/

*Reliability caveats:* the drift linters are young (single-/low-double-digit ★) — useful but pin
versions, don't treat pass/fail as authoritative; a few "v1.1 frontmatter"/section-count claims
come from secondary guides, not the agents.md spec page — treat as directional.
