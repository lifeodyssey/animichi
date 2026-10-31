# Harness (4-role agent system) and the escalation path

Read before dispatching work, before citing a gate as enforced, and before asking anyone a
question.

## Harness (4-role agent system)

Canonical workflow: `docs/workflow.md` (Matt flow × Policy C, per-stage machine-judgeable triggers).
**Coordinator skill: `animichi-orca-orchestration`**, kept in the private `lifeodyssey/zdev` repository and installed as a global skill (`docs/agents/orchestration.md`) — the operating
manual for one delivery tick: the writer/reviewer roster, the launcher's contract, the merge
conditions, and the failure modes each of them was written to prevent. Read it before
dispatching anything. The retired `use-opencode` and `fleet-orchestra` skills are superseded
by it; the `opencode serve` channel they described is no longer how work is dispatched.
Role definitions live in `.claude/agents/`:
- planner — grilling → to-spec → to-tickets (blocking edges); spec dual-review (GLM + DeepSeek, per the owner's 2026-09-24 decision) before owner sign-off.
- executor — dispatched through the Orca headless launcher; see the coordinator skill above
  for the current roster. Brief-driven; publication stays with the coordinator.
- reviewer — card-level final review: read the candidate diff vs brief before merge; **Mutation testing is the only valid green-light proof.**
- tester — Playwright Test Agents pipeline (planner/generator/healer, promotion gates) + staging validation with evidence.
**Quality Ratchet**: every AC carries a test-type (`unit`|`integration`|`eval`|`browser`|`api`) and a test in the PR diff (`ac_total == ac_with_test`); Codecov patch ≥95%. Merge requires resolved review threads + acknowledged bot findings. Two kinds of gate, not interchangeable. **Committed** (every contributor, every CI run): the `commitlint` commit-msg hook, the pre-push affected gate (`scripts/local-gates/pre-push-affected.sh`, running the same package scripts as CI's affected matrix), and the native workflow/action tests under `.github/test` plus repository configuration tests under
`test/repo-config` — CI's `commits`, `affected` and `contracts` lanes mirror those three. **Owner-local**: the hookify rules `block-secrets-in-pr` and `block-local-deploy`, which live beside the tracked files in `.claude/` but are gitignored — enabled and blocking on the owner's machine, absent from a fresh clone and from CI. Never cite one of the two as proof that a repository rule is enforced.

## Concurrency: as wide as the resources allow (owner, 2026-09-09 to 2026-10-15)

Run every card that can run in parallel. The owner has said it more than ten times: "4是谁定的，我允许你更多"
(2026-09-09), "我们记得一定要开满并发，能变形的东西就并行去做" (2026-09-22), and of the long-lived
coordinator it replaced, "我一直要求开足并发但是他却并发一直很低" (2026-10-04). The ceiling comes from
measured resources, not from a fixed number: memory (on the 24 GB host the writers were held to
about four after a review lane was killed for lack of memory, 2026-10-15, when the owner also said
"我们可以开大并发") and the push gates, which run serially. When fewer lanes run than the
resources allow, look for more unblocked cards before waiting. The host's figures are in the
machine-local Orca notes.

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

The same path holds while the owner is away ("我去旅游了，有拿不准的问fable", 2026-10-31); the
advisor's view is advice, not the owner's authorisation, so the five categories still wait.

- **"我明确授权" is the authorisation.** When the owner has said it, do the thing; do not decline,
  re-ask or stop again ("为啥又decline了 我明确授权！", 2026-08-24). It covers that one action and
  nothing beyond it ("我授权你no verify 一次 就这一次", 2026-09-09). Record what was done and how
  to undo it.
- **A refusal by the permission classifier or a hook ends that action.** Do not retry it, do not
  route around it, do not hand it to a sub-agent, and do not write the same content with another
  tool; record it for the owner, who can widen `/permissions` for that one command. Rewriting a
  refused Linear write as a standalone script was itself refused as a bypass (2026-10-16). When a
  refused `git rebase` has a non-rewriting alternative, take it (a merge); if that is refused too,
  stop and ask (2026-10-15). The one exception is a hook whose message names the allowed form, such
  as writing a heredoc that quotes a command with a file tool instead.
- **Text that goes out under the owner's name is shown to the owner first**: an upstream issue
  is drafted with a synthetic reproduction and posted only after the owner has read it
  (2026-10-15).
