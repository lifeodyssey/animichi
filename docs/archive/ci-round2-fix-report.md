# CI Round 2 Fix Report

## Fix 1: zizmor cache-poisoning (deploy.yml:27)

- `actions/setup-node` enables pnpm caching by default even with no `cache:` input
- Added `cache: ""` to disable caching + per-finding `# zizmor: ignore[cache-poisoning]` inline comment
- Justification: deploy.yml is `workflow_dispatch` only — no untrusted code can trigger it
- Fix 2: bot-conditions (dependabot-agent.yml:17): changed `github.triggering_actor` to `github.event.pull_request.user.login` (zizmor safe auto-fix — event payload not spoofable by fork PRs)
- Result: `31 findings (1 ignored, 22 suppressed): 0 error-level`

## Fix 2: Frontend vitest (css-package-entrypoint + jsx-dev-runtime)

- (a) `animal-island-ui/dist/core.css` not in package exports map → changed to `animal-island-ui/style/core`; `dist/index.css` → `animal-island-ui/style` (correct export keys)
- (b) Vite 8 + rolldown fails to resolve `react/jsx-dev-runtime` from JSX-transformed test files — removed explicit react aliases in `vitest.config.ts`, added `react`, `react-dom`, `/^react\/.+/` to `server.deps.inline` (loads via Node CJS resolver, bypassing Vite module analysis)
- Result: `PASS (165) FAIL (0)` — all 18 test files pass after clean install

## Fix 3: Catalog vitest-pool-workers (503 test + assertTypes)

- (a) `worker.worker.test.ts` 503 test used `env` from `cloudflare:workers` which includes `.dev.vars` DATABASE_URL — changed to pass explicit `noDbEnv = { ENVIRONMENT }` with no DATABASE_URL
- (b) `@vitest/expect@3.2.4` (from storybook) hoisted to root by pnpm; workerd loads it and fails because `@vitest/utils@4.1.9` root has empty exports — added pnpm overrides `"@vitest/expect": "4.1.9"` and `"@vitest/spy": "4.1.9"` in root package.json; also upgraded pool-workers to 0.16.19
- Result: `11 passed, 93 tests, coverage 76%+` — all thresholds met (≥60%)

## Clean Install Verification

All three checks confirmed passing after `rm -rf node_modules frontend/node_modules workers/catalog/node_modules && pnpm install` with Node 24.
