> **基线注记(2026-08-03)**:本 spec 的「current state」段以 2026-07-29 基线核验;其中「deploy.yml 构建/部署 frontend/」的描述已随 #537(legacy frontend 退役)过时——现 deploy.yml 无 app build,root worker 以源码直发。使用本 spec 指导 CI/CD 改动时以现行 workflow 为准。

# CI/CD Rebuild — Spec

| | |
|---|---|
| **Status** | **Revision 2** (post dual review, both `REQUEST_CHANGES`, both "direction correct, no rewrite"). Awaiting owner sign-off. |
| **Date** | 2026-07-29 (rev 1 and rev 2 same day) |
| **Base commit** | `79c8306df` (`origin/main`, "fix: APP_ENV per-environment + LOGFIRE_TOKEN split by environment (#498) (#501)"). **Re-baselined** from rev 1's `0cad6b41`. |
| **Scope** | `.github/**` in full — 16 workflows, 1 composite action, 3 scripts. Plus the config-consistency tests that today live in the wrong packages. |
| **Backward compatibility** | **Not required** (owner directive). Every current workflow file may be deleted. |
| **Non-goal** | Changing what any package's product tests assert. This spec moves, splits, and re-triggers work. |

> **Re-baselining note.** [measured: `git diff 0cad6b41 79c8306d -- .github/` → empty] `.github/**` is
> **byte-identical** between rev 1's base and rev 2's, so every `.github` file:line reference in this
> spec survives the re-baseline unchanged. What `#501` *did* move is three entries of §5.5's
> duplication list — `wrangler.toml`, `worker/containerEnv.ts`, `Dockerfile` — plus
> `test_deploy_model_env_consistency.py` itself. That is the list this rebuild exists to collapse, and
> it moved during the ~6 hours between two revisions of the spec about it.
>
> `feat/frontend-rebuild` is ~1300 lines behind `origin/main` on `.github/` and must not be used as
> the reference tree.

### Evidence discipline (new in rev 2)

Rev 1 presented facts under headings that said "verified". Two independent reviewers read it and
neither caught §2.4's false claim, **because a spec that says "verified" is itself a load-bearing
comment** — the exact rot §4.3 and §6.4's `comment-claims` check exist to stop. Rev 2 therefore tags
every factual assertion, and the tag names something a reviewer can re-run:

| Tag | Meaning |
|---|---|
| **[measured]** | Re-run at rev 2 against `gh api`, `git show origin/main:<path>`, or the source. The command is named inline. |
| **[cited]** | Official GitHub/Cloudflare documentation, fetched not recalled. Link in §11. |
| **[unverified]** | Believed but not established. No decision in this spec may depend on one of these; each is either resolved by a spike (§7.3 Phase −1) or by an AC. |

---

## 1. Why

### 1.1 Owner directives (verbatim)

> 「就重新跑，按照 clean code、best practice，以及 GHA 的测试来做」
> 「**不需要后向兼容**」
> 「我觉得前后端 infra agent 是不是都应该有自己的 pipeline 才对」
> 「感觉没有真的按照 mono repo 的写法来做」

### 1.2 The shape of the problem, measured

| Fact | Value | Evidence |
|---|---|---|
| Workflow files | 16 | `.github/workflows/` |
| Total workflow lines | 2880 | `wc -l` at base |
| `ci.yml` | 599 lines, 27 jobs | [measured] central orchestrator |
| `_deploy-component.yml` | 614 lines, **1 job, 11 steps** | [measured] one job does: secret-shape diagnostics, preflight validation, build, Atlas migrate, Pulumi install, Pulumi state export→R2, Pulumi up, wrangler deploy, post-deploy secret push, smoke |
| Composite actions | **1** (`setup`, 21 lines) | `.github/actions/setup/action.yml` |
| `_deploy-component.yml` call sites in `ci.yml` | **8** | `ci.yml:367,388,405,426,491,511,527,547` — a hardcoded package × environment matrix living in the orchestrator |
| `worker_secrets:` occurrences in `ci.yml` | **6** | [measured] `:377, :416, :448, :500, :537, :558` — rev 1 said 2 (§5.5) |
| Shipping packages | 10 | §4.1 |
| Packages that own a pipeline | **0** | every lane is a `needs: changes` branch inside `ci.yml` |

This is not a monorepo pipeline. It is a monolith pipeline with a package-shaped `if:` ladder
bolted on. `ci.yml` knows the name, directory, build filter, Pulumi stack, secret list, and deploy
order of every component in the repo. Adding a package means editing the centre.

### 1.3 Packages with no CI at all

Verified by grepping every workflow at base for each package path:

- **`packages/contract/`** — declares `"test": "vitest run"` and `"typecheck": "tsc --noEmit"`.
  **Neither is ever invoked by any workflow.** The only contract job is `contract-openapi-drift`
  (`ci.yml:123-139`). So `packages/contract/test/anon-limits.test.ts` — which pins contract
  constants against `worker/costBreaker.ts` — has never run in CI. The cross-service source of
  truth has zero test execution.
- **`infra/`** — no lint, no typecheck, no `pulumi preview` on PR. Its only CI appearance is
  `pnpm install` + `pulumi up` inside the deploy job (`_deploy-component.yml:389-473`): the first
  time `infra/index.ts` is compiled in CI is while it is mutating live infrastructure.
  `.claude/rules/infra.md` calls for CI `pulumi preview`; it does not exist.
- **`e2e/`** — no lane. Its Playwright specs are invoked from inside `_webapp-ci.yml:44-51`
  (`apps/web`'s lane), so a change to `e2e/**` alone triggers nothing.

`.github/dependabot.yml` has the same blindness [measured]: exactly three ecosystems — `pip` at `/`
(Python moved to `apps/agent/`), `npm` at `/frontend`, and `github-actions` at `/`. So
`workers/catalog`, `workers/users`, `apps/web`, `packages/contract`, `infra`, and `e2e` receive no
dependency updates.

---

## 2. Verified current state — five corrections, one of them to this spec

`.github/` at base is heavily commented, and several comments are load-bearing behavioural claims.
Per the standing lesson that in-repo self-description fools reviewers, every claim this spec relies
on was re-verified against the GitHub API, the official GHA docs, or the source. Four premises in
the framing of this work turned out to be wrong. **A fifth premise, in revision 1 of this spec, was
also wrong** (§2.4) — which is the most instructive item in this section and is kept deliberately.

### 2.1 CORRECTION (revised at rev 2) — `main` has no required checks, **and no longer requires a pull request at all**

[measured: `gh api repos/lifeodyssey/animichi/rulesets/19974534`, read again at rev 2]

`main` has **no classic branch protection** (`GET /branches/main/protection` → 404 "Branch not
protected"). It is governed by one **ruleset**, `protect main` (id `19974534`, `enforcement:
active`, `~DEFAULT_BRANCH`, `updated_at 2026-07-29T21:42:24+08:00`), whose complete rule list is now:

```
deletion, non_fast_forward, required_linear_history,
code_scanning (CodeQL: security high_or_higher / alerts errors),
code_quality (severity: all),
code_coverage (minimum_coverage 90, max_coverage_drop 96),
copilot_code_review (review_on_push: true, drafts: false)
```

**The `pull_request` rule that rev 1 listed has been removed** — by the owner, today, at 21:42.
The reason matters and must be designed around rather than reverted: this is a single-maintainer
repository, the rule required `1` approving review, and there is no `CODEOWNERS` file. One person
cannot approve their own PR. The rule made **every** PR permanently unmergeable. It was a deadlock,
not a policy, and deleting it was correct given the alternative was a frozen repo.

**The consequence is one notch worse than rev 1 described.** Ruleset rules divide by scope:

| Rule | Scope | Live today? |
|---|---|---|
| `deletion`, `non_fast_forward`, `required_linear_history` | any write to `main`, PR or direct push | **yes** |
| `code_scanning`, `code_quality`, `code_coverage`, `copilot_code_review` | evaluated only when a pull request exists | **inert** — nothing forces a PR to exist |
| `required_status_checks` | *(never present)* | — |

So today `main` is protected against *history damage* and against nothing else. A direct
`git push origin main` is legal and sails past all four PR-scoped rules, including the min-90
coverage rule. Rev 1's framing — "CI cannot block a merge" — understated it: **the merge is not the
only door, and the other door has no lock at all.**

This retroactively qualifies §7.3's safety story. "Each phase is independently mergeable and leaves
`main` in a working state" is currently an assertion about author discipline, not about enforcement.
Phase 5 is what converts it into a property of the repository, and until then the phases' safety
rests on the same honour system as everything else here.

**Also [measured]: `bypass_actors: []`, `current_user_can_bypass: "never"`.** Nobody — including the
owner — can bypass this ruleset. That cuts both ways: nothing can be waved through, and **a mistake
in the Phase 5 re-add cannot be worked around from the merge button.** It has to be undone through
the ruleset API. Phase 5 therefore saves the prior ruleset JSON before each mutation (§7.3).

**Phase 5 now has two coupled repo-settings changes, in a strict order** (detailed as a table in
§7.3):

1. **Restore a PR requirement without recreating the deadlock.** The recommended shape is a
   `pull_request` rule with `required_approving_review_count: 0` — a PR is required (so the four
   PR-scoped rules become live again) but no human approval is, leaving `copilot_code_review` as the
   reviewing force. Alternatives considered: adding the owner to `bypass_actors` (defeats the rule),
   or a `CODEOWNERS` file (there is no second reviewer to name).
2. **Then add `required_status_checks`.** It is itself a PR-scoped rule and is therefore *inert*
   without step 1. Landing it first would accomplish nothing; landing it before check names are
   stable (Phase 4) or before §5.1.1's hermetic/credentialed split would lock out Dependabot and
   fork PRs — see §5.1.1.

There is a precondition on step 1 that rev 1 missed entirely: activating the PR-scoped rules also
activates `code_coverage` **min 90**, which disagrees by construction with `apps/agent/pytest.ini`'s
floor and with the frontend floors in `AGENTS.md` (lines ≥72 / stmts ≥68 / fns ≥62 / branches ≥59).
§10.5's reconciliation is not a nice-to-have; it is a blocker for step 1.

**`evaluate` enforcement mode: [unverified].** GitHub documents `enforcement: "evaluate"` as a
dry-run mode for rulesets. The documentation describes it in the context of **organization** rulesets,
and this is a **user-owned** repository. §9's mitigation "stage the ruleset in `evaluate` first"
therefore may not be available. Phase −1 spike 2 settles this by API call before §9 relies on it.

### 2.2 CORRECTION — #457's mechanism is the opposite of what was assumed

The brief states "GitHub 把 skipped 的 required check 视为已满足". GitHub's documented behaviour
splits in two, and the distinction is the entire basis of §5.1:

| How the check was skipped | What GitHub reports | Effect on a required check |
|---|---|---|
| **Workflow** skipped by `paths:` / `branches:` filter | *no run object is created* | Check stays **Pending**; PR is **blocked** ("Expected — Waiting for status to be reported") |
| **Job** skipped by a job-level `if:`, or by `needs:` propagation from a skipped job | run exists, job concludes **`skipped`** | Treated as **success**; PR is **mergeable** |

[cited] [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks),
whose stated recommendation is blunt: *"avoid requiring workflows that can be skipped."*

**This repo sits squarely in the fail-open row.** Every lane is gated by a job-level `if:` on
`needs.changes.outputs.*`. When `changes` failed (#490), every downstream job — including all 8
deploy jobs — concluded `skipped`, which is the "counts as success" case. That is why #483 merged
green and deployed nothing.

So the hazard is real, but the fix is not "stop using `paths:`" — it is **stop expressing
affectedness as a job-level `if:` fed by a job that can fail**.

Rulesets do **not** change this. No official documentation claims a difference, and the feature
requests are still open ([community #44490](https://github.com/orgs/community/discussions/44490),
[#13690](https://github.com/orgs/community/discussions/13690),
[#26092](https://github.com/orgs/community/discussions/26092)). Treat "rulesets fixed it" as false
unless verified live.

### 2.3 CORRECTION — `deploy.yml`'s manual path is *not* an approval bypass

`deploy.yml`'s only job declares `environment: production` (`deploy.yml:16`), so the manual
`workflow_dispatch` path **is** behind the required-reviewer gate. [measured] `GET /environments` →
`production` has `protection_rules: [required_reviewers]`; `staging` has none. [cited] GitHub docs
confirm the trigger is irrelevant — the gate attaches to the job's `environment:` reference, not to
the event.

What `deploy.yml` actually bypasses is different, and worse:

- It runs from **any ref** (`workflow_dispatch`, no branch restriction, no deployment branch policy).
- It runs **no tests** — not lint, typecheck, unit tests, nor `contract-openapi-drift`.
- It **skips staging entirely**. The `ci.yml` path gates production on `post-staging`
  (`ci.yml:493`); `deploy.yml` has no such edge.
- It **duplicates ~140 lines** of preflight/secret-push logic by copy-paste
  (`deploy.yml:31-112` vs `_deploy-component.yml:173-297`) — incident #5's exact shape.
- It builds and deploys `frontend/` (the **frozen legacy** package) as the production root.

So the gate to preserve is intact; the missing gate is *"production may only receive a commit that
passed CI and staging"* (§5.4).

**A second, sharper bypass exists in `ci.yml`.** The four production deploy jobs
(`ci.yml:491,511,527,547`) carry **no `if:` of their own**. They are kept off `workflow_dispatch`
purely by skip-propagation from the staging jobs' `if:` (`ci.yml:370,391,408,429`) through
`post-staging` (which has neither `if:` nor `always()`). Adding `always()` anywhere in that chain
— a one-line change a reviewer would wave through — makes `workflow_dispatch` reach a production
deploy with no staging validation behind it.

**And two environment-level bypasses exist — now measured, where rev 1 only suspected one.**
[measured: `gh api repos/lifeodyssey/animichi/environments`]

| Environment | `protection_rules` | `prevent_self_review` | `can_admins_bypass` | `deployment_branch_policy` |
|---|---|---|---|---|
| `production` | `required_reviewers: [lifeodyssey]` | **`false`** | **`true`** | **`null`** (any branch) |
| `staging` | *(none)* | — | `true` | `null` |

Three consequences, and the first materially weakens AC-5.4 as rev 1 wrote it:

1. **`prevent_self_review: false`, and the only listed reviewer is the only human on the repo.**
   The person who triggers a production deploy may legally approve their own deploy. The door
   exists, it raises a prompt, and it does stop side effects until someone clicks — but it is a
   *speed bump on one person*, not a second pair of eyes. AC-5.4 may assert **that the prompt
   appears and that nothing has run before it**; it may **not** be read as "another party checked".
   Rev 1's phrasing implied the latter.
2. **`can_admins_bypass: true` on both environments** (GitHub's default). An admin can "Start all
   waiting jobs" from the Pending state, leaving only a bypass record in the deployment log.
   Turning it off is a repo-settings change (§10.2).
3. **`deployment_branch_policy: null`** on both — confirming §5.4's decision 5 (restrict production
   to `main`) is genuinely undone today, not merely unaudited.

Note the asymmetry this produces: the ruleset lets **nobody** bypass (`bypass_actors: []`), while
both environments let **every admin** bypass. The strictest and the weakest gate in the repository
guard the same commit.

### 2.4 CORRECTION — `catalog → root` is a *runtime* dependency; and rev 1's `workers_dev` claim was **false**

Three places in the repo assert root must deploy after catalog:
`wrangler.toml` (root `[[services]]` comment), `docs/ops/deployment.md:249`, and
`deploy.yml:171`. All three are **reasoned prose with no cited incident**.

What is verified:

- **Runtime dependency: real and load-bearing.** [measured] `worker/app.ts:27-28,66,306,361` — root
  reaches catalog and users *only* through `env.CATALOG.fetch` / `env.USERS.fetch`.
  `worker/entry.ts:52-54` routes the Python container's `http://catalog.internal` outbound to the
  same binding. Neither `workers/catalog/wrangler.toml` nor `workers/users/wrangler.toml` declares
  any **route** in any environment. There is no public URL fallback *in the binding path*.
- **Build-time (deploy-time) dependency: [unverified].** Cloudflare's docs describe `services`
  config but say nothing about deploy-time validation of a missing binding target. The vendored
  `wrangler@4.112.0` CLI carries no client-side check. Whether `wrangler deploy` of root *fails*
  when `catalog` is absent must be determined empirically (§5.3, AC-3.5).
- **The order matters for the gate regardless.** `_post-deploy-test.yml:144` runs
  `post-deploy-assert.sh catalog-probe` against the root URL, asserting the edge→CATALOG→Neon
  round-trip. Deploying root before catalog would fail that assertion.
- `apps/web/wrangler.jsonc` and `frontend/wrangler.jsonc` declare **no** service bindings —
  `web` is genuinely independent, in both directions.

#### 2.4.1 The claim revision 1 got wrong

Rev 1 wrote, in this section, that catalog and users have no route in any environment
"(`workers_dev = false`)". **The parenthetical is false for `catalog`.**
[measured: `git show origin/main:workers/catalog/wrangler.toml | grep -n 'workers_dev\|^\[env'`]

| Config | `workers_dev = false` declared at | Environments left to the default |
|---|---|---|
| `workers/users/wrangler.toml` | top level, `[env.staging]`, `[env.production]` — **3×** | none |
| `workers/catalog/wrangler.toml` | **`[env.preview]` only** (`:75`) | **`staging`, `production`** |
| `apps/web/wrangler.jsonc` | `env.preview` only | `staging`, `production` — *intentional*, this is the live URL today |

[cited] Wrangler's default is `workers_dev = (routes.length === 0)`: **a Worker that declares no
routes is published on `*.workers.dev` unless it explicitly says otherwise.** Catalog declares no
routes in any environment. Therefore `catalog-staging.<account>.workers.dev` was publicly
resolvable and returning real catalog data with no authentication in front of it. Not a
hypothetical exposure — a live one.

PR **#539** (`fix(catalog): stop publishing the Worker on workers.dev`) adds the missing
declarations plus a test. **[measured] It is OPEN, not merged, as of this revision** — the review
brief described it as "just merged"; it is not. The exposure is live until it lands, and no phase
of §7 may assume it.

Note the third row: `apps/web` has the same *shape* — `workers_dev` left to default outside
`preview` — but there it is deliberate, because `animichi-web-staging.<account>.workers.dev` is
currently the only reachable URL for the app. §6.4's `wrangler-config-contract` check must therefore
demand an **explicit** `workers_dev` declaration wherever routes are absent, rather than demanding
`false`. Making the intent visible is the invariant; the value is a per-Worker decision.

#### 2.4.2 The lesson, kept deliberately

This spec's §4.3 says *"comments state invariants, not incident history"*, and §6.4 specifies a
`comment-claims` check whose entire justification is that in-repo self-description fools reviewers.
Revision 1 then asserted a false fact about a config file, under a heading reading "**Verified**
current state", and **two independent reviewers signed off on that section**. The claim came from
reading `workers/users/wrangler.toml` — where it is true three times over — and generalising to its
neighbour without opening it.

The failure mode is exactly the one the spec was written to prevent, applied to the spec itself. A
document asserting a checkable fact is a comment, and it rots the same way. Two things follow, and
both are load-bearing rather than decorative:

1. Every factual row in rev 2 carries `[measured]` / `[cited]` / `[unverified]` **and names the
   command that produced it**. The tag is a re-runnable artefact; the word "verified" is not.
2. `comment-claims` (§6.4) gets a companion in `docs/DOCS_POLICY.md` scope: **spec claims about
   repository state are subject to the same rule as workflow comments** — a fact worth writing down
   is worth an assertion. The `wrangler-config-contract` check (§6.4) exists in part because it
   would have caught *this specific sentence* being wrong.

#### 2.4.3 Stale comments already in the tree

`wrangler.toml`'s `[vars]` and `[[services]]` comments and `worker/app.ts:334` all state
*"There is NO public /catalog/* route"* — contradicted by `worker/app.ts:351`, which serves
`/catalog/public/anime-overview/:bangumiId`. Worth its own issue.

### 2.5 The deploy chain has never completed

`_post-deploy-test.yml:10-20` states in-file that every deploy job has been silently skipped on
every push to `main`, and that *"A green run of THIS PR is not proof the assertions work"*. Root's
`wrangler.toml` `[env.staging.vars]` comment independently records: *"the root `animichi-staging`
Worker has never successfully deployed yet (`wrangler secret list --env staging` → 'Worker … not
found')"*.

The git log corroborates. **[measured, corrected at rev 2]** `git log --oneline 1cae11f6..0cad6b41 --
.github/ | wc -l` → **21** commits touching `.github/`, of which **10** carry the literal `fix(ci)`
prefix; the remainder are `fix(ci,docs)`, one `fix(agent)`, one `chore:`/`chore:` add-and-remove pair
for a throwaway DB-pointer verification workflow, and two `diag(527)` commits. Rev 1 said "**25
consecutive `fix(ci)` commits**" — the count was wrong and "consecutive" was wrong.

The corrected figure does not weaken the argument; it sharpens it. Four of the 21 are workflows
**created and then deleted for the sole purpose of observing a runtime behaviour** — environment
secret resolution (#527) and a DB pointer — that no local tool could reproduce (§6.5). A pipeline
where the cheapest way to learn a fact is to commit a temporary workflow to `main` is the defect,
independent of how many bug-fix commits sit alongside it.

Each fix was discoverable **only by pushing to `main` and watching**, one stage per cycle, because
the deploy logic is unreachable except through a full `ci.yml` run:

```
#484 post-deploy smoke → #485 rollback → #492 secret gating → #493 URL resolution
→ #516 Atlas schema scope + wrangler packageManager → #522 Pulumi SDK not installed
→ #523 edge-404 vs app-404 → #527/#528 environment secret resolution
→ #537 root assets path (still open — §7.3 Phase 3)
```

That feedback latency — not any individual bug — is the defect this rebuild exists to remove.

### 2.6 What is good and must be preserved

- `.github/scripts/post-deploy-assert.sh` + `post-deploy-assert.test.sh` — real behavioural tests
  driving the real script against a throwaway mock server, asserting on **request counts and exit
  codes, never elapsed time** (`post-deploy-assert.test.sh:9-21`). **This is the template the whole
  rebuild generalises** (§6.1).
- `resolve-worker-url.sh` — deterministic name→URL mapping, not a network guess.
- `_security.yml` already runs `actionlint` 1.7.7 and `zizmor` over the workflow tree, plus
  gitleaks / TruffleHog / osv-scanner / Semgrep / sqlfluff / shellcheck.
- Every third-party action is 40-char SHA-pinned with a trailing `# vX.Y.Z`, per `.claude/rules/ci.md`.
- The `agnix` warn-only gate's `continue-on-error` (`ci.yml:186`) — a sanctioned exception, kept.
- **New at rev 2:** `workers/catalog/test/wrangler-private.worker.test.ts` (PR #539, **open**) — the
  config-as-data test pattern this spec's §6.4 generalises. See §6.4 for the pattern *and* for the
  trap it documents.

---

## 3. The five incidents, and the structural claim

| # | Incident | Immediate cause | Structural cause |
|---|---|---|---|
| 1 | **#490** — 8 deploy jobs silently skipped | `changes` exited 128: `dorny/paths-filter` on `push` needs `before` reachable; `fetch-depth: 1` + `persist-credentials: false` denied it (fixed at `ci.yml:64`) | Affected-detection is a **job**, so it can fail; 27 jobs `needs:` it. One failure = whole-pipeline skip, and **`skipped` reads as success** (§2.2). |
| 2 | **`main` red** — `test_deploy_model_env_consistency.py` | It reads `worker/containerEnv.ts`, `ci.yml`, `deploy.yml`, `_deploy-component.yml`, **and `Dockerfile`**; it runs in `Agent CI`, whose filter is `['apps/agent/**','packages/contract/**']` (`ci.yml:73`). **Zero of its five inputs are in its trigger.** | **A test's trigger set is unrelated to its read set.** Nothing connects "this test reads X" to "this test runs when X changes". This is not one test — it is **eight** (§6.4). |
| 3 | **#457** — skipped required check counts as satisfied | Job-level `if:` / `needs:`-propagation skips report **success** (§2.2) | Per-lane checks cannot express "the pipeline as a whole ran". Currently moot only because nothing is required (§2.1) — and blocking the moment required checks are added. |
| 4 | **Components drag each other down** | `deploy-root-staging` `needs: [deploy-staging, deploy-users-staging]` (`ci.yml:428`); a catalog `Pulumi up` failure skips root and users | `needs:` is used to encode **ordering**, but `needs:` means **validation dependency**. Conflated, so an unrelated failure cascades — and cascades as `skipped`, i.e. green. |
| 5 | **List-shaped merge conflicts** | `worker_secrets` / `post_deploy_secrets` / `secrets:` / `[vars]` are YAML/TOML lists maintained by hand in 8 places (§5.5). "Keep one side" silently drops entries | `_deploy-component.yml:15-19` documents the rule in prose — *"adding a new post-deploy secret means adding it in those three places"* — with no test that the copies agree. |
| 6 | **#537** — root staging deploy structurally impossible | `build_filter: frontend` runs `next build` (→ `frontend/.next`); `wrangler.toml` asks for `.open-next/assets` relative to `working_directory: "."`. Two competing wrangler configs claim the same frontend | **A build's outputs and a deploy's inputs are stated in different files and never compared.** Also: `wrangler-action`'s `uploadSecrets()` runs **before** deploy, so 9 secrets were pushed to a Worker whose deploy then failed. |

**Structural claim.** Incidents 1, 2, 4, 5 and 6 are one defect wearing five hats: *a fact is stated
in one place and depended on in another, with nothing checking they agree.* The rebuild's job is to
give each fact one home, and to add a test wherever duplication is unavoidable.

---

## 4. Target architecture

### 4.1 Package inventory (verified against `pnpm-workspace.yaml` + directory structure)

`pnpm-workspace.yaml` declares `frontend`, `worker`, `workers/*`, `apps/*`, `packages/*`, `e2e`.
`infra` is **deliberately not a member** (`_deploy-component.yml:365-377`, verified empirically: it
needs `pnpm install --ignore-workspace` and has its own `infra/pnpm-lock.yaml`). `apps/agent` is a
member directory but a **uv** project, not a pnpm one.

| # | Package | Kind | Deploys? | Owns |
|---|---|---|---|---|
| 1 | `apps/agent/` | Python / uv / FastAPI, shipped as the root Worker's container | via `root` | `agent.yml` |
| 2 | `apps/web/` | TanStack Start → CF Worker (`wrangler.jsonc`, Worker `animichi-web`); **no service bindings**; `workers_dev` explicit only in `preview` | yes, independent | `web.yml` |
| 3 | `workers/catalog/` | TS Worker + data platform + Pulumi + Atlas/Neon; **no routes and no `workers_dev` outside `preview`** — see §2.4.1 | yes | `catalog.yml` |
| 4 | `workers/users/` | TS Worker (Hono/oRPC/jose); no routes, `workers_dev = false` ×3 | yes | `users.yml` |
| 5 | `worker/` | root CF edge Worker (`entry.ts`, Worker `animichi`) + container + `CATALOG`/`USERS` bindings; three `[assets]` blocks that point at a directory nothing builds (#537) | yes | `root.yml` |
| 6 | `packages/contract/` | shared oRPC/zod contract | no | `contract.yml` |
| 7 | `infra/` | Pulumi IaC (non-workspace, own lockfile) | yes (`pulumi up`) | `infra.yml` |
| 8 | `e2e/` | Playwright suites | no | `e2e.yml` |
| 9 | `frontend/` | **frozen** legacy Next.js, homepage-only; second wrangler config (Worker `animichi-frontend`) | via `root` today; **retired by §7.3 Phase 3c** | `frontend.yml` (freeze-guard) |
| 10 | `db/` | Atlas migrations (not a JS package) | applied by the catalog deploy | folded into `catalog.yml` |
| — | **`ci/` (new)** | the pipeline's own tests + config-consistency checks | no | `meta.yml` |

> **What "owns" means, corrected at rev 2 (§5.3).** A package's caller owns that package's **CI** —
> its triggers, its lint/typecheck/test/build, its failure signal. It does **not** own a deploy job.
> Deploying an environment's Worker set is owned by `deploy-staging.yml` and `deploy-production.yml`,
> one file each, because deploy order is a property of the environment and cannot be expressed across
> independent workflow runs. Rev 1 put deploy jobs in package callers and simultaneously required an
> ordered sequence; those two are mutually exclusive. Full argument in §5.3.

### 4.2 Three layers

```
.github/
  scripts/<verb>.sh              # pure shell — no GHA syntax. Testable locally and under `act`.
    <verb>.test.sh               #   behavioural test (post-deploy-assert.test.sh is the template)
  actions/<atom>/action.yml      # LAYER 1 — composite action = ONE atomic step, thin wrapper over a script
  workflows/
    reusable-<capability>.yml    # LAYER 2 — `on: workflow_call`. Owns jobs, environments, permissions.
    <package>.yml                # LAYER 3 — the package's own CI caller.
    deploy-staging.yml, deploy-production.yml, meta.yml
```

**The layer boundary is not a matter of taste — GitHub fixes it.** [cited]
[Avoiding duplication](https://docs.github.com/en/actions/concepts/workflows-and-actions/avoiding-duplication)
and the [Contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts):

| Capability | Composite action | Reusable workflow |
|---|---|---|
| `secrets` context | **Cannot use it** — *"not available for composite actions due to security reasons… pass it explicitly as an input"* | Yes |
| `environment:` (approval gate) | No — job-level key, composites have no jobs | Yes |
| `permissions:`, `concurrency:`, `runs-on:`, `strategy:` | No | Yes |
| Separate check run in the PR UI | No — collapses to one step | Yes — `<caller-job> / <called-job>` |
| Logging | One collapsed step | Each step real-time |
| Nesting limit | 10 | 10 levels |

**Design consequence, and it is load-bearing:** every atom that touches a secret
(`wrangler-deploy`, `worker-secrets-put`, `atlas-migrate`, `pulumi-apply`, `preflight-secrets`)
**must accept the secret as an `input:`, not read `secrets.*`**. The secret therefore appears in
the caller's `with:` block. This is safe — the value is still a masked secret expression — but it
means the *list* of secrets a component needs is a property of the **reusable workflow**, not of
the atom.

**And it has a second consequence rev 1 did not follow through:** because `with:` keys and
`on.workflow_call.secrets:` keys are both **static**, the *set* of secrets cannot be data. §4.3
rewrites the "one home per secret name" rule accordingly, and Phase −1 spike 1 establishes what is
actually expressible before §5.5 commits to anything.

#### Ordering invariant recovered from #537: secrets are pushed **after** a successful deploy

[measured, issue #537] `cloudflare/wrangler-action` runs its `uploadSecrets()` phase **before**
`wrangler deploy`. On the failed root staging run this pushed **9 secrets** to a Worker whose deploy
then failed — landing credentials on a Worker that did not exist, or on a stale prior version, with
no rollback of the secret write.

Splitting `wrangler-deploy` and `worker-secrets-put` into two atoms fixes this **only if the order
is also stated as an invariant**, because nothing about "two atoms" implies a sequence:

> **`worker-secrets-put` runs only after `wrangler-deploy` has concluded successfully, and
> `wrangler-deploy` must not be configured with `wrangler-action`'s own `secrets:` input.**

AC-0.7 asserts both halves — the second half matters because leaving the action's `secrets:` input
populated silently reinstates the pre-deploy upload no matter what the step order says.

**Layer 1 — composite actions (atoms).** One thing each; typed `inputs`/`outputs`; **no branching
on component name**. Any atom whose body would exceed ~15 lines of shell delegates to
`.github/scripts/<verb>.sh`, which is then unit-testable off-GHA.

| Atom | Replaces (`_deploy-component.yml` line ranges, [measured] at base) |
|---|---|
| `setup-node` / `setup-python` | `actions/setup` (split) |
| `atlas-migrate` | `:306-345` (keeps the `search_path=public` fix, #516) |
| `pulumi-install` | `:346-392` — CLI install (`:349-351`) + `pnpm install --ignore-workspace` in `infra/` (#522) |
| `pulumi-snapshot` | `:393-466` — `pulumi stack export` → R2 rollback backup |
| `pulumi-apply` | `:467-479` — `pulumi up` |
| `wrangler-deploy` | `:483-521` (keeps `packageManager: pnpm`, #516) |
| `worker-secrets-put` | `:554-575` — **runs after `wrangler-deploy`**, see above |
| `preflight-secrets` | `:173-297` **and** `deploy.yml:31-112` — one copy, not two |
| `resolve-worker-url` / `post-deploy-assert` | existing scripts, gain action wrappers |

> Rev 1 listed `pulumi-apply` as `:349-479` and `pulumi-snapshot` as `:393-466` — overlapping ranges
> for two supposedly atomic units. [measured] The three concerns are genuinely distinct steps and are
> split into three atoms above. Splitting them also matters for idempotency (§5.3): the snapshot is
> the *pre-change* state and must not be retaken on a re-run after a partial `pulumi up`.

**Layer 2 — reusable workflows (capabilities).**

| Reusable | Purpose |
|---|---|
| `reusable-ts-ci.yml` | typecheck + oxlint + vitest + coverage, parameterised by package dir |
| `reusable-python-ci.yml` | ruff + mypy + vulture + pip-audit + pytest/cov |
| `reusable-worker-deploy.yml` | one environment's Workers: preflight → build → deploy → secrets → smoke. **The only place `environment:` is declared** (§5.4). **Owns the `on.workflow_call.secrets:` block that is the authoritative home for secret names** (§4.3). |
| `reusable-post-deploy.yml` | the assertion suite against a deployed environment |

**Layer 3 — callers.** Package callers (~40-80 lines each) own triggers, `permissions:`, and CI only.
Two environment callers (`deploy-staging.yml`, `deploy-production.yml`) own deploys (§5.3).

### 4.3 Clean-code rules for YAML

The repo's 1-10-50 rule has no YAML analogue today. Adopt one:

- Package caller ≤ 80 lines. Reusable workflow ≤ 150. Composite action ≤ 60. Longer ⇒ script + test.
- **No `if:` branching on a component/package name in layers 1-2.** `_deploy-component.yml:584-614`'s
  `case "$COMPONENT"` smoke switch is the canonical violation: if a step needs to know which package
  it is, that is a missing input.
- **Secret names have one authoritative home, and every other occurrence is anchored to it by test.**

  Rev 1 stated the rule as *"No secret name in more than one file"*, illustrated with `MIMO_API_KEY`
  appearing in `ci.yml` (×4), `_deploy-component.yml` (×3), `deploy.yml` (×2) and
  `agent-eval-nightly.yml`. **The rule as written is structurally unsatisfiable in the target
  architecture**, and shipping it would have produced a check whose only possible resolution is to
  disable it. The constraint chain:

  1. [cited] Composite actions cannot read the `secrets` context ⇒ every secret arrives as an `input`.
  2. [cited] `with:` keys are static — there is no expansion of a *list of names* into `with:` entries.
  3. [cited] `on.workflow_call.secrets:` keys are likewise static.
  4. The only dynamic path is `secrets: inherit` + `toJSON(secrets)`, which flattens every repository
     **and environment** secret into one process's environment — precisely the shape `zizmor` flags
     (§6.3), and a direct violation of least privilege for an atom that needs one token.

  ⇒ a secret name will appear in **at least two** places by construction: the caller's
  `secrets:`/`with:` mapping and the callee's `on.workflow_call.secrets:` declaration. The rule is
  therefore restated:

  > **Authoritative home = `reusable-worker-deploy.yml`'s `on.workflow_call.secrets:` block.**
  > Every other occurrence — caller mapping, atom `inputs:`, `<pkg>/deploy.config.json` — is a
  > *projection*, and the `secret-declaration` check (§6.4) asserts each projection equals the home.

  **Why the reusable workflow and not `deploy.config.json`.** The `workflow_call` block is the only
  one of the two that **GitHub itself parses and enforces at run time**: a wrong name there fails the
  run without any test being involved. A wrong name in a JSON file fails only if someone wrote a test.
  Put the authority where the runtime already checks, and make the JSON the derived copy.

  **Consequence, and it is what stops `deploy.config.json` becoming the ninth hand-maintained list:**
  `deploy.config.json` carries **no secret names of its own**. It carries *policy* keyed by names it
  does not define — which declared secrets are worker secrets vs post-deploy secrets, plus build
  filter, Pulumi stack, working directory, and smoke assertions. `secret-declaration` fails on any key
  in the JSON with no counterpart in the authoritative block, in either direction.

  **This whole design is contingent on Phase −1 spike 1.** Until that spike reports, §5.5's "eight
  lists become one" and AC-5.6 are **proposals, not commitments**, and no phase may be scheduled
  against them.

- **Explicit `permissions:` on every workflow**, default `contents: read`. Unchanged from
  `.claude/rules/ci.md`; already largely honoured.
- **Comments state invariants, not incident history.** The base tree carries ~700 lines of incident
  narrative in YAML comments (`_deploy-component.yml:86-134` is a single 49-line comment). Move the
  history to the issue and to `docs/ops/deployment.md`; keep the one-line invariant. This serves the
  standing "stale comments fool reviewers" lesson directly — §2.4 found three comments asserting a
  fact the code contradicts, **and found this spec doing the same thing**. **A fact worth keeping is
  worth asserting in a test.**

---

## 5. The hard questions

### 5.1 D1 — Delete the `changes` job? **Yes. And the replacement is not what the brief assumed.**

**Decision.**

| Event | Filtering | Why |
|---|---|---|
| `on: pull_request` | **No `paths:` filter. No job-level `if:`. Every package lane runs on every PR.** | Only an always-running workflow produces an always-reporting check. Both skip mechanisms are unusable as gates (§2.2): `paths:`-skipped ⇒ Pending forever ⇒ docs-only PRs can never merge; `if:`-skipped ⇒ reports success ⇒ incident #3. |
| `on: push` (to `main`) | **Native `on.push.paths`** | This is the deploy trigger, where affected-only genuinely matters and where "didn't run" is the correct outcome. No required-check semantics apply to a push. |

**Why #490 becomes structurally impossible.** Native path filtering is evaluated by GitHub *before
a run is created*: no runner, no `actions/checkout`, no `fetch-depth`, no token, no `git`, and
therefore no exit code to be 128. The failure mode of #490 — "the job whose job it is to decide what
runs, failed" — has nowhere to live, because deciding what runs is no longer a job. And with no
`changes` job, nothing `needs:` a decision job, so no single failure can skip eight deploys.

**Why `main`'s red is NOT fixed by this alone.** Moving to native `paths:` does not connect a
test to the files it reads. If `test_deploy_model_env_consistency.py` merely moved into a workflow
with a hand-written `paths:` list, the identical bug recurs the next time someone adds a file it
reads — as `#501` did, adding `Dockerfile` to its read set between rev 1 and rev 2 of this spec. The
actual fix is a new invariant:

> **Read-set ⊆ trigger-set.** Every config-consistency check declares the set of files it reads.
> A meta-test asserts that, for each check, every declared read path is matched by the `paths:`
> filter of the workflow that runs it — or that the owning workflow has no filter at all.

Mechanically: each check in the new `ci/` package exports `reads: string[]` alongside its
assertions; `meta.yml` runs a test that parses `.github/workflows/*.yml` with a real YAML library,
resolves which workflow owns each check, and fails on any uncovered path. The asymmetry is the
point: a trigger broader than the read set is merely wasteful; a trigger narrower than the read set
is **invisible**. (Its residual weakness — `reads:` is self-declared — is stated and not mitigated;
see §6.4's "Residual risk".)

**`meta.yml` itself carries no `paths:` filter on either event.** It is cheap — it reads files, it
does not install or build — and it is the one lane that must never be skipped, because it is the
lane that proves every other lane is wired correctly. It must also be **hermetic** (§5.1.1): no
secret, therefore runnable on every fork and Dependabot PR, therefore eligible to be required.

**Cost, accepted.** Running every lane on every PR costs runner minutes. Measured against a PR that
changes `wrangler.toml` merging green because the only test that could catch it was filtered out —
which is what happened — the trade is obvious. The mitigation is caching (already in place via
`actions/setup-node` `cache: pnpm`), not filtering. If cost becomes real, the correct lever is
`pnpm --filter '...[origin/main]'` or `turbo run --affected` **inside an always-running job** —
which short-circuits the *work* while still reporting a *conclusion* — never a filter that
suppresses the check itself. (Note the standard trap if that lever is pulled: those tools need
`fetch-depth: 0`, or a shallow checkout silently degrades to "everything changed" — fail-open, so
it costs money rather than correctness.)

**Rejected: native `paths:` on `pull_request` too.** Rejected because a path-filtered workflow
produces **no check run at all**, and a required check that never appears sits Pending forever
(§2.2). GitHub's own guidance is *"avoid requiring workflows that can be skipped."* The documented
workaround — a twin no-op workflow with inverse `paths-ignore:` and an identical job name, per
package — is ten files of pure ceremony.

**Rejected: keeping a `changes` job with an aggregator gate.** The Pantsbuild pattern (a single
required job that `needs:` all real jobs and inspects `needs.*.result`) does work, and would be the
right answer at 15+ packages. Rejected here because it reinstates the single point of failure from
#490 for a saving this repo does not yet need — and because the aggregator has its own trap: a
`needs:` on a *skipped* job succeeds by default, so a naive aggregator is a green light that means
nothing. That is incident #3 rebuilt one layer up.

**Merge queues: out of scope, and note why.** `paths:` filtering **does not work for `merge_group`**
([community #45899](https://github.com/community/community/discussions/45899)) — the queue branch
won't match a filter the PR matched. If a merge queue is ever adopted, native `paths:` comes off the
table and the aggregator pattern becomes mandatory. Flagged so the decision is made knowingly.

**Bonus fix.** `contract-openapi-drift` (`ci.yml:127`) lacks the `github.event_name !=
'pull_request' ||` prefix every sibling lane has, so it is PR-only by construction and never runs on
push or dispatch. Under D1 it becomes a normal always-running lane and this class disappears.

### 5.1.1 The public-repo corollary: **lanes that need secrets cannot be required**

[measured: `gh repo view lifeodyssey/animichi --json visibility` → `PUBLIC`]

D1 says every lane runs on every PR. That is achievable *as a gate* only for lanes that need no
credential. [cited] GitHub does not pass repository or environment secrets to a workflow triggered
by a `pull_request` from a **fork**, and `GITHUB_TOKEN` is read-only there. [cited] Dependabot-
authored PRs run in the `dependabot` actor context and see only the **Dependabot secrets** store, not
Actions secrets. AC-4.8 expands Dependabot from 3 ecosystems to 8, so this stops being hypothetical
the day Phase 4 lands.

Two lanes in this spec need credentials on a PR: `infra`'s `pulumi preview` (AC-4.4 — needs
`PULUMI_ACCESS_TOKEN`/backend plus `CLOUDFLARE_API_TOKEN`) and any atom self-test running outside
`dry_run`. Rev 1 declared both "every lane runs on every PR" and "`infra`'s PR lane runs `pulumi
preview`" and "Phase 5 makes lanes required" — three statements that cannot all hold on a public
repo. Left as written, **Phase 5 would have made every Dependabot PR and every external contribution
permanently unmergeable** — the same deadlock shape that forced the `pull_request` rule to be deleted
today (§2.1), rebuilt one layer down.

**Decision — every package's PR surface splits into two named lanes.**

| Lane | Check-name shape | Needs secrets | Runs on fork / Dependabot PRs | Eligible for `required_status_checks` |
|---|---|---|---|---|
| Hermetic | `<pkg> / ci` | no | yes, fully | **yes** |
| Credentialed | `<pkg> / ci-credentialed` | yes | runs, self-reports "not applicable" | **no — forbidden** |

`infra`'s `tsc --noEmit` and oxlint stay hermetic; only `pulumi preview` moves to the credentialed
lane. `meta.yml`, which carries the checks this whole design rests on, is hermetic by construction.

**How a credentialed lane ends without `continue-on-error` and without a false green.** AC-1.7
forbids `continue-on-error`, correctly — it is the exit this repo has repeatedly been burned for
taking. The mechanism instead is an explicit, reported, in-band decision:

1. The job's first step evaluates secret **availability**, not value: `if: ${{ secrets.X != '' }}`
   is legal — the value is masked in logs, the emptiness is testable — and writes an output.
2. Every subsequent step carries `if: steps.creds.outputs.available == 'true'`.
3. A final step with `if: always()` writes to `GITHUB_STEP_SUMMARY` **why** the lane did not execute,
   naming the trigger (`fork PR` / `dependabot`) and the missing secret, and exits 0.

The job therefore concludes **success with a recorded reason**. It is distinguishable from incident
#3 in the way that matters: the job **ran, evaluated a stated condition, and reported the outcome in
the run**, and the condition is a fact about the *trigger* (`secrets == empty`) rather than about
whether anyone remembered to maintain a filter. A `skipped` job says nothing; this says
"not applicable, here is the proof".

**And the credentialed lane must never enter the required set.** A sibling of `single-door`:

> **`required-set-is-hermetic`.** No workflow job that references `secrets.*` (other than
> `GITHUB_TOKEN`) may carry a job/check name that appears in the `protect main` ruleset's
> `required_status_checks`. The check reads the live ruleset via `gh api` and cross-references the
> workflow tree.

Without it, Phase 5d is a foot-gun with a delay fuse: nothing goes wrong until the first Dependabot
PR, at which point the repo is unmergeable again and `bypass_actors: []` (§2.1) means it cannot be
clicked past.

**Rejected: `pull_request_target`.** It supplies secrets to fork PRs by running the *base* ref's
workflow with write permissions in the presence of untrusted head code. It is the most-exploited
GHA misconfiguration in the wild and `zizmor` flags it by default (§6.3). Not available at any price.

**Open consequence for AC-4.7.** "On `pull_request`, every package lane produces a check run
regardless of which files changed" remains true, but "produces a check run" now means *hermetic lanes
produce a meaningful conclusion; credentialed lanes produce a recorded not-applicable*. AC-4.7 is
split accordingly (§8).

### 5.2 D2 — Cross-package dependencies: **duplicate the paths, and test the duplication.**

The problem exists only on the **push/deploy** side, because on the PR side (D1) nothing is
filtered. On push, a change to `packages/contract/**` must redeploy `catalog`, `users`, and `web`.

**Decision.** Each caller lists its internal dependencies' directories in its own `paths:` —
exactly what the `dorny` filters already do (`ci.yml:71-73`). The duplication stays, but stops being
hand-maintained:

> **Dependency-closure test.** A `ci/` check reads each package's `package.json` (and
> `apps/agent/pyproject.toml`), computes the transitive set of internal workspace dependencies, and
> asserts each caller's `on.push.paths` includes every one of those packages' directories.

So `packages/contract/**` appearing in several `paths:` lists becomes *generated-checked* duplication
rather than remembered duplication. Adding a shared package and forgetting three consumers becomes
a red `meta.yml` on the PR that introduces it.

Under §5.3's revised ownership, the heaviest consumer of this check is **`deploy-staging.yml`**,
whose `paths:` is the *union* of every deployable package's closure. That is the single most
drift-prone `paths:` list in the repo, which is the argument for the check rather than against the
consolidation.

**Trade-off, stated plainly.** A reviewer scanning `web.yml` sees paths that have nothing to do with
`apps/web`. Accepted, because the alternatives are worse:

| Alternative | Why rejected |
|---|---|
| Central orchestrator with `dorny/paths-filter` | Reinstates #490's single point of failure. The whole point of D1 is that no job decides what runs. Community consensus puts this at the 2-3-package scale. |
| `turbo --affected` / `nx affected` in a decision job | Same failure shape, plus a build-system this repo doesn't have. `turbo --affected` is genuinely "the sweet spot" at 5-15 TS packages — but this repo is **polyglot**, and no graph tool models the `packages/contract` → `apps/agent` edge. That edge must be a hand-written path regardless, so the graph tool buys a partial answer at full cost. Correct as a *cost* lever inside a job (§5.1), not as a gate. |
| `workflow_run` fan-out | See §5.3 — wrong tool. |
| One shared `paths:` list, `include:`d | GHA has no include mechanism for `on:`. Would require generating workflows — trading checked duplication for an unchecked generator. |

**Second-order benefit.** The same machinery answers incident #5 (§5.5).

### 5.3 D3 — Deploy order: **who owns the deploy, and why `needs:` is the wrong way to say "after"**

#### 5.3.0 Prior question, and rev 1 got it wrong: whose workflow owns the deploy?

Rev 1 assigned every package a caller with `on.push.paths` **and** a deploy job (§4.1), while
§5.3/§5.4.3 simultaneously required `catalog → users → root` to run as consecutive steps **in one
job**. **These cannot both hold.**

[cited] `needs:` is scoped to jobs *within a single workflow run*. A push touching, say,
`packages/contract/**` and `worker/**` matches the `paths:` of three callers and produces **three
independent workflow runs**. Across runs there is no ordering primitive at all:

- `needs:` does not cross runs.
- `concurrency:` can only **queue or cancel**. A queued run is admitted in arrival order, not in a
  declared order, and `cancel-in-progress` would *drop* one of the three rather than sequence it.
- `workflow_run` is disqualified on five independent grounds (below).

So the ordering guarantee evaporates in exactly the scenario that motivates it: a shared-contract
change touching several services at once. Rev 1's own §5.2 chose "consumer lists its dependencies'
paths" precisely so that this multi-trigger case is **common**, not rare.

**Decision — CI belongs to the package; deploy belongs to the environment.**

| Concern | Owner | Trigger |
|---|---|---|
| lint / typecheck / test / build of one package | `<package>.yml` | `pull_request` (unfiltered, §5.1) + `push` with native `paths:` |
| deploying **one environment's whole Worker set, in declared order** | `deploy-staging.yml` — one file | `push` to `main`, `paths:` = the union of all deployable packages' closures |
| deploying production | `deploy-production.yml` — one file | `workflow_dispatch` only |

**No package caller contains a deploy job.** This preserves the owner's directive —
「前后端 infra agent 都应该有自己的 pipeline」— in the sense that carries the value: each package owns
its own gate, its own triggers, its own failure signal, and its own dependency surface, and adding a
package no longer means editing a centre. What stays central is the one thing that is genuinely
global and cannot be otherwise: **ordering within an environment**.

**Note that production already had this shape.** §5.4's decision 2 states production has exactly one
caller. Rev 1 applied that reasoning to production and not to staging with no stated reason for the
asymmetry, and there is none — staging deploys the same ordered Worker set with the same binding
topology and the same failure semantics. Symmetry restored.

**Rejected: `root.yml` owns the whole sequence with a union `paths:`.** It works, but it means a file
called `root` deploys catalog and users, and a catalog-only change runs a workflow named for a
different package. That is `ci.yml`'s disease with a smaller blast radius and a more misleading name.

#### 5.3.1 Within the deploy job: ordering is steps, not `needs:`

**Verified (§2.4):** the `catalog → root` and `users → root` dependency is a genuine **runtime**
dependency — root reaches both only via service bindings, and neither declares a route in any
environment. Whether it is also a **build-time** dependency is **[unverified]** by Cloudflare's
docs, by the vendored wrangler CLI, or by any incident record; the three in-repo claims are unsourced
prose. `web` is genuinely independent.

**Stop conflating the two meanings of `needs:`.**

1. **Validation dependency** — "do not deploy X unless Y's tests passed". Legitimate `needs:`.
2. **Ordering constraint** — "X's `wrangler deploy` must run after Y's". Currently expressed with
   the same `needs:` (`ci.yml:428`), which is why a catalog `Pulumi up` failure *skips* root and
   users rather than merely delaying them — and skips read as success (§2.2). This is incident #4.

Ordering that is genuinely required is expressed **as sequential steps inside one job**, never as a
cross-workflow `needs:`. Concretely, `reusable-worker-deploy.yml` deploys one *environment's* set of
Workers in one job, in declared order: `catalog → users → root`, with `web` in a parallel job since
it has no bindings. A catalog failure then **fails** the job (red, blocking) instead of silently
skipping root.

This also solves an approval problem (§5.4): one gated job ⇒ **one** approval prompt.

#### 5.3.2 Consequence: re-runs replay the whole sequence, so every step must be idempotent

Putting the order inside one job means GitHub's only retry unit — "Re-run failed jobs" — replays the
**entire ordered sequence**, including every step that already succeeded before the failure. Rev 1
did not state this, and three atoms are not obviously safe under replay:

| Atom | Replay hazard | Required property |
|---|---|---|
| `atlas-migrate` | re-applying migrations already applied | Atlas's revision table makes this a no-op — **assert it**, don't assume it (AC-3.6) |
| `pulumi-snapshot` + `pulumi-apply` | a re-run after a partial `up` retakes the snapshot, so the "rollback backup" is now the **post-failure** state — the rollback target is destroyed by the act of retrying | snapshot is keyed to the run and **never overwritten** for the same target state; `up` is convergent by nature but must be verified against a partially-applied stack (AC-3.7) |
| `worker-secrets-put` | re-pushing 9-11 secrets | `wrangler secret put` is last-write-wins; the hazard is partial completion leaving a mixed generation. Push must be all-or-report (AC-3.8) |

The `pulumi-snapshot` case is the one that can actually lose data and is the reason §4.2 splits
`pulumi-install` / `pulumi-snapshot` / `pulumi-apply` into three atoms rather than rev 1's two
overlapping ones.

**Empirical resolution required.** AC-3.5 settles the build-time question during Phase 3 by
deploying root into a scratch environment with no catalog present and recording the result. If it
turns out to be runtime-only, the ordering is *still* kept — `post-deploy-assert.sh catalog-probe`
(`_post-deploy-test.yml:144`) asserts the edge→CATALOG→Neon round-trip and would fail on the
reverse order — but the reason is then documented as fact rather than folklore, and the comment
that says so becomes testable.

**Explicitly rejected: `workflow_run` chaining.** [cited] Disqualified on five independent grounds:
`GITHUB_SHA`/`GITHUB_REF` default to the **default branch**, not the triggering commit (so a bare
checkout gets `main`); the workflow file *"will only trigger… if it exists on the default branch"*
(so you cannot test a change to it from a PR); runs do **not** appear in the PR checks list and
cannot be required status checks; it *"is able to access secrets and write tokens, even if the
previous workflow was not"* (a privilege-escalation surface `zizmor` flags); and it chains at most
three levels. Latency is undocumented and unquantified. It is a notification mechanism, not a
dependency mechanism.

### 5.4 D4 — The production approval gate: **one door, one prompt, and a test that there is only one.**

**What must be preserved:** the `production` environment's `required_reviewers` protection
([measured], §2.3). [cited] GitHub docs are unambiguous that the gate is on the **job**: *"A job that
references an environment must follow any protection rules for the environment before running or
accessing the environment's secrets."* Jobs that do **not** declare `environment:` are completely
ungated — the classic misconfiguration is gating the `deploy` job while a sibling job holding the
same credentials runs unguarded.

**What must NOT be over-claimed:** [measured] `prevent_self_review: false` and the sole reviewer is
the sole maintainer. The gate stops side effects until a human clicks; it does not constitute review
by a second party. Every AC and every doc sentence about this gate is worded to claim only the former.

**Decision.**

1. **`reusable-worker-deploy.yml`'s deploy job declares `environment: ${{ inputs.environment }}`
   — and it is the only `environment:` declaration for a deploy anywhere in the repo.** The
   approval gate becomes a property of the *capability*, so a caller physically cannot deploy without
   passing through it. (The expression form is required: `on.workflow_call` has no `environment` key,
   so the caller cannot choose. This is the documented pattern, and #527/#528 already proved
   empirically that environment-scoped secrets resolve correctly through it.)
2. **Production has exactly one caller: `deploy-production.yml`; staging has exactly one:
   `deploy-staging.yml`** (§5.3.0). No package caller may name either.
3. **One gated job for all of production.** [cited] GitHub raises a **separate approval prompt per
   environment-gated job** — a caller fanning out to four gated reusable calls yields four prompts
   ([community #50908](https://github.com/orgs/community/discussions/50908)). Combined with §5.3.1's
   sequential-steps decision, production deploys as **one job, one prompt, ordered steps**. This is
   not merely ergonomic: approval fatigue is how a reviewer starts clicking through without reading —
   and with `prevent_self_review: false`, the clicking reviewer is the person who wants the deploy.
4. **`deploy-production.yml` accepts one input: a commit SHA already deployed to staging and green
   through `reusable-post-deploy.yml`** — and it *verifies* this against the staging deployment
   record rather than trusting the input. This is the guard `deploy.yml` lacks (§2.3): it closes
   "production from any ref, with no tests, skipping staging".
5. **Add a deployment branch policy** to the `production` environment restricting it to `main`
   ([measured] `deployment_branch_policy: null` today, so this is genuinely undone), and **disable
   `can_admins_bypass`** on both environments ([measured] `true` today) — or record in
   `docs/ops/deployment.md` why it stays on. Both are repo-settings changes, §10.
6. **`deploy.yml` is deleted.** Its manual-hotfix use case is served by `deploy-production.yml`'s
   `workflow_dispatch`, which now carries the same preflight code (one copy) *and* the
   staging-provenance check.
7. **Enforced by test, not convention:**
   > **Single-door test.** A `ci/` check parses every workflow and asserts: (a) every job that
   > invokes the `wrangler-deploy` atom, directly or via a reusable workflow, declares
   > `environment:`; (b) no `environment:` for a deploy is declared outside
   > `reusable-worker-deploy.yml`; (c) no workflow other than `deploy-production.yml` passes
   > `production` into it, and none other than `deploy-staging.yml` passes `staging`; (d) every
   > production-reaching job has an explicit event guard of its own and does not rely on
   > skip-propagation (§2.3's second bypass); (e) **no package caller declares a deploy job at all**
   > (§5.3.0).
   >
   > **`required-set-is-hermetic`** (§5.1.1) is its sibling and lands in the same PR.

Clause (d) matters as much as the others: today the production jobs are kept off `workflow_dispatch`
only by a chain of skips, and `always()` anywhere in that chain reopens the path.

**Branch protection is a two-step repo-settings change, not one (§2.1).** Rev 1 said "add
`required_status_checks` to the `protect main` ruleset". Since the `pull_request` rule was deleted
today, `required_status_checks` — itself PR-scoped — would be **inert** if added alone. The full
ordered sequence, its preconditions, and its failure modes are tabulated in §7.3 Phase 5.

### 5.5 Killing incident #5 (list-shaped conflicts)

The duplication surface is larger than rev 1 measured. A model/env change today must land in:

1. root `wrangler.toml` — `[vars]`, `[env.production.vars]`, `[env.staging.vars]` (**×3**, and they
   already differ: `ANON_ACCESS_ENABLED` is `"true"`/`"true"`/`"false"`; staging alone carries
   `CORS_ALLOWED_ORIGIN`);
2. `worker/containerEnv.ts:14-31` — `CONTAINER_ENV_KEYS` forwarding allowlist;
3. `ci.yml` `worker_secrets:` — **×6, not ×2** [measured: `:377, :416, :448, :500, :537, :558` — one
   per deploy call site, staging + production for catalog / users / root. The catalog pair is the
   single-name form `worker_secrets: DATABASE_URL`; the other four are block lists; the root staging
   and production lists **differ** (9+2 vs 10+2). Rev 1 counted only the two root lists];
4. `deploy.yml:207+` — the manual path's list;
5. `_deploy-component.yml:21-63` — the `secrets:` passthrough **plus** the `env:` map of the
   post-deploy push step (`:15-19` documents the three-place rule in prose);
6. `workers/catalog/wrangler.toml` and `workers/users/wrangler.toml` — `ENVIRONMENT` ×3 each; **and,
   per §2.4.1, the places where `workers_dev` is *absent* are as load-bearing as where it is
   present** — a duplication surface made of silence, which no diff shows and no reviewer sees;
7. **`Dockerfile`** [measured] — the container's build-arg / `ENV` surface, and the **fifth** file
   read by `test_deploy_model_env_consistency.py`. Rev 1 omitted it from this list *and* from §6.4's
   read-set column, describing that test as reading four files;
8. **Two competing wrangler configurations for the same frontend** [measured, issue #537] — root
   `wrangler.toml` (Worker `animichi`, `main = worker/entry.ts`, routes `animichi.com/*`, three
   `[assets] directory = ".open-next/assets"` blocks) and `frontend/wrangler.jsonc` (Worker
   `animichi-frontend`, `main = ".open-next/worker.js"`, the same relative assets path). Relative to
   `frontend/`, the sub-config's paths are correct; the root file has them pasted in **one directory
   too high**. Nothing in the repo asserts that a Worker name is claimed by exactly one config, or
   that a declared asset directory is produced by the declared build.

> [measured] `#501` moved items **1, 2 and 7** between rev 1's base and rev 2's, in the ~6 hours
> between two revisions of this document. That is the strongest available evidence that this list is
> the live cost centre, not a historical grievance.

**Decision.** Each deployable package gets one declaration file — `<pkg>/deploy.config.json` —
holding **policy**: which declared secrets are worker secrets vs post-deploy secrets, build filter,
Pulumi stack, working directory, expected build outputs, and smoke assertions (replacing the
`case "$COMPONENT"` switch). Per §4.3 it holds **no authoritative secret names**; those live in
`reusable-worker-deploy.yml`'s `on.workflow_call.secrets:` block, and the JSON's keys are asserted
against it in both directions. The caller passes a path; the reusable workflow reads the file and
expands it into the `with:` inputs the atoms need (§4.2). Plus:

> **Secret-declaration test.** A `ci/` check asserts every secret key referenced in a package's
> `deploy.config.json` exists in the authoritative `workflow_call.secrets:` block and is reachable at
> deploy time, that no key in the authoritative block is unreferenced, and that no secret name is
> introduced anywhere else in `.github/`.

> **Wrangler-config-contract test** (§6.4) — the new one, and the one that catches items 6 and 8
> statically.

The existing `test_ci_root_deploys_match_manual_root_secrets` covers exactly one of these eight seams
today. Nothing covers the `wrangler.toml` ×3 `[vars]` triplication, nothing covers the `Dockerfile`
edge, and nothing covers the two-configs collision.

**Contingency, restated.** The consolidation described here — "eight lists become one" — is
**contingent on Phase −1 spike 1** (§4.3). If name→value binding turns out to require
`toJSON(secrets)`, the consolidation shrinks to policy-only and the secret lists remain duplicated
but test-anchored. That is a worse outcome, not a fatal one, and it must be *known* before Phase 0
schedules work against it.

---

## 6. Testing the pipeline ("GHA 的测试")

Four tiers, each with a stated remit **and a stated limit**.

### 6.1 Tier 1 — Shell unit tests (fastest, runs anywhere) · `unit`

All non-trivial logic lives in `.github/scripts/<verb>.sh` with a sibling `<verb>.test.sh`. The
template exists and is good: `post-deploy-assert.test.sh` drives the real script against a
throwaway Python mock server and asserts on **request counts and exit codes, never elapsed time**
(`post-deploy-assert.test.sh:9-21`) — this repo's "mock the clock" rule, correctly applied. Every
new script adopts it verbatim, with `shellcheck` alongside.

Covers: the `ANON_ACCESS_ENABLED` TOML parser's fail-closed behaviour, URL resolution, retry/backoff
semantics, secret-list iteration, `deploy.config.json` expansion.

The design principle behind this tier: *push logic out of inline `run:` blocks into testable scripts,
because composite actions are essentially shell scripts split into multiple steps and are notoriously
difficult to test correctly.* The action YAML then becomes thin wiring with little left to test.

### 6.2 Tier 2 — Composite action tests · `integration`

There is **no official GitHub mechanism** for unit-testing a composite action. The established
pattern is a self-test workflow in the same repo: `meta-actions.yml` invokes each atom with fixture
inputs, gives the step an `id`, and asserts on `steps.<id>.outputs.*` in a following step, failing
the job on mismatch — data-driven via a matrix of fixture cases.

Every side-effecting atom (`wrangler-deploy`, `atlas-migrate`, `pulumi-apply`, `pulumi-snapshot`,
`worker-secrets-put`) must therefore support a `dry_run` input. This is the AC-bearing test for "an
atom is independently testable", and it is what makes the composite layer worth having.

Runs on GitHub, because composite input defaulting, `shell:` resolution, and nested-action path
resolution are GitHub semantics no local emulator reproduces faithfully.

Per §5.1.1, `meta-actions.yml` in its `dry_run` form is **hermetic** and stays that way; any variant
needing a real token is a credentialed lane and is not required.

### 6.3 Tier 3 — Static analysis · `unit`

Both already exist in `_security.yml` and move into `meta.yml` (Phase 1b), both blocking:

- **`actionlint`** (1.7.7, `_security.yml:85-102`) — YAML/expression syntax, **expression
  type-checking**, `runs-on` label validity, glob validation for branch/path filters, shellcheck
  over `run:` blocks, and — highest value for a three-layer design — **validation of inputs for
  actions *and reusable workflows***. It catches a typo'd reusable input or a
  `needs.foo.outputs.bar` that doesn't exist, which is the dominant failure class when splitting a
  monolith into layers. Must lint `.github/actions/**` as well as `.github/workflows/**`.
- **`zizmor`** (`_security.yml:68-83`) — a different class entirely: template injection into
  `run:`, credential persistence/leakage into artifacts, excessive `permissions:`, impostor commits
  and confusable git refs, unpinned `uses:`, dangerous triggers (`pull_request_target`,
  `workflow_run`), cache poisoning. `.claude/rules/ci.md`'s SHA-pinning rule gets enforced here
  rather than by review. **It is also the tool that will object to `toJSON(secrets)`** if Phase −1
  spike 1 finds no alternative — treat its verdict there as a design input, not a nuisance.

They are complements, not alternatives. Neither is warn-only.

### 6.4 Tier 4 — Config-consistency tests · `unit` — the direct fix for the `main` red

**This is not one broken test. It is eight.** Every config-as-data test in the repo, with the lane
that runs it and whether its trigger covers what it reads:

| Test | Reads as data | Lane | Verdict |
|---|---|---|---|
| `apps/agent/agent/tests/unit/test_deploy_model_env_consistency.py:13-19` | `worker/containerEnv.ts`, `ci.yml`, `deploy.yml`, `_deploy-component.yml`, **`Dockerfile`** | `ci-agent` | **mismatch — 0 of 5 inputs covered** ([measured]; rev 1 said 4) |
| `…/test_ci_eval_gate_workflow.py:17-19` | `ci.yml`, `agent-eval-nightly.yml` | `ci-agent` | **mismatch** |
| `…/test_purge_workflow_trigger.py:18-21` | `purge-anonymous-sessions.yml` | `ci-agent` | **mismatch** |
| `…/test_anonymous_docs_consistency.py:19-20` | `docs/ARCHITECTURE.md`, `worker/auth.ts` | `ci-agent` | **mismatch** |
| `…/test_neon_script_security.py:7-8` | `scripts/neon-test-base.sh` | `ci-agent` | **mismatch** |
| `apps/web/tests/unit/lockfile-pin.test.ts:21` | `.github/actions/setup/action.yml` | `ci-web` (`web: ['apps/web/**']`) | **mismatch** |
| `packages/contract/test/anon-limits.test.ts:12,25` | `worker/costBreaker.ts` | **none** | **never runs at all** |
| `worker/containerEnv.test.ts`, `worker/entry.test.ts:236` | vendored container.js; `wrangler.toml` wiring | `ci-worker` (`worker: ['worker/**']`) | covered |
| `frontend/tests/design-token-alignment.test.ts` etc. | `app/globals.css`, `animal-island-ui` CSS | `ci-frontend` | covered |
| `.github/scripts/post-deploy-assert.test.sh` | its own script | `security` (no filter) | covered — **because it has no filter** |
| `workers/catalog/test/wrangler-private.worker.test.ts` (PR #539, **open**) | `workers/catalog/wrangler.toml` | catalog worker pool | **covered but fragile** — see the trap below |

Six mismatches and one orphan. The one incumbent test that is reliably covered is the one whose lane
has no path filter at all — which is the empirical argument for §5.1's `meta.yml` rule.

**Home:** a new top-level `ci/` package with its own `AGENTS.md`/`CLAUDE.md` per
`docs/DOCS_POLICY.md`, run by `meta.yml` (no `paths:` filter, no credentials, no skippable pool).

**Language: TypeScript + vitest.** Stated as a trade-off. The incumbent tests are Python and would
be rewritten. But their *subject* is `wrangler.toml`, `wrangler.jsonc`, `.github/workflows/*.yml`,
`.github/actions/*/action.yml`, `Dockerfile`, and `package.json` — overwhelmingly TS-ecosystem
config — and every other package already runs vitest. Standing up a second uv project solely to host
config assertions is more machinery than porting ~400 lines of assertions. **They must also be
rewritten to use a real YAML/TOML parser**: the incumbent regex-parses workflows
(`_named_workflow_step(deploy, "Deploy via Wrangler")` [measured]), so it silently breaks when a step
is renamed — a config-consistency test that is itself sensitive to formatting. If the owner prefers
Python, the only change is that `ci/` becomes a uv project; nothing else in this spec depends on the
choice.

Checks it owns:

| Check | Asserts | Answers |
|---|---|---|
| `read-set ⊆ trigger-set` | every check's declared `reads` is covered by its owning workflow's `paths:` | the `main` red, structurally |
| `dependency-closure` | each caller's `on.push.paths` covers its transitive internal deps | §5.2 |
| `single-door` | only `reusable-worker-deploy.yml` declares a deploy `environment:`; only the two environment callers pass an environment in; no production job relies on skip-propagation; **no package caller has a deploy job** | §5.3.0, §5.4 |
| `required-set-is-hermetic` | no job referencing `secrets.*` carries a name in the live ruleset's `required_status_checks` | §5.1.1 |
| `secret-declaration` | `deploy.config.json` keys ↔ the authoritative `workflow_call.secrets:` block, both directions; no secret name introduced elsewhere | §4.3, §5.5 |
| `env-var-consistency` | port of `test_deploy_model_env_consistency.py` (all **five** inputs), extended to the `wrangler.toml` ×3 `[vars]` triplication that nothing covers today | §5.5 |
| **`wrangler-config-contract`** *(new at rev 2)* | (a) every deployable Worker **name**, including per-environment `name` overrides, is declared by exactly one wrangler config in the repo; (b) for each config, `main` and `assets.directory`, resolved relative to the `working_directory` the deploying workflow declares, exist among the outputs of the build command that workflow runs; (c) every environment declaring no `routes` declares `workers_dev` **explicitly**, whatever the value | **#537 and #539 (§2.4.1), statically** |
| `action-pinning` | every third-party `uses:` is a 40-hex SHA with a trailing `# vX.Y.Z` | `.claude/rules/ci.md` |
| `package-has-a-pipeline` | every workspace member + `infra` has exactly one caller workflow | §1.3 |
| `comment-claims` | comments asserting a checkable fact (e.g. "no public /catalog/* route") have a corresponding assertion | §2.4.3, §4.3 |

`package-has-a-pipeline` converts §1.3's three no-CI packages from a discovered bug into a
permanently checked invariant. `comment-claims` is deliberately narrow — it applies only to comments
carrying an explicit `@invariant` marker — but it is what stops §2.4.3's class of rot recurring.

#### Why `wrangler-config-contract` is the highest-value new check

#537 is this repo's most expensive class of failure: it was reachable **only** by pushing to `main`
and watching a real deploy fail, it burned a full cycle, and on the way it pushed 9 secrets to a
Worker that then failed to deploy. Yet **every fact needed to predict it is static text already in
the repository**:

```
ci.yml                  →  build_filter: frontend
_deploy-component.yml   →  pnpm --filter frontend build,  working_directory: "."
frontend/package.json   →  "build": "next build"
(Next.js)               →  output is frontend/.next
wrangler.toml ×3        →  [assets] directory = ".open-next/assets"
```

**No layer of §6's four tiers reads two of those files at once.** Tier 1 tests one script; Tier 2
tests one atom's inputs/outputs; Tier 3 checks syntax and security, not cross-file semantics; Tier 4
as rev 1 scoped it checked env-var and secret lists only. The gap is precisely "a build's declared
outputs versus a deploy's declared inputs", and it is the same gap that made #537 undiscoverable
until a real runner tried it.

Clause (c) is the §2.4.1 half: it converts **the absence of a line** — the thing rev 1 and both
reviewers got wrong — into a positive assertion that fails loudly.

#### Implementation pattern, and the trap it comes with

[measured: PR #539, `workers/catalog/test/wrangler-private.worker.test.ts`, **OPEN, not merged**]
The pattern: import the config with Vite's `?raw` suffix so it is **inlined at transform time** (the
workerd sandbox has no filesystem at run time), parse it as data, and assert on the parsed result.
`workers/catalog/test/raw-modules.d.ts` supplies the module declaration. Rev 2 adopts this verbatim
for `ci/`.

That PR also records a warning this spec must obey:

> **Never put a config guard in a test pool that can be skipped wholesale.**
> Catalog's spike pool self-skips when Neon credentials are absent, so a guard placed there would
> vanish silently in exactly the environments that most need it — most obviously on fork and
> Dependabot PRs (§5.1.1). That is incident #3 wearing a vitest costume.

`ci/`'s checks therefore run in `meta.yml`, which by construction has no `paths:` filter, no
credential requirement, and no conditionally-skipped pool. **AC-1.8** asserts this as a property of
the `ci/` package rather than a habit: no test file under `ci/` may call `describe.skip`, `it.skip`,
or a runtime `skipIf` predicate.

#### Residual risk, stated and not mitigated

`read-set ⊆ trigger-set` is an **honour system**. A check declares its own `reads:`, and nothing
verifies that declaration against what the code actually opens. A check that grows a new
`readFileSync` without updating `reads:` escapes the invariant silently — which is **the same failure
shape as today's**, relocated from "the trigger doesn't cover the reads" to "the declaration doesn't
cover the reads". Naming it does not fix it.

A stronger form exists: instrument `fs` during the `ci/` run, record every path actually opened per
check, and assert the recorded set equals the declared `reads:`. It is **explicitly deferred**, for
one reason worth stating rather than hiding: `reads:` is a single visible line at the top of a file a
reviewer is already reading, whereas an `fs` shim is machinery that can itself rot. That is a
judgement, not a proof. §10.8 asks the owner whether to take the stronger form now.

### 6.5 `act` — what it covers, and what it must never be trusted for

**Covers:** step ordering within a job, `run:` script logic, composite step wiring, `if:` evaluation
on non-secret contexts, matrix expansion. A fast local loop for Tier 1/2 development.

**Does not cover** — [cited] per [act's own "not supported" page](https://nektosact.com/not_supported.html),
and this list is not theoretical for this repo:

- **`environment:` secret scoping and environment protection rules.** Both are listed as
  unimplemented. **Proven here:** #527's original diagnosis assumed environment-secret resolution
  was broken, and only a real `workflow_dispatch` run against staging settled it
  (`_deploy-component.yml:74-84`) — at the cost of two throwaway `diag(527)` workflows committed to a
  branch (§2.5). `act` cannot validate D4 at all — not the gate, not the secret resolution, not the
  approval.
- **Job `permissions:`.** The two "Resource not accessible by integration" incidents
  (`ci.yml:31-36`, `_security.yml:16-19`) are exactly this class and are invisible to `act`.
- **Reusable-workflow resolution / `secrets: inherit` / caller→callee permission narrowing.** The
  `zizmor` `startup_failure` documented at `_security.yml:71-73` (a reusable job cannot request more
  than the caller grants) is not reproducible locally. `act`'s `workflow_call` support exists but its
  local-path and `secrets: inherit` semantics are unverified — **do not rely on it without testing.**
  This is directly why Phase −1 spike 1 must run on GitHub, not under `act`.
- **OIDC**, `concurrency`, `continue-on-error`, `timeout`, step summaries (`GITHUB_STEP_SUMMARY`
  values are *discarded* — note this breaks §5.1.1's reporting mechanism locally), annotations,
  artifact retention, `workflow_run`.
- **Path filtering** — `act` is invoked with an event, not a real push diff.
- **Fork/Dependabot secret redaction** — `act` has no model of it, so §5.1.1 cannot be validated
  locally at all.
- Runner fidelity: Linux only, Docker containers not VMs, and *"default images do not contain all
  the tools that GitHub Actions offers."*

**Rule:** `act` is a developer convenience. **No acceptance criterion in this spec may be discharged
by an `act` run.** Anything about secrets, environments, permissions, or triggers requires a real
GitHub run. (Also note [nektos/act#2196](https://github.com/nektos/act/issues/2196): the `.secrets`
file has been exposed to workflows — do not point it at real production credentials.)

### 6.6 Post-deploy assertions

`.github/scripts/post-deploy-assert.sh` is kept as-is and called from two places:

1. `reusable-worker-deploy.yml`'s per-component smoke step, driven by each package's
   `smoke_assertions` in `deploy.config.json` — replacing the `case "$COMPONENT"` switch at
   `_deploy-component.yml:584-614`, which is a §4.3 violation.
2. `reusable-post-deploy.yml`'s full environment suite, unchanged in content from
   `_post-deploy-test.yml:111-166`: web-landing, healthz, auth-probe, users-probe, catalog-probe,
   data-plane-probe, plus the environment-gated anon checks.

**New at rev 2 — an apex assertion.** [measured, issue #538] `animichi.com` has **no A, AAAA or
CNAME record** at the apex or at `www`; the zone is delegated to Cloudflare but empty. A Workers
route is not a DNS record — without a proxied record nothing reaches the edge, so the
`animichi.com/*` route has never fired, and `wrangler deploy` can report success while the domain
serves nothing. Rev 1's Phase 5 had **no AC asserting a production URL responds**, so it would have
concluded on "deploy green" against a hostname with no traffic. `post-deploy-assert.sh` gains an
`apex` assertion (§8, AC-3.9 / AC-5.11) that resolves and fetches the real public hostname for the
environment and asserts a 200 with expected content — not the `*.workers.dev` name.

Its own tests (`post-deploy-assert.test.sh`) run in `meta.yml` as Tier 1. The `suite` input's status
as an informational label only (`_post-deploy-test.yml:22-31`) is retained and made explicit in the
input description.

---

## 7. Migration path

### 7.1 The risk, stated plainly

**There is no known-good baseline.** The staging deploy chain has never completed for `root` or
`users` (§2.5). The usual refactoring safety net — "behaviour before and after must match" — is
unavailable, because the behaviour before is *unknown*, not merely untested. And per §2.1, `main`
has no enforcement that would stop a bad intermediate state from landing; "each phase leaves `main`
working" is currently author discipline, not a property of the repo.

### 7.2 Judgement: **the rebuild is the means to green, not something to do after green.**

Do **not** make the current pipeline green first.

1. **"Don't break what works" has no force here.** Nothing works. There is no behaviour to preserve
   — only a hypothesis about what 614 lines would do if they ever ran to completion.
2. **The monolith is *why* it is not green.** Twenty-one serial `.github/` commits (§2.5), four of
   them throwaway diagnostic workflows, is not bad luck; it is the arithmetic of a pipeline whose
   only execution path is a full push to `main`. Each bug costs one full cycle to find, **and can
   only be found after every preceding bug is fixed**. Making it green first means paying that cost N
   more times, then discarding the code that made it expensive.
3. **The atoms are individually reachable; the monolith is not.** The single highest-value change in
   this spec is that `atlas-migrate`, `pulumi-apply`, and `wrangler-deploy` become things a human can
   invoke and test in isolation, in seconds. That is a **prerequisite** for debugging the never-run
   path, not a reward for having debugged it.

**But sequence it so extraction is provably behaviour-preserving before the topology changes.** The
real risk of "rebuild while broken" is confusing a refactoring bug with a pre-existing bug. Phase 0
exists solely to eliminate that ambiguity — and Phase −1 exists because two of this spec's central
mechanisms are not yet known to be expressible.

### 7.3 Phases

Each phase is independently mergeable and aims to leave `main` releasable. (§7.1: that is currently
a discipline, not an enforcement, until Phase 5.)

#### Phase −1 — Two blocking spikes. No production code. *(new at rev 2)*

Nothing downstream is a commitment until both report.

1. **Secret name→value binding (§4.3).** On a scratch branch, build a minimal
   `caller → reusable → composite` chain and determine empirically which of these is expressible
   **without** `toJSON(secrets)`: (a) static `on.workflow_call.secrets:` + explicit caller `secrets:`
   mapping + explicit atom `with:`; (b) `secrets: inherit` with static callee declarations; (c) any
   form in which the *set* of secrets varies per component without the YAML varying. Record `zizmor`'s
   verdict on each. Must run on GitHub — `act` cannot model this (§6.5).
   *Exit:* §4.3's authoritative-home rule is confirmed or replaced; §5.5's consolidation is committed
   to or reduced to policy-only; AC-5.6 becomes a commitment or is struck.
2. **Ruleset `evaluate` enforcement on a user-owned repo (§2.1, [unverified]).** Set `protect main`
   to `enforcement: "evaluate"` via `gh api`, observe acceptance and UI reporting, restore.
   *Exit:* §9's "stage the ruleset in `evaluate` first" mitigation is real, or is replaced by
   "rehearse on a scratch repository first".

*Both spikes are throwaway. Neither lands code in `.github/`.*

#### Phase 0 — Extract atoms. No topology change.

Pull `_deploy-component.yml`'s 11 steps into composite actions + scripts (§4.2), with Tier 1 and
Tier 2 tests, **including the `wrangler-deploy` → `worker-secrets-put` ordering invariant** (AC-0.7).
`ci.yml` and `_deploy-component.yml` still exist and still orchestrate — they just call atoms now.
`_deploy-component.yml` drops from 614 lines to under 150.
*Exit:* `meta-actions.yml` green; step sequence unchanged by diff review, except the deliberate
secrets-after-deploy reordering, which is called out in the PR body as the one intentional
behavioural change.
*Risk:* lowest. *Payoff:* highest — failures become cheap to find from here on.

#### Phase 1a — `ci/` package: **one check per PR, paired with the defect it exposes.**

Create the `ci/` package and `meta.yml` with **a single check**, and land the fix for the defect that
check turns red **in the same PR**, and nothing else. Repeat, one PR per check, cheapest evidence
first:

| PR | Check | Paired defect(s) it must first turn red on |
|---|---|---|
| 1a.1 | `action-pinning` | (expected green — establishes the harness) |
| 1a.2 | `read-set ⊆ trigger-set` + AC-1.8 no-skip rule | the six mismatched triggers and the `packages/contract` orphan (§6.4) |
| 1a.3 | `env-var-consistency` (ported, real parsers, five inputs) | whatever the ×3 `[vars]` triplication is currently hiding |
| 1a.4 | `wrangler-config-contract` | **#537** (root assets path + two competing configs) and **#539** (catalog `workers_dev`) |
| 1a.5 | `package-has-a-pipeline` | `packages/contract`, `infra`, `e2e` have no lane (§1.3) |
| 1a.6 | `comment-claims` | the "no public `/catalog/*` route" comments (§2.4.3) |

*Why split from rev 1's single Phase 1:* rev 1 created a package, wrote eight checks, relocated
static analysis, fixed six latent defects and rescued an orphan test **in one step** — and its green
would have come from having changed the checks and the checked tree together. A check written against
the tree it is validating is trivially satisfiable by that tree; this repo has been burned by exactly
that shape (tests that passed for the wrong reason). One check + its defect per PR means **every
check has a failing state on record in its own diff before it has a passing one.**
*Exit, per PR:* the PR body links a run showing the check **red on the parent commit** and green on
the tip. That artefact is the deliverable, not the green tick.

#### Phase 1b — Relocate static analysis.

`actionlint` and `zizmor` move from `_security.yml` into `meta.yml`, configuration unchanged. Pure
relocation; no new findings expected. Any new finding is Phase-1a-shaped work and gets its own PR
rather than being folded in here.

#### Phase 2 — Prove one full deploy path end-to-end using the new atoms: `catalog` → staging.

Catalog is chosen as the *deepest* path (Pulumi + R2 state + Atlas/Neon + wrangler), exercising the
most atoms. Still driven by `ci.yml`. Includes landing **#539**'s `workers_dev` fix if it has not
merged by then (§2.4.1) — deploying catalog again while it is publicly readable is not acceptable.
*Exit:* **a real staging deploy of `catalog` completes green.** This is the first known-good baseline
the project has ever had; every later phase is measured against it.

#### Phase 3 — The never-run paths. **Blocked on a topology decision — now taken.**

`users` proceeds as rev 1 described. **`root` cannot**: rev 1's AC-3.2 ("root staging first ever
green") was **unreachable as written**. [measured, issue #537] `ci.yml` passes `build_filter:
frontend`; `_deploy-component.yml` runs `pnpm --filter frontend build`; `frontend/package.json` maps
`build` to `next build`, which emits `frontend/.next`. `.open-next` is produced only by
`opennextjs-cloudflare build`, which no workflow invokes. And root `wrangler.toml`'s three
`[assets] directory = ".open-next/assets"` entries resolve against `working_directory: "."` — one
level above where OpenNext would write even if it ran.

> **Owner decision, taken 2026-07-29 — option B.** Recorded in §10.7.
> The root Worker keeps `/v1` routing and the image proxy and **drops the OpenNext fallback
> entirely**. `frontend/`'s Next.js build leaves the deploy path. The apex `animichi.com` is served
> by **`apps/web`**.

**Prerequisite, and it is not optional: the SEO surface must move to `apps/web` first.**
[measured] `apps/web` **already has** per-anime `src/features/anime/head.ts` and
`structured-data.ts`, plus `src/features/seo/json-ld.ts` and `src/features/seo/hreflangGraph.ts`,
each with unit tests under `apps/web/tests/unit/seo/` and `tests/unit/anime/`. It **lacks**:
`robots.txt`, `sitemap.xml`, site-level/homepage JSON-LD, and OG/icon assets —
`src/routes/__root.tsx`'s head is `{ title: "Animichi" }` with a stylesheet link and no description
or OG tags, and `src/routes/index.tsx` declares no head at all. `frontend/` ships
`public/robots.txt`, `public/sitemap.xml`, `app/icon.png` and `app/apple-icon.png`.

> *Correction to the review brief:* it stated `apps/web` has "no sitemap/robots/OG/homepage
> JSON-LD/hreflang". Four of five confirmed — **hreflang and per-page JSON-LD already exist** and
> cutting over does not lose them. The gap is narrower than assumed, which makes 3b cheaper, not
> unnecessary.

Phase 3 therefore splits:

| Sub-phase | Work | Blocks |
|---|---|---|
| **3a** | `users` → staging via the new atoms | — |
| **3b** | Port the missing SEO surface to `apps/web`: `robots.txt`, `sitemap.xml`, site-level JSON-LD, OG + icon assets. Follows the existing `tests/unit/seo/` pattern. **Not a CI change** — it is what makes the CI change safe. Its own issue. | 3c |
| **3c** | Reduce the root Worker to `/v1` + image proxy: delete the three `[assets]` blocks, drop `build_filter: frontend` from root's deploy inputs, retire or explicitly mark non-deploying `frontend/wrangler.jsonc`'s `animichi-frontend`. `wrangler-config-contract` (1a.4) asserts the result. | 3d |
| **3d** | Apex DNS (issue #538): a proxied record at `animichi.com` (and `www`), plus the route pointing at the Worker option B selects. [measured] the zone is Cloudflare-delegated and contains **no** apex/`www` record today. `infra/` creates no DNS records; `webRoutesEnabled` exists only as a commented-out instruction in `Pulumi.staging.yaml` and is set in neither stack. | 3e |
| **3e** | Settle the D3 build-time question (AC-3.5) and the three idempotency properties (AC-3.6/3.7/3.8) | — |

*Exit:* `reusable-post-deploy.yml`'s full staging suite green — the first time the assertions at
`_post-deploy-test.yml:111-166` have ever been exercised against a real deployment — **and** the apex
assertion (AC-3.9) passes against the real public hostname, not a `*.workers.dev` name.

#### Phase 4 — Flip to per-package CI callers + two environment deploy callers.

Create the eleven **CI** callers (§4.1): PR triggers unfiltered and split hermetic/credentialed
(§5.1.1); push triggers with native `paths:`. Create **`deploy-staging.yml`** as the sole owner of the
ordered staging sequence (§5.3.0). Delete `ci.yml`, `_deploy-component.yml`, `_python-ci.yml`,
`_ts-ci.yml`, `_web-ci.yml`, `_webapp-ci.yml`, `_security.yml`, `_post-deploy-test.yml`, `deploy.yml`,
and the `changes` job. Add the three missing pipelines (`contract`, `infra`, `e2e`) and expand
`dependabot.yml` from 3 ecosystems to 8.

**Retarget `env-var-consistency` in this phase.** [gap found at rev 2] That check reads `ci.yml`,
`deploy.yml` and `_deploy-component.yml` — **all three are deleted here**, and rev 1 had no AC making
anyone re-point it. Left unhandled it either crashes on a missing file (noisy but safe) or, if
written defensively, silently asserts nothing (the fail-open shape this whole spec exists to remove).
AC-4.12 makes the retarget explicit and asserts the check still fails on a seeded inconsistency after
the deletion.

*Exit:* `dependency-closure`, `package-has-a-pipeline` and `single-door` clause (e) green; a
`packages/contract` change on a scratch branch demonstrably triggers catalog + users + web CI **and**
one ordered `deploy-staging.yml` run rather than three racing ones.

#### Phase 5 — Production door + branch protection, in a strict order.

Land `deploy-production.yml` with the staging-provenance check, the one-job/one-prompt shape, the
deployment branch policy, and the `single-door` + `required-set-is-hermetic` tests. **Then** the
repo-settings work — which is **two coupled changes with preconditions**, not the single change rev 1
described (§2.1):

| Step | Change | Precondition | Failure mode if done out of order |
|---|---|---|---|
| **5a** | Reconcile the two coverage gates (§10.5) to one number, or document the split | — | 5b activates ruleset `code_coverage` min 90 on every PR against a tree that may not meet it, blocking all merges |
| **5b** | Re-add a `pull_request` rule to `protect main` **without recreating the deadlock** — recommended: `required_approving_review_count: 0`, leaving `copilot_code_review` as the reviewing force | 5a | With 1 required approval and no `CODEOWNERS` on a single-maintainer repo, **no PR is mergeable** — this is exactly why the rule was deleted on 2026-07-29 |
| **5c** | Open a throwaway PR and verify it is mergeable; verify the four PR-scoped rules now actually evaluate | 5b | — |
| **5d** | Add `required_status_checks` listing **only hermetic lane names** (§5.1.1) | 5c **and** Phase 4 name stability | Every fork and Dependabot PR becomes permanently unmergeable |
| **5e** | Disable `can_admins_bypass` on `production` (and `staging`), or record why not | — | Silent admin override of the only human gate |

**Handle with care: [measured] `bypass_actors: []` and `current_user_can_bypass: "never"` — the owner
cannot bypass this ruleset.** A mistake in 5b or 5d cannot be clicked past from the merge button; it
must be undone through the ruleset API. Save the prior ruleset JSON (`gh api …/rulesets/19974534 >
before-5x.json`) before each mutation and treat restore as a rehearsed step, not an improvisation.

*Exit:* a production deploy halts at the reviewer gate before any side effect and raises exactly one
prompt; `single-door` fails on a deliberately-introduced second door; `required-set-is-hermetic` fails
on a fixture adding a secret-consuming job to the required set; a Dependabot PR opened after 5d is
mergeable; and the apex assertion (AC-5.11) confirms production actually serves traffic.

### 7.4 Ordering rationale in one line

Phase −1 establishes what is expressible; Phase 0 makes failures **cheap to find**; Phase 1a makes
wiring failures **impossible to miss, one provable check at a time**; Phase 1b relocates the existing
static gates; only then (Phases 2-3) do we spend cycles on the never-run path, with the topology
decision (#537 option B) taken up front and its SEO prerequisite scheduled ahead of it; the CI/deploy
ownership flip (Phase 4) happens against the known-good baseline Phases 2-3 created; the production
door and branch protection (Phase 5) are locked only once check names are stable, the
hermetic/credentialed split exists, and the coverage gates agree.

---

## 8. Acceptance criteria

Every AC carries a test-type annotation (`unit` | `integration` | `browser` | `api`) per the Quality
Ratchet, and every AC must land with its test in the same PR diff.

> `api` is used for any AC whose evidence is a live GitHub/Cloudflare API response or a real deployed
> endpoint — including repo-settings assertions, which rev 1 mislabelled `unit` (see AC-5.7).

### Phase −1 — Spikes

| # | AC | Type |
|---|---|---|
| AC-S.1 | The secret name→value binding mechanism is determined by a real GitHub run (not `act`), the winning form is recorded in §4.3, and `zizmor`'s verdict on each candidate is attached. **§5.5's consolidation and AC-5.6 are re-scoped to match before Phase 0 starts.** | `integration` |
| AC-S.2 | `enforcement: "evaluate"` is attempted on `protect main` via `gh api`; acceptance or rejection is recorded, and §9's staging mitigation is rewritten to match the result. | `api` |

### Phase 0 — Atoms

| # | AC | Type |
|---|---|---|
| AC-0.1 | Every composite action has typed `inputs`, documented `outputs`, and ≤60 lines. | `unit` |
| AC-0.2 | Every `.github/scripts/*.sh` has a sibling `*.test.sh` driving the real script; `shellcheck` passes on both. | `unit` |
| AC-0.3 | No composite action or reusable workflow branches on a package/component name (no `case "$COMPONENT"`). | `unit` |
| AC-0.4 | No composite action reads the `secrets` context; every secret arrives as a declared `input`. | `unit` |
| AC-0.5 | `meta-actions.yml` invokes each side-effecting atom with `dry_run: true` and asserts its declared outputs. | `integration` |
| AC-0.6 | `_deploy-component.yml` is ≤150 lines and its step sequence is unchanged from base by diff review, except the AC-0.7 reordering, which the PR body names explicitly. | `unit` |
| **AC-0.7** | **`worker-secrets-put` runs only after `wrangler-deploy` concludes success, and `wrangler-deploy` passes no `secrets:` input to `wrangler-action`. A fixture in which `wrangler-deploy` fails asserts that zero secrets were pushed** (closes #537's 9-secrets-to-a-failed-Worker path). | `integration` |
| **AC-0.8** | `pulumi-install`, `pulumi-snapshot` and `pulumi-apply` are three separate atoms with non-overlapping source ranges; `pulumi-snapshot` refuses to overwrite an existing snapshot for the same run/target. | `unit` |

### Phase 1a — Meta-tests (one check per PR)

| # | AC | Type |
|---|---|---|
| AC-1.1 | `meta.yml` has **no** `paths:` filter on either `push` or `pull_request`, and references no secret other than `GITHUB_TOKEN`. | `unit` |
| AC-1.2 | `read-set ⊆ trigger-set` exists; a fixture check declaring an uncovered read path makes it fail. | `unit` |
| AC-1.3 | All six mismatched config tests in §6.4 pass under their new triggers, and the `packages/contract` orphan runs. | `unit` |
| AC-1.4 | `env-var-consistency` uses a real YAML/TOML parser (no regex over workflow text), reads **all five** inputs including `Dockerfile`, and covers the `wrangler.toml` ×3 `[vars]` triplication. | `unit` |
| AC-1.5 | `action-pinning` fails on a fixture workflow using a floating tag. | `unit` |
| AC-1.6 | *(moved to Phase 1b)* `actionlint` and `zizmor` run blocking over `.github/workflows/**` **and** `.github/actions/**`. | `unit` |
| AC-1.7 | No `eslint-disable` / `# noqa` / `zizmor: ignore` / `continue-on-error` is added. The one pre-existing sanctioned exception (`agnix`) carries over unchanged and remains the only one. **§5.1.1's not-applicable mechanism is asserted to use neither `continue-on-error` nor a job-level skip.** | `unit` |
| **AC-1.8** | No test file under `ci/` uses `describe.skip`, `it.skip`, `test.skip`, or a runtime `skipIf`/credential-gated pool; a fixture adding one fails the check. (The #539 lesson: a guard in a skippable pool disappears silently.) | `unit` |
| **AC-1.9** | Each `ci/` check exports a `reads: string[]`; a check whose declared `reads` is empty while it opens a file is rejected by review checklist, and §6.4's residual-risk note is present in `ci/AGENTS.md`. | `unit` |
| **AC-1.10** | `wrangler-config-contract` **fails on the pre-fix tree**, reproducing #537 (root `assets.directory` not produced by `pnpm --filter frontend build`; Worker name claimed by two configs) and #539 (`catalog` staging/production declare neither `routes` nor `workers_dev`) **statically, with no deploy**. The failing run on the parent commit is linked in the PR body. | `unit` |
| **AC-1.11** | Every Phase-1a PR body links a run showing its check red on the parent commit and green on the tip. | `unit` |

### Phase 2-3 — Deploy paths

| # | AC | Type |
|---|---|---|
| AC-2.1 | A real staging deploy of `catalog` completes green through the new atoms, with the Pulumi rollback snapshot present in R2. | `api` |
| AC-2.2 | `catalog` staging and production declare `workers_dev` explicitly (#539 landed or reproduced), and `catalog-staging.<account>.workers.dev` no longer resolves to a live Worker. | `api` |
| AC-3.1 | A real staging deploy of `users` completes green. | `api` |
| **AC-3.2** | *(rewritten — rev 1's version was unreachable, §7.3 Phase 3)* A real staging deploy of the **reduced** root Worker (`/v1` + image proxy, no `[assets]` blocks, no `build_filter: frontend`) completes green, and `wrangler-config-contract` passes on the resulting tree. | `api` |
| AC-3.3 | `reusable-post-deploy.yml`'s full staging suite passes: web-landing, healthz, auth-probe, users-probe, catalog-probe, data-plane-probe, anon-gate-staging. | `api` |
| AC-3.4 | The `apps/web` branded-404 browser assertion runs in `web.yml` against the built worker (moved out of `_webapp-ci.yml`). | `browser` |
| AC-3.5 | The build-time question in §2.4 is settled empirically — root deployed with no `catalog` present, result recorded — and the ordering comment is replaced by an assertion or by a documented fact. | `integration` |
| **AC-3.6** | `atlas-migrate` is idempotent: running the deploy job twice against the same schema state applies zero migrations on the second run and exits 0. | `integration` |
| **AC-3.7** | `pulumi-snapshot` + `pulumi-apply` are replay-safe: a re-run after a partially-applied `up` does **not** overwrite the pre-change rollback snapshot, and the pre-change snapshot is still restorable. | `integration` |
| **AC-3.8** | `worker-secrets-put` is replay-safe: a re-run pushes the same set and reports the count; a fixture interrupting mid-push reports a partial state rather than exiting 0. | `integration` |
| **AC-3.9** | `apps/web` carries `robots.txt`, `sitemap.xml`, site-level JSON-LD and OG/icon assets (Phase 3b), with unit tests in the existing `tests/unit/seo/` pattern; and after Phase 3d `curl https://animichi.com/` returns 200 serving the `apps/web` landing page — asserted against the **real hostname**, not `*.workers.dev`. | `api` |

### Phase 4 — Topology

| # | AC | Type |
|---|---|---|
| AC-4.1 | Each of the 11 packages in §4.1 has exactly one **CI** caller workflow; `package-has-a-pipeline` fails if one is removed. | `unit` |
| AC-4.2 | `dependency-closure` fails on a fixture where a consumer's `paths:` omits `packages/contract/**`. | `unit` |
| AC-4.3 | `packages/contract`'s own `vitest` and `tsc --noEmit` run in CI (they do not today). | `unit` |
| **AC-4.4** | *(revised, §5.1.1)* `infra/` has a **hermetic** PR lane running `tsc --noEmit` + oxlint, and a separate **credentialed** lane running `pulumi preview`. The credentialed lane, run with empty credentials, concludes success with a `GITHUB_STEP_SUMMARY` entry naming the missing secret — using neither `continue-on-error` nor a job-level skip. | `integration` |
| AC-4.5 | `e2e/` has its own lane triggered by `e2e/**`. | `browser` |
| AC-4.6 | No workflow contains a `dorny/paths-filter` step; the `changes` job does not exist. | `unit` |
| **AC-4.7** | *(split, §5.1.1)* On `pull_request`, every **hermetic** package lane produces a check run with a real conclusion regardless of which files changed; every **credentialed** lane produces a check run with a recorded not-applicable conclusion when secrets are absent. | `integration` |
| AC-4.8 | `dependabot.yml` covers `apps/agent`, every pnpm workspace member, `infra`, and `github-actions` — 8 ecosystems, up from the 3 measured today. | `unit` |
| AC-4.9 | No package caller exceeds 80 lines; no reusable workflow exceeds 150. | `unit` |
| AC-4.10 | A deliberately-failing `catalog` staging deploy leaves `root`/`users` **red**, not `skipped`. | `integration` |
| **AC-4.11** | *(new, §5.3.0)* No package caller declares a deploy job; `deploy-staging.yml` is the sole owner of the ordered staging sequence; a push touching two packages' paths produces **one** deploy run, not two. `single-door` clause (e) fails on a fixture caller with a deploy job. | `integration` |
| **AC-4.12** | *(new — gap found at rev 2)* `env-var-consistency` is re-pointed away from the deleted `ci.yml` / `deploy.yml` / `_deploy-component.yml` **in the same PR that deletes them**, and still fails on a seeded env-var inconsistency afterwards. A fixture removing one of its read targets makes it fail loudly, never silently pass. | `unit` |

### Phase 5 — Production door + branch protection

| # | AC | Type |
|---|---|---|
| AC-5.1 | `single-door` fails when a fixture workflow declares a deploy `environment:` outside `reusable-worker-deploy.yml`. | `unit` |
| AC-5.2 | `single-door` fails when a production-reaching job relies on skip-propagation instead of an explicit event guard (§2.3). | `unit` |
| AC-5.3 | `deploy-production.yml` rejects a SHA with no green staging post-deploy record. | `integration` |
| **AC-5.4** | *(reworded, §2.3)* A production deploy **halts at the required-reviewer gate before any side effect** and raises **exactly one** approval prompt. The AC asserts the halt and the count only — [measured] `prevent_self_review: false` with a single listed reviewer means it does **not** establish independent review, and `docs/ops/deployment.md` says so in those words. | `api` |
| AC-5.5 | `deploy.yml` is deleted; no workflow can reach production except through `reusable-worker-deploy.yml`. | `unit` |
| **AC-5.6** | *(contingent on AC-S.1)* `secret-declaration` fails when a key is added to `deploy.config.json` with no counterpart in the authoritative `workflow_call.secrets:` block, and when a declared secret is unreferenced. **If AC-S.1 finds no binding mechanism, this AC is re-scoped to policy keys only and §5.5 is amended before Phase 0.** | `unit` |
| **AC-5.7** | *(type corrected: was `unit`)* The `production` environment has a deployment branch policy restricting it to `main` — asserted by reading the live environment via `gh api`, since it is a repo setting no static file records. | `api` |
| **AC-5.8** | The two-step ruleset change lands in the 5a→5e order of §7.3, each step preceded by a saved copy of the prior ruleset JSON; after 5b a throwaway PR is demonstrably mergeable **and** the four PR-scoped rules are shown to evaluate. | `api` |
| **AC-5.9** | `required-set-is-hermetic` fails on a fixture adding a secret-consuming job's name to the required set; and a Dependabot PR opened after 5d is mergeable. | `api` |
| **AC-5.10** | `can_admins_bypass` is `false` on `production` — or the decision to leave it `true` is recorded in `docs/ops/deployment.md` with a named reason; asserted against the live API either way. | `api` |
| **AC-5.11** | Post-deploy asserts the **production apex** responds: DNS resolves for `animichi.com`, and a fetch returns 200 with expected content. A green deploy against a hostname with no DNS record fails this AC (closes rev 1's "deploy green + domain dark" false finish, #538). | `api` |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Phase 3 uncovers deep defects in the never-deployed `root`/`users` path and the rebuild gets blamed | Phase 0 changes no topology, so any Phase-0 behaviour change is attributable. Phases 2-3 explicitly budget for *discovery*; each finding gets its own issue rather than being folded into the rebuild PR. |
| Running every lane on every PR raises cost/latency | Caching already in place. If it becomes real, use `pnpm --filter '...[origin/main]'` **inside** an always-running job with `fetch-depth: 0` — never a `paths:` filter (§5.1). |
| The meta-tests become a YAML parser nobody maintains | Keep them assertion-shaped and few (10 checks). Real YAML/TOML libraries, not regex. Each check exists because a specific incident happened, and Phase 1a requires each to be **demonstrated red** on the defect it was written for. |
| Deleting `_deploy-component.yml`'s ~700 comment lines loses hard-won knowledge | Migrate reasoning into `docs/ops/deployment.md` (canonical runbook per `docs/DOCS_POLICY.md`) and into tests. §2.4.3 shows three of those comments are already **wrong** — a fact worth keeping is worth asserting. |
| Porting Python config tests to TS drops an assertion | Port assertion-by-assertion with the original Python file in the PR diff for line-by-line review, plus a fixture test per ported assertion. |
| Adding `required_status_checks` blocks all merges if a check name is wrong | Land after Phase 4 when names are stable, per §7.3's 5a-5e order, with the prior ruleset JSON saved before each call. **[unverified]** whether `evaluate` enforcement is available on a user-owned repo — AC-S.2 settles it; if not, rehearse on a scratch repository instead. Note `bypass_actors: []` means a mistake cannot be clicked past. |
| **Re-adding the `pull_request` rule recreates today's deadlock** | 5b uses `required_approving_review_count: 0`; 5c verifies mergeability on a throwaway PR before anything else is added. Preceded by 5a, because activating the PR-scoped rules also activates ruleset `code_coverage` min 90. |
| **Required checks lock out Dependabot / fork PRs on a public repo** | §5.1.1's hermetic/credentialed split; `required-set-is-hermetic` enforces it structurally; AC-5.9 verifies with a real Dependabot PR after 5d. |
| **The secret consolidation turns out not to be expressible** | Phase −1 spike 1 runs *before* any phase depends on it; §5.5 and AC-5.6 are explicitly marked contingent and are re-scoped, not quietly retained, if the spike says no. |
| **`read-set` is self-declared, so a check can outgrow its declaration silently** | Stated, not mitigated (§6.4 "Residual risk"). `reads:` is at least a visible line in the file under review. §10.8 asks whether to build the `fs`-instrumented form now. |
| **`deploy.config.json` becomes the ninth hand-maintained list** | §4.3 makes it carry policy keyed by names it does not define; `secret-declaration` asserts both directions against the authoritative `workflow_call.secrets:` block. |
| Approval fatigue reintroduced by a later refactor splitting the prod job | AC-5.4 asserts exactly one prompt; `single-door` enforces the structure. Note the gate is one person approving their own deploy (§2.3) — it bounds blast radius, it does not add review. |
| **A phase lands broken because `main` currently enforces nothing** | Acknowledged in §7.1 as a discipline rather than a property. Phase 5 is what converts it; until then the only real gate is the author. |

## 10. Owner decisions required

1. **Re-add a `pull_request` rule to `protect main`, and in what shape?** [measured] It was removed
   today because 1 required approval + no `CODEOWNERS` on a single-maintainer repo made every PR
   unmergeable. Recommended: `required_approving_review_count: 0` so the four PR-scoped rules
   (`code_scanning`, `code_quality`, `code_coverage`, `copilot_code_review`) become live again while
   the repo stays self-mergeable. **Until this lands, `required_status_checks` is inert** and a
   direct push to `main` bypasses every quality rule (§2.1). Repo-settings change, not a PR.
2. **Disable "Allow administrators to bypass configured protection rules"** on `production` and
   `staging`? [measured] Both are `can_admins_bypass: true`. Note the asymmetry: the ruleset allows
   nobody to bypass, the environments allow every admin (§2.3).
3. **`ci/` package language — TypeScript/vitest (recommended) or Python/uv?** (§6.4)
4. **Does `frontend/` (frozen) keep a lane?** Now coupled to decision 7: under option B, `frontend/`
   stops being what the production root Worker builds, so the question becomes whether it keeps a
   freeze-guard lane or is retired outright along with `frontend/wrangler.jsonc`'s
   `animichi-frontend` Worker.
5. **Reconcile the two coverage gates** — the ruleset's `code_coverage` min 90 vs
   `apps/agent/pytest.ini`'s floor and `AGENTS.md`'s frontend floors — to one, or document the split
   deliberately. **This is now a blocker for decision 1**, because re-adding the PR rule activates
   the min-90 gate on every PR (§7.3 step 5a).
6. **Merge queue: adopt or not?** If yes, `paths:` filtering is off the table (`merge_group` ignores
   it) and §5.1's rejected aggregator pattern becomes mandatory. Decide before Phase 4.
7. **Root/apex topology (#537, #538) — RECORDED AS DECIDED 2026-07-29: option B.** The root Worker
   keeps `/v1` + image proxy and drops the OpenNext fallback; the apex is served by `apps/web`.
   **Prerequisite:** port the missing SEO surface (`robots.txt`, `sitemap.xml`, site-level JSON-LD,
   OG/icons) to `apps/web` first — [measured] hreflang and per-page JSON-LD already exist there, the
   rest does not (§7.3 Phase 3b). Confirm the recorded decision, and confirm 3b blocks 3c.
8. **Strengthen `read-set` from declaration to observation?** (§6.4 residual risk) Instrumenting `fs`
   during the `ci/` run to compare opened paths against declared `reads:` closes the honour-system
   gap, at the cost of machinery that can itself rot. Deferred by default; asking explicitly because
   the gap is the same shape as the incident that started this work.
9. **Accept `deploy.config.json` carrying no secret names** (§4.3) — i.e. the authoritative home is
   `reusable-worker-deploy.yml`'s `workflow_call.secrets:` block. If the owner prefers the JSON as
   the source of truth, say so before Phase −1 spike 1, since it changes what the spike must prove.

## 11. References

GitHub Actions documentation (fetched 2026-07-29, not recalled):

- [Avoiding duplication — composite action vs reusable workflow](https://docs.github.com/en/actions/concepts/workflows-and-actions/avoiding-duplication)
- [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) — nesting limit, environment/secret precedence
- [Contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) — `secrets` unavailable in composite actions
- [Workflow syntax — paths / Git diff comparisons](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — two-dot vs three-dot; the 3,000-file and 1,000-commit limits
- [Events that trigger workflows — `workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Manage environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) · [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks) — the Pending-vs-success asymmetry (§2.2)
- [Keeping your GitHub Actions and workflows secure](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) — fork PRs receive no secrets; `pull_request_target` hazards (§5.1.1)
- [Automating Dependabot with GitHub Actions](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions) — Dependabot secrets store (§5.1.1)
- [Managing rulesets for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository) — rule types, enforcement modes (§2.1)
- [act — Not supported](https://nektosact.com/not_supported.html)
- [zizmorcore/zizmor](https://github.com/zizmorcore/zizmor) · [rhysd/actionlint](https://github.com/rhysd/actionlint)

Repository facts re-measured at revision 2 (commands inline in the text):
`gh api repos/lifeodyssey/animichi/rulesets/19974534` · `gh api repos/lifeodyssey/animichi/environments` ·
`gh repo view --json visibility` · `gh issue view 537` · `gh issue view 538` · `gh pr view 539` ·
`git show origin/main:<path>` · `git log --oneline 1cae11f6..0cad6b41 -- .github/` ·
`git diff 0cad6b41 79c8306d -- .github/`

Community discussions cited for known limitations: [#44490](https://github.com/orgs/community/discussions/44490),
[#13690](https://github.com/orgs/community/discussions/13690), [#26092](https://github.com/orgs/community/discussions/26092)
(required-if-run), [#45899](https://github.com/community/community/discussions/45899) (`merge_group` + paths),
[#50908](https://github.com/orgs/community/discussions/50908) (per-job approval prompts),
[#26325](https://github.com/orgs/community/discussions/26325) (`workflow_run` ref).

**Open caveats** where sources could not be reconciled: (a) `paths:` behaviour on force-push and
merge commits is community lore, not specified — no gate in this spec depends on it; (b) whether
rulesets differ from classic branch protection on path-skipped required checks is unconfirmed —
§5.1 avoids path-filtering PR checks entirely, so the answer does not matter; (c) whether ruleset
`enforcement: "evaluate"` is available on user-owned repositories — **AC-S.2 settles this before
§9 relies on it.**

## 12. Related documents

Per `docs/DOCS_POLICY.md`, this spec is a planning artifact. On landing:

- `docs/ops/deployment.md` (canonical runbook) absorbs the operational reasoning currently living in
  workflow comments; its stale `worker/worker.js` reference (`:255-257`) is corrected; and it gains
  an explicit statement that the production approval gate is one person approving their own deploy
  (§2.3), so no future reader mistakes it for independent review.
- `.claude/rules/ci.md` is rewritten for the three-layer model (it currently mandates the `_*.yml`
  caller/reusable layering this spec replaces) and gains the CI-belongs-to-the-package /
  deploy-belongs-to-the-environment rule (§5.3.0).
- New `ci/AGENTS.md` + `ci/CLAUDE.md` per the agent-docs network rules, carrying the no-skippable-pool
  rule (AC-1.8) and the `read-set` residual-risk note (§6.4).
- Issues to file or update: #537 (option B recorded, split into 3b/3c), #538 (blocked on 3c's
  outcome), #539 (merge before Phase 2), plus a new issue for the stale "no public `/catalog/*`
  route" comments (§2.4.3) and one for porting the SEO surface to `apps/web` (Phase 3b).
