# Handoff — animichi S1.x sprint (2026-07-26)

Repo: `lifeodyssey/animichi`. Integration branch: **`feat/frontend-rebuild`** (NOT `main`).
Working clone: `/private/tmp/claude-501/-Users-lumimamini-Documents-Seichijunrei-agent/0f5350ba-3042-4bc6-a55f-cbe2e4a860bd/scratchpad/animichi`
Worktrees live as siblings: `scratchpad/wt-<n>`.

⚠️ `/Users/lumimamini/Documents/Seichijunrei-agent` is a **different, legacy repo**. Its `CLAUDE.md` does not describe animichi. animichi's own `AGENTS.md` is authoritative (`CLAUDE.md` there is an 11-byte `@AGENTS.md` pointer).

---

## The standing goal

An active `/goal` governs this work. Its conditions, and where they stand:

| # | Condition | State |
|---|---|---|
| 1 | PR #430 merged, after independent gate re-run + Fable 5 approve | ✅ **Done** — merged after CI came back green |
| 2 | #303 and #293 each: independent verify → Fable review → apply findings → merge | ✅ **Done** (#442, #440 merged) |
| 3 | Remaining S1.x cards: AC produced → confirmed → implement FE/BE in parallel → verify → Fable → merge | 4 merged, 2 in flight, 2 not started |
| 4 | Audit before starting each card; close already-done ones with evidence | ✅ Practised throughout — closed #256, #258; annotated #271, #273 |
| 5 | Agent CI / Web app CI / Python integration green (Semgrep + osv-scanner excepted) | Holds on every merged PR |

**Approved implementation order** (owner chose "dependency first"):
`#261 → #271 → #274 → #281 ∥ #282 → #260 → #284`.
**#273 is not in that list** — I omitted it when building the options. Owner has not ruled on it.

---

## Merged today (7 PRs)

| PR | Card | Note |
|---|---|---|
| #435 | #261 S1.4 search cards + static map | Two P1s fixed (sentinel handling, SonarCloud S7727) |
| #436 | #281 S1.9 Turnstile | Gate is **dormant** — built and tested, never called |
| #439 | #271 S1.5 route card | AC3 (×1.3 coefficient) was already shipped; untouched |
| #438 | #274 S1.8 anonymous + rate limit + budget breaker | Two P1s fixed (SSE buffering, metering exception tuple) |
| #440 | #293 S1.13 eval gate + closes #434 | P1 gate hole fixed (ModelHTTPError misclassification) |
| #442 | #303 CatalogClient httpx reuse | Core was already on base via an unreviewed WIP commit |
| — | #433, #431 etc. earlier in session | |

Also closed with evidence: **#256** (S1.1), **#258** (S1.2) — both were fully delivered weeks ago.

---

## Recently closed / in flight

### ~~PR #430~~ — merged. Goal condition (1) is satisfied.

The substance of the fix is in the commit message on `4a9a9c4`; read it rather than re-deriving. Short version: the `tool_event_bridge_for` guard keyed production control flow on a test-only `FunctionModel` class, and its effect was not "skip progress events" but "make search structurally impossible" (empty `deps.steps` → `_valid_search` rejects everything → ModelRetry until exhaustion). Deleted; handler now installed unconditionally.

### Two executor agents running
- **`wt-260`** — card **#260 (S1.3)** clarification + location prompt + photo search phase 1. 12 ACs, the largest card. Fable 5. 5 commits so far.
- **`wt-282`** — card **#282 (S1.10)** anonymous daily quota. 4 ACs. Opus 5. 2 commits so far.

Both were dispatched with the full constraint set (see "Working method" below). When they report, run the same loop: independent gates → Fable review → apply findings → rebase → merge.

---

## Not started

- **#284 (S1.11) BYOK + SSRF** — 13 ACs, last in the approved order. **Highest security risk in the batch**: it must accept an arbitrary user `base_url` (self-hosted vLLM is a core scenario, so no domain allowlist), which forces the post-resolution-IP design — resolve → verify the IP is not private/loopback/link-local/metadata → **connect to that already-resolved IP** (prevents DNS rebinding) → never follow redirects. Give it its own review round; do not let an executor freestyle this.
- **#273 (S1.7)** living document + save-login-wall + fact ledger. **3 of its 13 ACs are already satisfied** — see the audit comment I posted on the issue. Also: #439 shipped a generic `supersededFlags` helper specifically for #273 to reuse. Not in the approved order; **ask the owner before starting**.

---

## 🔴 Four decisions waiting on the owner

1. **Rotate the Turnstile secret.** It appeared in this session's transcript. Rotation needs no code change — two CLI lines (`gh secret set` / `npx wrangler secret put ... --env=""`).
2. **A stray empty Cloudflare Worker named `animichi`** was created as a side effect of `wrangler secret put` in a non-TTY shell (it prints `Using fallback value in non-interactive context: yes` and creates the Worker). My recommendation: **leave it** — the real deploy uploads code to the same name and the secret binding survives; deleting means re-injecting. Do not delete unilaterally.
3. **#273 — start it in parallel?** It is the cleanest remaining candidate (no file overlap with anything in flight).
4. **Production `ANON_ACCESS_ENABLED`.** I set it to `"false"` for production only (dev/staging stay `"true"`). Reason: until Turnstile is armed, dropping the `aid` cookie mints a fresh identity and resets the per-identity limiter, so the only real guard is the daily dollar breaker — an attacker can burn the whole budget daily and wall out legitimate visitors. Turning it on is the owner's call.

---

## Working method that produced today's results

Follow this loop per card. It is the reason every PR merged with its P1s found rather than shipped.

```
audit the card against the real tree   (cards go stale; titles are the stalest part)
  → prepare the worktree MYSELF (fetch, worktree add, pnpm install, uv sync)
  → dispatch executor with the full constraint block
  → I re-run the project's own gates independently
  → dispatch a Fable 5 reviewer (read-only, separate worktree)
  → apply findings + mutation-verify each fix
  → rebase onto the current base and re-run gates
  → merge
```

**Mandatory in every executor and reviewer prompt** — omitting these is how the defects got in:
- **Mutation discipline**: mutate each new piece of logic, confirm the covering test fails, revert, paste the evidence. Four PRs today shipped tests that passed for the wrong reason; every one was found this way.
- **STEP 0 base freshness**: `git rev-list --count HEAD..origin/feat/frontend-rebuild` must print `0`, and `uv run python -c "import agent,pathlib;print(pathlib.Path(agent.__file__).resolve())"` must resolve inside that worktree (a stale editable-install `.pth` has produced bogus failures).
- **No suppressions** of any kind without explicit owner approval.
- **Never write a credential-shaped literal into a fixture** — gitleaks scans commit history, not just the final tree; assemble such strings at runtime.

---

## Traps confirmed by experience today

- **`pnpm build` does not run `tsc`.** Typecheck separately. Never report "build passed" as type safety.
- **The `Makefile` is at the repo root**, not in `apps/agent`.
- **Coverage floor lives only in `apps/agent/pytest.ini`** (now **87**). A CLI `--cov-fail-under` overrides the ini — CI had been silently enforcing 80 while the repo declared 82. Fixed in #438. Judge floor tightness in **absolute covered units**, not percent: 88 vs a measured 88.17% is ~12 units of slack out of 6,841 and would fail unrelated PRs.
- **Two CI checks are permanently red and unrelated to any diff**: Semgrep (`apps/web/src/features/seo/JsonLd.tsx` `dangerouslySetInnerHTML`) and osv-scanner (lockfile CVEs, `next` 16.2.10 → 16.2.11). The goal excepts them, but every merge now needs manual filtering — I offered to fix them and got no answer. **Worth raising again**: a permanently red check trains everyone to ignore all checks.
- **List-shaped merge conflicts are the dangerous kind.** `package.json`'s `test:worker` and `worker/tsconfig.json`'s `include` are file lists; resolving one "my side" silently stops running the other side's tests while CI stays green. After resolving, count the tests (97 = 82 + 15 confirmed the Turnstile suite came back).
- **Rebase before merging, always.** #430 passed on a stale base and broke on the fresh one: #438 added a `user_type` kwarg to `RuntimeAPI.handle`, #430's fake test handlers rejected it, the route swallowed the `TypeError`, and the stream came out empty. Neither PR was wrong alone.
- **`pytest.ini` sets `--maxfail=1`.** After a mutation run, "only one test failed" may just mean it stopped. I misjudged a test as weak because of this.
- **Codex stalled twice** (6 h with no file activity, zero commits). Judge by file mtime, not wall clock. Rescue by committing the WIP, then re-dispatch to an Opus executor. Both rescues (#293, #303) turned into merged PRs.
- **`gh pr comment` is blocked by a repo hook.** Use `gh issue comment` instead.
- **Multi-line commit messages: pass via `-F <file>`.** Backticks in `-m` get shell-evaluated and silently eat text (happened once; had to amend).

---

## Open issues filed today

- **#437** — #261 follow-ups (untested D7 catch, one-way drill-down, unwired spot checkbox, an unreproduced web-suite flake)
- **#441** — expired/invalid JWT silently degrades a logged-in user to anonymous
- **#443** — `search_nearby` repeat guard fires intermittently across unrelated branches (`C1_en_001` / `C1_en_005`). **The issue explicitly says: do not widen the guard to make CI green.** Two candidate explanations (ambiguous case vs real thrash) need the actual trajectory to distinguish; widening would make both go green while destroying the only thing catching thrash.
- **#432** — architecture PRD (DDD / hexagonal / clean-architecture audit)

---

## Suggested skills for the next session

- **`superpowers:systematic-debugging`** — if #430's CI or the #443 repeat-guard question is still open. Today's #430 diagnosis reversed four times; every correction came from adding a control group, never from reasoning alone. That skill's discipline is exactly the missing ingredient.
- **`/investigate`** — for #443 specifically (run `C1_en_001` / `C1_en_005` in isolation and read the real trajectory).
- **`/review`** — before merging #260 and #282, in addition to the Fable reviewer pass.
- **`superpowers:brainstorming`** — before touching **#284 (BYOK/SSRF)**. The SSRF guard design is subtle enough that jumping to implementation is the wrong first move.
- **`/ship`** — when the S1.x set is complete and a tag-based deploy is due. Deploys are triggered only by pushing a version tag, never by merging to main.

Do **not** use `mcp__claude-in-chrome__*` directly — this repo's conventions route all browsing through `/browse`.

---

## Memory files written today (read these first)

Under `~/.claude/projects/-Users-lumimamini-Documents-Seichijunrei-agent/memory/`:

- `project_s1x_sprint_jul26.md` — this sprint's state
- `feedback_mutation_testing_gate.md` — the four "green for the wrong reason" cases, with the mechanism of each
- `feedback_coverage_gate_truth.md` — the coverage-floor override and how to size a floor
- `feedback_cli_prod_writes.md` — the `wrangler secret put` fallback-to-yes trap; Turnstile key shapes (site key 24 chars, secret 35)
- `feedback_executor_orchestration_gotchas.md` — stale bases, venv `.pth` pollution, reverse-enumerating boundary defences
