# agent-discovered/ — planner staging area (human-reviewed)

The first stage of the three-stage E2E promotion gate. The `playwright-test-planner`
agent (`.opencode/prompts/playwright-test-planner.md`) discovers flows against a
**staging** deployment and writes its test plans here as `*.md`.

This directory is a **working directory, not part of the test suite**:

- `playwright.config.ts` ignores `agent-discovered/**` (`testIgnore`), so plan
  markdown can never be picked up as a spec by the `*.spec.ts` glob.
- The CI guard `.github/scripts/check-e2e-promotion.sh` fails the build if any
  `*.spec.ts` is committed under this directory.

## The three-stage gate

```
planner ──> agent-discovered/*.md ──> human review ──> generator ──> generated/*.spec.ts
    1                │                                       │              2
                     └──────────── <─ iterate ───────────────┘
                                                        │
                                                        v  promotion (git mv into e2e/ root)
                                               e2e/*.spec.ts
                                                        │
                                                        3  four promotion checks (see below)
```

1. **Planner** writes `agent-discovered/*.md` plans (human-readable, staged). Plans
   are **human-reviewed before generation** — a plan is not a test.
2. **Generator** (`playwright-test-generator`) turns an approved plan into
   `generated/*.spec.ts`. Generated specs may be imperfect; the healer fixes them
   locally.
3. **Promotion** into the `e2e/` root (where the committed suite runs) requires **all
   four** checks:

   - **Two consecutive green runs** — the spec passes two full suite runs back to
     back with no flakes.
   - **Mutation check** — deliberately break the feature under test; the spec must
     go red (proves it asserts the feature, not just that the page loads).
   - **Human locator read** — a human reads every locator and confirms it targets
     the intended element (no brittle role/order guesses).
   - **No timing-based asserts** — no `waitForTimeout`, `sleep`, fixed `expect` on
     wall-clock timing; assertions must be auto-waiting Playwright conditions.

   Promotion is literally `git mv generated/<name>.spec.ts <name>.spec.ts` — a
   reviewed, committed move, never a copy-paste that skips review.

## Roles

- **Healer** (`playwright-test-healer`) runs **LOCAL ONLY** — it debugs generated
  specs against the local stack (`make dev-local` + `make e2e-setup`). It **never
  auto-commits**: fixes are left in the working tree for a human to review and
  commit.
- The **planner is not run in CI** and is not run by this card's pipeline until the
  gate-token wiring (step-6 card) exists. Planner runs happen on demand, against
  staging, and always land here first.

## House rules

- One file per feature/flow; name `<feature>-plan.md`.
- Plans must assume a blank/fresh starting state and list independent scenarios.
- Never `git add` a plan without an accompanying review note in the PR.
- The default `npx playwright test` run is exactly **36 tests in 9 files** (the
  committed suite). `seed.spec.ts` and anything in `generated/` or
  `agent-discovered/` never count toward that number — the seed is isolated
  behind a `seed` project that exists only in the Playwright MCP server process,
  and the `chromium` project `testIgnore`s the full union (`generated/**`,
  `agent-discovered/**`, `seed.spec.ts`) because a project-level `testIgnore`
  replaces the top-level one rather than merging with it
  (`playwright.config.ts` + `generated/README.md` explain the mechanism). If the
  default count changes, the suite gained or lost a case without going through
  the promotion gate — stop and review.
