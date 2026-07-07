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
