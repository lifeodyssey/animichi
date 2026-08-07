# FIX ROUND: Edge #867 lint — root cause is tsconfig include, not Cache cast

## Diagnosis (verified)
`workers/edge/tsconfig.json` currently has:
```json
"include": ["*.ts"]
```
Concern folders (`proxy/`, `identity/`, `gateway/`, `protect/`, `container/`) are **outside** the TS program. Type-aware oxlint then types `caches.default` as TypeScript `error` in `proxy/image-proxy.ts` → no-unsafe-*.

## Required edits
1. **Edit only** `workers/edge/tsconfig.json` — change include to:
```json
"include": ["*.ts", "identity/**/*.ts", "gateway/**/*.ts", "protect/**/*.ts", "proxy/**/*.ts", "container/**/*.ts"]
```
Keep all other compilerOptions unchanged.

2. Keep (or restore if missing) the typed cache locals in `workers/edge/proxy/image-proxy.ts`:
```ts
  const cache: Cache = caches.default;
  const cached: Response | undefined = await cache.match(cacheKey);
  if (cached) return cached;
  const response = await imageResponse(imagePath);
  if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
```
Behavior must stay identical.

3. Do **not** touch other packages, workflows, or import rewrites.

## Verify (must show exit 0)
```bash
cd workers/edge && pnpm run lint:oxlint
cd workers/edge && pnpm run typecheck
```
Expected: `Found 0 warnings and 0 errors`.

## Constraints
Write/Edit tools only. No git. No commit. No oxlint-disable / any / @ts-ignore.
