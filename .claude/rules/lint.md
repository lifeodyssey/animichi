---
paths:
  - "workers/**/*.ts"
  - "apps/web/**/*.ts"
  - "apps/web/**/*.tsx"
  - "packages/**/*.ts"
---
# TypeScript lint rules (live packages)

- Gate with each package's `pnpm run lint`, the script CI's affected matrix and pre-push run:
  type-aware oxlint with `--deny-warnings`, called directly (`packages/pi-session-neon`,
  `packages/prisma-geography`) or through the package's `lint:oxlint` (every other package).
  TypeScript 7. ESLint is not a live-package gate.
- Root `.oxlintrc.json` owns the strict shared rules; package `.oxlintrc.json` files extend it and
  list generated/build artifacts to ignore.
- `apps/web` production functions are capped at 10 lines; its `tests/**/*.ts(x)` override restores
  the shared 50-line test budget. `routeTree.gen.ts` is generated and ignored.
- No `eslint-disable`, `@ts-ignore`, or rule downgrades without user approval. Fix the violation.
- An approved oxlint exception follows "An approved exception to a rule" in
  `docs/agents/code-standards.md`: the rule is switched off only for the named files or directory
  in that package's `.oxlintrc.json`, with the reason, the upstream issue and the expiry beside it.
