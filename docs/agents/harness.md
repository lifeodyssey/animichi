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

## 升级路径(谁来拍板)

1. **能按原则判的自己定** —— TDD/DDD/SOLID/clean code/KISS/设计模式/官方 best practice 能裁决的问题,
   不问任何人,直接执行并在产出里写明理由。「我不确定」不是升级的理由。
2. **本来要问 owner 的,先问 Fable 5.1**(`advisor` 席位,读得到完整会话上下文)。带着具体选项和代价去问,
   不要抛开放式问题。只有当 Fable 5.1 也认为必须由 owner 拍板时,才停下来等 owner。
3. **只有这五类必须等 owner**:花钱 · 生产/staging 动作 · 密钥 · 范围与优先级 · 明文规则的豁免。

等人回答之前,先把不依赖那个答案的部分全部做完。
