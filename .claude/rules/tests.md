---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/test/**"
  - "**/tests/**"
  - "e2e/**"
---
# Test authoring rules

The owner's testing rules are in `AGENTS.md`; the strategy is `docs/testing-strategy.md`;
workflow-test placement is in `.claude/rules/ci.md`.

- **Name a test by its system under test.** "contract" is not a bucket (owner, 2026-09-10: "测
  action 的东西就不应该放在 contract，你要明白 SUT"). A test of `cd.yml` is that workflow's test; a test
  of repository configuration lives in `test/repo-config/`; a test of a package's code lives in
  that package. State the SUT in the opening sentence; a reader must see within thirty seconds
  what the file guards.
- **Readability is a deletion criterion** (owner, 2026-09-08, on a docs-to-source consistency
  test: "我感觉现在的测试很难让人理解"). A meta test that regex-scans prose or workflows and
  cross-compares names makes a reader understand three layers of indirection before knowing what
  it guards; delete it rather than repoint it. Write new tests so that someone new to the
  repository sees what they guard at a glance.
- **Move a policy to its platform enforcement point before deleting the assertion that pinned
  it** (owner, 2026-09-10). The YAML assertion goes only when the platform holds the rule.
- **A test that can push, fetch or call `gh` points at a `.invalid` host or a local bare
  repository**, with `SSH_AUTH_SOCK` unset and `GIT_SSH_COMMAND=false`. On 2026-10-16 a writer's
  mutation run broke a git shim and the test pushed a stray branch to the real remote with the
  owner's SSH key; the owner had it deleted. Tests and their cleanup kill only the processes they
  started (by PID), never by pattern: a `pkill -f vitest` reaches other lanes. Both are the
  controller's practice since that incident, written into its loop prompt, which the owner approved
  and set running on 2026-10-22 and again on 2026-10-23.
- The test-file limits and the no-conditional-logic rule are in `AGENTS.md` ("Test quality"). A
  cross-package count assertion (how many files another package has) is not written: it breaks
  when that package changes and is not run by that package's lane.
