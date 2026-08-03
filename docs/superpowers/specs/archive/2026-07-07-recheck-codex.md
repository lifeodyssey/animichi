# 2026-07-07 Frontend Rebuild Spec Recheck (Codex Blind Reviewer)

Scope: second blind recheck of the frontend rebuild spec after R1/R2/P3 revisions. This review does not reference the parallel Fable recheck output.

User-stated target commit: `71464d8`.

Actual worktree HEAD checked: `b32682a`.

HEAD delta note: `git diff --name-only 71464d8..HEAD` only lists `docs/superpowers/specs/2026-07-06-session-progress.md`, outside the specified review corpus, so the specified spec/iter/inputs/backlog corpus is effectively reviewed at `71464d8` content.

Reviewed corpus:
- `docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md`
- `docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md` through `iter-7.md`
- `docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md` sections 7-11
- `docs/superpowers/plans/2026-07-07-refactor-backlog.md`

## Range Confirmation

- `git rev-parse --short HEAD` returned `b32682a`, while the prompt named `71464d8`.
- `git show --oneline --no-patch 71464d8` confirmed `71464d8 docs(spec): P3 — retire last proposals (P6/msg-cap final), dual-route unification, S0.10 hygiene story`.
- `git diff --name-only 71464d8..HEAD` returned only `docs/superpowers/specs/2026-07-06-session-progress.md`, so the specified review corpus was not changed by the extra checkpoint commit.

## Numeric Chain Check

Result: no finding.

- Main spec §③ (`/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md:192-199`) declares iteration story counts `10/13/10/10/9/10/6/9`, matching the expected chain.
- Iter file headers declare the same counts:
  - `iter-0.md:3` -> 10
  - `iter-1.md:3` -> 13
  - `iter-2.md:3` -> 10
  - `iter-3.md:3` -> 10
  - `iter-4.md:3` -> 9
  - `iter-5.md:3` -> 10
  - `iter-6.md:3` -> 6
  - `iter-7.md:3` -> 9 executable stories, with `S7.3` explicitly frozen as a placeholder and excluded from the count.
- Actual story heading check:
  - `iter-0.md heading_count=10 executable_count=10`
  - `iter-1.md heading_count=13 executable_count=13`
  - `iter-2.md heading_count=10 executable_count=10`
  - `iter-3.md heading_count=10 executable_count=10`
  - `iter-4.md heading_count=9 executable_count=9`
  - `iter-5.md heading_count=10 executable_count=10`
  - `iter-6.md heading_count=6 executable_count=6`
  - `iter-7.md heading_count=10 frozen_placeholder=1 executable_count=9`
- Story ID existence command:
  - Command: `defined=$(rg -o '^### S[0-9]+\\.[0-9]+' docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-*.md | sed -E 's|^.*### ||' | sort -u); refs=$(rg -o 'S[0-9]+\\.[0-9]+' docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-*.md docs/superpowers/plans/2026-07-07-refactor-backlog.md | sed -E 's|^.*:||' | sort -u); ... comm -13 ...`
  - Result: `defined_count=78`, `referenced_count=78`, `referenced_not_defined_count=0`.
- New IDs:
  - `S0.10` has one story heading at `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md:218`.
  - `S1.13` has one story heading at `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md:371`.
  - No numbering conflict found.

## Grep Assertion Results

### Literal `[proposal, pending confirmation]`

- Full-repo command: `rg -nF '[proposal, pending confirmation]' .`
- Full-repo hit count: `1`
- Hit: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-review-codex.md:15`
- Reviewed-corpus command: `rg -nF '[proposal, pending confirmation]' docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-*.md docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md docs/superpowers/specs/2026-07-06-seo-geo-plan.md docs/superpowers/plans/2026-07-07-refactor-backlog.md`
- Reviewed-corpus hit count: `0`
- Interpretation: the current spec corpus is clean, but the prompt's full-repo mechanical assertion does not pass because the old Codex review file quotes the historical problem text.

### `route_optimizer` in iter-2 through iter-7

- Command: `rg -n 'route_optimizer' docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-2.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-5.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-6.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-7.md`
- Hit count: `3`
- Hits:
  - `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-2.md:241`
  - `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md:198`
  - `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md:210`
- Interpretation: `iter-3.md:198` is historical/rationale text, but `iter-2.md:241` and `iter-3.md:210` are active changed-file paths that still extend or wire `apps/agent/agent/agents/route_optimizer.py`.

### `zhenjia`

- Full-repo command: `rg -n -i 'zhenjia' .`
- Full-repo hit count: `75`
- Reviewed-corpus command: `rg -n -i 'zhenjia' docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-*.md docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md docs/superpowers/specs/2026-07-06-seo-geo-plan.md docs/superpowers/plans/2026-07-07-refactor-backlog.md`
- Reviewed-corpus hit count: `2`
- Reviewed-corpus hits:
  - `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md:184`
  - `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md:185`
- Interpretation: the reviewed spec corpus only uses `zhenjia` in legacy-domain residue/301 migration ACs. The full repo still contains old implementation and historical docs using `seichijunrei.zhenjia.*`; that is outside this spec-only recheck, but the raw full-repo result is not zero.

### Baseline-threshold expressions

- Command: `rg -n -i 'score\\s*>=\\s*baseline\\s*[-−]|baseline\\s*[-−]\\s*[0-9]+\\s*pp|baseline−2点|baseline\\s*[-−]\\s*N\\s*points|flat point-threshold|bare-threshold|bare threshold' docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-*.md docs/superpowers/specs/2026-07-06-seo-geo-plan.md docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md`
- Raw hit count: `9`
- Interpretation: active spec/iter language consistently replaces flat thresholds with stratified bootstrap 95% CI + paired comparison. The raw hits are either retired-language explanations (`frontend-rebuild-spec.md:232`, `frontend-rebuild-spec.md:420`, `iter-7.md:27`, `iter-7.md:150`, `iter-1.md:31`, `iter-1.md:199`, `iter-1.md:373`) or superseded input-ledger text (`frontend-rebuild-inputs.md:51`, `frontend-rebuild-inputs.md:299`). I found `0` active inconsistent flat-threshold ACs in the reviewed spec/iter files.

## Findings Logged So Far

### P1 — `route_optimizer.py` still appears as an active implementation path after P3 says it is retired

- Location: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-2.md:241`
- Location: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md:210`
- Evidence: P3 says route ordering is unified onto TS catalog and `route_optimizer.py` is retired (`frontend-rebuild-spec.md:429`; backlog line 11), but iter-2 still extends `route_optimizer.py` with `TransitLeg`, and iter-3 still wires the OSRM/Valhalla polyline query into `route_optimizer.py`.
- Fix: move these future extension points to the TS catalog route module / catalog dependency path named by P3, or explicitly split a renamed Python non-routing helper if Python remains needed; do not list retired `route_optimizer.py` as a changed file.

### P2 — Full-repo pending-label grep is not mechanically clean because the old Codex review file quotes the historical label

- Location: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-review-codex.md:15`
- Evidence: `rg -nF '[proposal, pending confirmation]' .` returns one hit, although the reviewed current spec corpus returns zero hits.
- Fix: either narrow the mechanical assertion to the current spec corpus, or reword the old review note so the exact bracketed literal is not present.

## R1/R2/P3 Conflict Hotspots

### P6 Status

Result: no finding.

- Main spec consistently says P6 is Finalized after P3: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md:9`, `:138`, `:152`, `:370`, `:429`.
- `iter-1.md` consistently carries the finalized status and the concrete no-resume + `GET /v1/conversations/{id}/messages` fallback ACs: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md:9`, `:10`, `:41`, `:81`, `:196`.
- Inputs §10 last row finalizes the same content: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md:300`.

### Message Length Cap

Result: no finding.

- The value is consistently `MESSAGE_MAX_CHARS`, initial value `4000`, across main spec and S1.12: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md:155`, `:244`, `:370`, `:429`; `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md:14`, `:344`, `:358`.
- Inputs §10 last row matches this value: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md:300`.

### `x1.3` Detour Coefficient

Result: one finding already logged under `route_optimizer.py`.

- Correct target stated in main spec/backlog: `workers/catalog/src/lib/route.ts`, not Python `route_optimizer.py`: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md:116`, `:429`; `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/plans/2026-07-07-refactor-backlog.md:11`.
- `iter-1.md` is aligned: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md:155`, `:160`, `:166`, `:218`.
- The residual conflict is not the coefficient formula itself; it is that later iterations still extend the retired Python module (`iter-2.md:241`, `iter-3.md:210`).

### Vision Model / Capability Supply

Result: no finding.

- S1.3 defines the phase-1 standalone vision call and D4 supply decision: BYOK uses the user key only after `vision_capable`; BYOK without vision and no-BYOK fall back to platform Gemini, metered by logged-in/anonymous tier: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md:98-105`.
- S1.11 adds the 1px probe and storage lifecycle for the vision-capability flag: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md:322`.
- S4.8 reuses that same decision tree instead of redefining it: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md:151`, `:157`, `:168`.

### Worker Test Count

### P2 — Inputs §7 still says the worker has 15 tests, while the rest of the spec package correctly says 16

- Location: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md:229`
- Evidence: `frontend-rebuild-inputs.md:229` states `已是 TS + 15 用例`; main spec and iter docs correct the count to 16 (`entry.test.ts` 11 + `auth.test.ts` 5) at `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md:84`, `:97`, `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md:12`, `:66`, and `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md:262`.
- Fix: update the inputs §7 SD-6 row itself to `16 用例` or add an inline correction note there, so every source in the authoritative input range agrees without relying on downstream correction text.

## New-Content Logic Checks

### S0.10 vs Refactor Backlog

Result: no finding.

- Backlog rows scheduled into stories are `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/plans/2026-07-07-refactor-backlog.md:9-11`.
- S0.10 lists 9 ACs at `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md:226-235`.
- Mapping:
  - F1 contract shape lock -> S0.10 AC line 227.
  - F1 runtime input validation / zod boundary -> S0.10 AC line 228.
  - F2 zombie dependency removed -> line 229.
  - F3 `reverse-geocoder` relocated -> line 230.
  - F4 `LogContext`/`LogTimer` deleted -> line 231.
  - F5 `asyncpg-stubs` replaces importlib hack -> line 232.
  - F6 official DuckDuckGo tool adopted -> line 233.
  - Dead eval datasets deleted -> line 234.
  - Stale TODOs resolved -> line 235.

### S1.7 Dual-Route Ordering-Parity AC

Result: measurable, no blocking finding.

- The AC at `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md:227` can be implemented as a concrete integration test: seed one fixed `selected_point_ids` selection, run the chat-path `plan_route` and the `selected_route` bypass through `deps.catalog`, and assert the exact ordered route-stop IDs match.
- Non-blocking wording cleanup: replace "station order" with "route stop order / ordered point IDs" to avoid confusion with S2.10's railway-station topology vocabulary.

## Additional Sweep

Command:

```bash
rg -n -i 'pending confirmation|pending-confirmation|pending Coordinator|proposal under discussion|proposal|待定|待议|未确认|llms-full|A2A endpoint|A2A server|score >= baseline|route_optimizer\.py \(extended|wires in the polyline' docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-{0,1,2,3,4,5,6,7}.md docs/superpowers/specs/2026-07-06-frontend-rebuild/seo-geo-plan.md docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md docs/superpowers/plans/2026-07-07-refactor-backlog.md
```

### P2 - Iter-7 still contains a pending Coordinator confirmation despite the final package removing pending-confirmation items

- Location: `/Users/lumimamini/Documents/Seichijunrei-agent/.claude/worktrees/frontend-rebuild/docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-7.md:135`
- Evidence: The line says `Relationship (backfilled from SD-25①, pending Coordinator confirmation)`, while the final package says no proposal/pending-confirmation items remain in the current decision flow.
- Fix: Resolve the default now, for example by saying the SDK source and script remain the same maintained hand-written client unless a future story explicitly splits them, rather than leaving a pending Coordinator confirmation in the final spec set.

## Consolidated Finding List

1. P1 - `route_optimizer.py` is described as retired by S1.7, but iter-2 and iter-3 still extend or wire it as an active implementation path. Fix by redirecting those stories to the unified catalog route service or explicitly marking their route_optimizer references as obsolete notes.
2. P2 - Full-repo literal search for `[proposal, pending confirmation]` is not zero because the old Codex review file still quotes it. Fix by either narrowing the mechanical assertion to the current reviewed corpus or excluding old review artifacts from the full-repo check.
3. P2 - `docs/superpowers/specs/2026-07-06-frontend-rebuild-inputs.md:229` still says Worker has 15 tests, while the current spec/iter files say 16. Fix by updating the authoritative inputs row to 16 or adding an explicit supersession note.
4. P2 - `iter-7.md:135` still contains `pending Coordinator confirmation`. Fix by resolving that wording into a final default decision.

## Verdict

request_changes

P1 findings: 1

P2 findings: 3

Blocking reason: P3 retires the dual-route route_optimizer path in S1.7, but later iteration specs still assign implementation work to `route_optimizer.py`, so the final package has an unresolved implementation-source conflict.
