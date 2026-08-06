# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — index of per-package glossaries.
- The **`CONTEXT.md`** files the map points at for the packages you are touching (created lazily by `/domain-modeling` / `/grill-with-docs`).
- **`docs/adr/`** — system-wide architectural decisions.
- Package guides: each package's `AGENTS.md` (conventions and commands; not a glossary).
- Live runtime story: `docs/ARCHITECTURE.md`. Policy: `docs/DOCS_POLICY.md`. Workflow: `docs/workflow.md`.

If a `CONTEXT.md` does not exist yet, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill creates glossary files lazily when terms or decisions actually get resolved.

## File structure (this monorepo)

Multi-context — one glossary per deployable / shared package:

```
/
├── CONTEXT-MAP.md                 ← index (always present after setup)
├── docs/adr/                      ← system-wide ADRs
├── docs/agents/                   ← skill config (this file, issue-tracker, labels)
├── apps/agent/CONTEXT.md          ← lazy
├── apps/web/CONTEXT.md            ← lazy
├── workers/edge/CONTEXT.md        ← lazy (package guide may still be missing)
├── workers/catalog/CONTEXT.md     ← lazy
├── workers/users/CONTEXT.md       ← lazy
├── workers/maintenance/CONTEXT.md ← lazy
├── packages/contract/CONTEXT.md   ← lazy
├── db/CONTEXT.md                  ← lazy
├── infra/CONTEXT.md               ← lazy
└── e2e/CONTEXT.md                 ← lazy
```

Do **not** put package ADRs under a fictional `src/<context>/docs/adr/` tree — this repo uses package roots (`apps/*`, `workers/*`, …) and a single `docs/adr/` for cross-cutting decisions. Package-local irreversible decisions can live next to that package as `docs/adr/` only if a future effort deliberately splits them; until then keep system ADRs in `docs/adr/`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (map stack) — but worth reopening because…_
