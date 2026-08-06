# generated/ — generator output staging area

The second stage of the three-stage E2E promotion gate. The `playwright-test-generator`
agent (`.opencode/prompts/playwright-test-generator.md`) turns human-approved plans from
`../agent-discovered/` into executable specs here as `*.spec.ts`.

This directory is a **working directory, not part of the test suite**:

- `playwright.config.ts` ignores `generated/**` (`testIgnore`), so in-progress
  generated specs never run (or break) the committed suite.
- The CI guard `.github/scripts/check-e2e-promotion.sh` fails the build if any
  `*.spec.ts` is committed under this directory.

## Pipeline

```
agent-discovered/*.md (approved by human)
        │
        v
generator (playwright-test-generator) ──> generated/<scenario-name>.spec.ts
        │
        v
healer (LOCAL ONLY, never auto-commits) ──> fixes in working tree
        │
        v
promotion: git mv generated/<name>.spec.ts <name>.spec.ts
```

## Promotion requirements (all four)

A generated spec may be promoted into the `e2e/` root — the committed, always-run
suite — only when **all** of these hold (see `../agent-discovered/README.md` for the
full gate description):

1. **Two consecutive green runs** — no flakes across two full suite runs.
2. **Mutation check** — break the feature; the spec must fail.
3. **Human locator read** — every locator human-verified.
4. **No timing-based asserts** — auto-waiting assertions only, no
   `waitForTimeout`/`sleep`/fixed-timing expectations.

## House rules

- One spec per scenario; fs-friendly scenario name (`generated/<name>.spec.ts`).
- First line of each generated spec records provenance:
  `// spec: agent-discovered/<plan>.md` and `// seed: seed.spec.ts`.
- Fixes by the healer stay uncommitted until a human reviews and commits them.
- `seed.spec.ts` lives at the `e2e/` root (the Playwright MCP server locates seeds
  there), NOT in this directory. It is a zero-assertion scaffold, not a test, so
  it must never count as a case in the always-run suite: the default
  `npx playwright test` run is exactly **36 tests in 9 files**, and a silent
  36→37 drift is the failure mode this gate exists to prevent. Isolation
   mechanism (see `../playwright.config.ts`): the seed has its own `seed` project
   that exists only in the MCP server process (`npx playwright
   run-test-mcp-server`) — the CLI test runner never sees it, and the `chromium`
   project `testIgnore`s it. A project-level `testIgnore` **replaces** the
   top-level one (it does not merge), so the `chromium` project carries the full
   union — `generated/**`, `agent-discovered/**`, and `seed.spec.ts` — otherwise
   the working-dir protection would silently drop for the default run. The MCP
   server seeds from the first top-level
  project, so the `seed` project sits first in the config, and the flag is
  propagated to worker processes via the `E2E_SEED_PROJECT` environment
  variable (workers re-require the config with a different argv).
