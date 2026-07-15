# apps/web — AGENTS.md

TanStack Start app replacing the retired Next.js frontend at cutover. It currently serves the
landing page and branded 404 through a Cloudflare SSR bundle. Root guide: `../../AGENTS.md`.

## Commands (from `apps/web/`)

- `pnpm run dev` — Vite dev server.
- `pnpm run build` — Vite/Nitro Cloudflare build; emits `.output/server/index.mjs` + public assets.
- `pnpm test` — Vitest unit suite with Istanbul coverage.
- `pnpm run test:integration` — build-output and Wrangler dry-run integration checks.
- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- `pnpm run lint:oxlint` — type-aware oxlint with warnings denied.
- `pnpm run preview` — `wrangler dev` against the built `.output` entry.

## Conventions

- TanStack file routes live in `src/routes/`; create the router in `src/router.tsx`.
- Keep production functions at ≤10 lines and tests at ≤50. `apps/web/.oxlintrc.json` owns both
  limits and extends the root strict, type-aware config.
- Use semantic tokens from `src/styles/globals.css`; alignment tests pin the Animal Island token
  layer.
- Keep legacy and rebuild E2E origins separate until cutover: `E2E_WEB_BASE_URL` targets this app.

## Key files + entrypoints

- `src/routes/__root.tsx` — document shell, metadata, error/not-found wiring.
- `src/routes/index.tsx` → `src/components/Landing.tsx` — current homepage.
- `src/components/NotFound.tsx` — branded 404.
- `src/router.tsx` — TanStack router factory.
- `vite.config.ts` — TanStack Start/Nitro/React build composition.
- `wrangler.jsonc` — `.output/server/index.mjs` Worker entry + static asset binding.
- `tests/unit/` · `tests/integration/build-output.test.ts` — unit and emitted-bundle contracts.

## Pitfalls

- `src/routeTree.gen.ts` is generated. Do not hand-edit it; oxlint and unit coverage ignore it.
- A normal build must run before preview or build-output integration checks inspect `.output/`.
- Root lint strictness applies here; do not copy the frozen `frontend/` ESLint setup.
