# Harness (4-role agent system) and the escalation path

Read before dispatching work, before citing a gate as enforced, and before asking anyone a
question.

## Harness (4-role agent system)

Canonical workflow: `docs/workflow.md` (Matt flow × Policy C, per-stage machine-judgeable triggers).
**Coordinator skill: `.claude/skills/animichi-orca-orchestration/SKILL.md`** (force-added; `.agents/` is a gitignored mirror) — the operating
manual for one delivery tick: the writer/reviewer roster, the launcher's contract, the merge
conditions, and the failure modes each of them was written to prevent. Read it before
dispatching anything. The retired `use-opencode` and `fleet-orchestra` skills are superseded
by it; the `opencode serve` channel they described is no longer how work is dispatched.
Role definitions live in `.claude/agents/`:
- planner — grilling → to-spec → to-tickets (blocking edges); spec dual-review (Fable + Codex GPT Sol xhigh) before owner sign-off.
- executor — dispatched through the Orca headless launcher; see the coordinator skill above
  for the current roster. Brief-driven; publication stays with the coordinator.
- reviewer — card-level final review: read the candidate diff vs brief before merge; **Mutation testing is the only valid green-light proof.**
- tester — Playwright Test Agents pipeline (planner/generator/healer, promotion gates) + staging validation with evidence.
**Quality Ratchet**: every AC carries a test-type (`unit`|`integration`|`eval`|`browser`|`api`) and a test in the PR diff (`ac_total == ac_with_test`); Codecov patch ≥95%. Merge requires resolved review threads + acknowledged bot findings. Two kinds of gate, not interchangeable. **Committed** (every contributor, every CI run): the `commitlint` commit-msg hook, the pre-push affected gate (`scripts/local-gates/pre-push-affected.sh`, running the same package scripts as CI's affected matrix), and the native workflow/action tests under `.github/test` plus repository configuration tests under
`test/repo-config` — CI's `commits`, `affected` and `contracts` lanes mirror those three. **Owner-local**: the hookify rules `block-secrets-in-pr`, `block-local-deploy` and `block-codex-exec-codewrite`, which live beside the tracked files in `.claude/` but are gitignored — enabled and blocking on the owner's machine, absent from a fresh clone and from CI. Never cite one of the three as proof that a repository rule is enforced.

## Escalation path (who decides)

1. **What the principles can decide, decide yourself** — a question TDD/DDD/SOLID/clean code/KISS/
   design patterns/official best practice can settle is executed directly, without asking anyone,
   with the reason written into the output. "I am not sure" is not a reason to escalate.
2. **What would have gone to the owner goes to Fable 5.1 first** (the `advisor` seat, which can
   read the full session context). Ask with concrete options and their costs, never as an
   open-ended question. Only when Fable 5.1 also judges that the owner must decide do you stop and
   wait for the owner.
3. **Only these five categories must wait for the owner**: spending money · production/staging
   actions · secrets · scope and priorities · exemptions from written rules.

Before waiting on anyone's answer, finish every part that does not depend on that answer.
