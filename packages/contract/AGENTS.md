# packages/contract — AGENTS.md

Shared oRPC/Zod contract and single source of truth for catalog/users wire types. The catalog
Worker and Python agent keep deliberate hand-mirrors where bundling or sentinel defaults require
them. Root guide: `../../AGENTS.md`; detailed mirror checklist: `README.md`.

## Commands (from `packages/contract/`)

- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- `pnpm run emit:openapi` — regenerate `openapi.json` and `users-openapi.json`.

OpenAPI emission is byte-stable: JSON is pretty-printed with one trailing newline. Regenerate on
every contract change and commit both outputs. CI reruns emission and fails on committed drift.

## Conventions

- Zod schemas and oRPC contracts live in `src/`; export public types through `src/index.ts`.
- `zod@4.4.3` and `@orpc/*@1.14.8` are one coupled exact-pin set across this package,
  `workers/catalog`, and `workers/users`. Change them together.
- Catalog internals use type-only hand-mirrors so Zod stays out of the Worker bundle; Python models
  remain hand-written because their sentinel defaults intentionally differ.
- Semantic contract freeze is the red line: do not change wire meaning without an approved story.
  Formatting churn is acceptable only when the OpenAPI drift check stays green.

## Key files + entrypoints

- `src/models.ts` — shared Zod data models.
- `src/contract.ts` — catalog procedures and error attachments.
- `src/users-contract.ts` — users-service procedures and errors.
- `src/errors.ts` — canonical catalog error registry.
- `scripts/emit-openapi.ts` — deterministic OpenAPI emitter.
- `openapi.json` · `users-openapi.json` — committed generated wire artifacts.

## Pitfalls

- Catalog errors move in three-mirror lockstep:
  `src/errors.ts` ↔ `workers/catalog/src/lib/errors.ts` ↔
  `apps/agent/agent/clients/catalog_errors.py`.
- Extend `workers/catalog/test/contract-parity.worker.test.ts` and the Python error tests with any
  mirror change; do not rely on OpenAPI generation alone.
- Do not introduce runtime value imports into the catalog's type mirror.
