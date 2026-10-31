---
paths:
  - "workers/**/*.ts"
  - "apps/web/**/*.ts"
  - "apps/web/**/*.tsx"
  - "packages/**/*.ts"
---
# TypeScript lint rules (live packages)

- Gate with each package's `pnpm run lint:oxlint`: type-aware oxlint, `--deny-warnings`, TypeScript
  7.0.2. ESLint is not a live-package gate.
- Root `.oxlintrc.json` owns the strict shared rules; package `.oxlintrc.json` files extend it and
  list generated/build artifacts to ignore.
- `apps/web` production functions are capped at 10 lines; its `tests/**/*.ts(x)` override restores
  the shared 50-line test budget. `routeTree.gen.ts` is generated and ignored.
- No `eslint-disable`, `@ts-ignore`, or rule downgrades without user approval. Fix the violation.
- Find the cause before asking to relax a rule (a lint pass that peaked at 4.3 GB per file was
  investigated first, owner, 2026-10-15). An approved exception is scoped to the named files or
  directory, and the config states the reason, the upstream issue and, where there is one, the
  expiry; it is deleted when upstream fixes the cause.
