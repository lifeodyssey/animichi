---
paths:
  - ".github/workflows/**"
---
# GitHub Actions authoring rules

- **Layering**: reusable composites are `reusable-*.yml`; the top-level `ci.yml` / `deploy.yml` are the callers
  that route the reusables per changed package (path filters). Shared logic goes in a `reusable-*` file, not
  copy-paste. (`codeql.yml` / `dependabot-agent.yml` are standalone top-level workflows.)
- **Pin every third-party action by full 40-char commit SHA** + a trailing `# vX.Y.Z`. Never a floating
  tag/branch.
- **Run `actionlint` on touched workflow files** (`/opt/homebrew/bin/actionlint`) and verify
  reusable-workflow input/secret contracts before claiming CI syntax is valid.
- **Any change under `.github/workflows/` must run `pnpm run test:worker` before merge** — the
  edge test suite (`workers/edge/*.test.ts`) contains guard tests that assert on workflow file
  contents (secret lists, JWKS mappings, migration boundaries); actionlint alone cannot catch
  breaking them. Lesson: #751 merged green on 5 gates and still broke `main`'s worker tests.
- **Warn-only gates use `continue-on-error: true` deliberately** (e.g. the `agnix` agent-config lint) —
  a sanctioned exception, NOT a code-quality suppression. Real gates (lint / typecheck / test /
  coverage / security) stay blocking.
- **Least privilege**: explicit `permissions:` (default `contents: read`); widen per-job only.
- Staging deploys after green `main`; production runs through `ci.yml` after staging or manual
  `deploy.yml`. Both production paths use the GitHub `production` environment approval.
