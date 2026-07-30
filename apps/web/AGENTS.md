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

## API layer (`src/api/`)

- Transport is oRPC `OpenAPILink` (the catalog/users Workers run `OpenAPIHandler`, not RPC).
  `clients.ts` exposes separate `createCatalogClient` / `createUsersClient` factories — each has its
  own base URL and forwards cookie/`Authorization` headers from the per-call `ApiClientContext`.
- `orpc.ts` wraps clients in `@orpc/tanstack-query` utils with disjoint key prefixes
  (`["catalog", …]` / `["users", …]`); consume them via query hooks in `src/api/hooks/` — UI never
  touches the transport directly (dependency points inward: component → hook → client).
- `config.ts` resolves per-service base URLs and the SSR absolute origin (`VITE_SITE_ORIGIN` on the
  server, `location.origin` in the browser). `query-client.ts` builds a fresh `QueryClient`; `getRouter`
  creates one per request and `routerWithQueryClient` wires dehydrate/hydrate (no cross-request leak,
  no double fetch).
- MSW has three swimlanes (`tests/msw/`): `node.ts` (`setupServer`, component/loader unit tests),
  `browser.ts` (`setupWorker`, client-navigation tests). SSR is deliberately NOT covered by MSW —
  it is validated against a real local Worker + backend at the G1 gate. Handlers never hand-write
  JSON: `contract-handler.ts` `parse()`s requests and responses against the `@animichi/contract`
  zod schemas and builds oRPC-typed error envelopes.

## Key files + entrypoints

- `src/routes/__root.tsx` — document shell, metadata, error/not-found wiring.
- `src/routes/index.tsx` → `src/components/Landing.tsx` — current homepage.
- `src/components/NotFound.tsx` — branded 404.
- `src/router.tsx` — TanStack router factory.
- `vite.config.ts` — TanStack Start/Nitro/React build composition.
- `wrangler.jsonc` — `.output/server/index.mjs` Worker entry + static asset binding.
- `tests/unit/` · `tests/integration/build-output.test.ts` — unit and emitted-bundle contracts.

## Pitfalls

- `src/routeTree.gen.ts` is generated. Do not hand-edit it; oxlint and coverage ignore it. The unit
  pool runs without the TanStack Start vite plugin, so `tests/setup/generate-route-tree.ts`
  (vitest `globalSetup`) emits it before the suite; a normal build regenerates it otherwise.
- Coverage sweeps `src/**` (routes + `router.tsx` included, per campaign plan §0.6); the enforced
  floor is `statements 95 / branches 94 / functions 95 / lines 95`, read from `vitest.config.ts`,
  which is the authority — ratchet UP only. `routeTree.gen.ts` is the only exclusion (plus the
  WebGL map glue listed in the config's exclude ledger).
- `OpenAPILink` captures `globalThis.fetch` at construction: build clients at call time (the lazy
  `catalog()` / `users()` singletons do), not at module top, or MSW patching is missed in tests.
- A normal build must run before preview or build-output integration checks inspect `.output/`.
- Root lint strictness applies here; do not copy the frozen `frontend/` ESLint setup.
