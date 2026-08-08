# Frontend Rebuild Spec Package Second-Pass Review

Overall verdict: request_changes

The package is not ready for execution as-is. The reviewed worktree is not the requested clean commit, and the spec package still has several P1 logic contradictions around eval gates, pending-vs-finalized status, story counts, vision routing, crawler policy, JSON-LD contraction, and UGC/photo-review boundaries.

## P0 Findings

- **[workspace]** requested commit `1ba97ff` vs actual `HEAD f926f24`, with `docs/superpowers/specs/2026-07-06-seo-geo-plan.md` modified — review input state differs from the requested snapshot — suggested fix: rerun this second-pass review on a clean checkout of `1ba97ff`, or explicitly bless `f926f24` plus the dirty SEO/GEO file as the review snapshot.

## P1 Findings

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md]** §⑤ Global DoD / §⑪ Verification Plan — eval gates still say "`5-case smoke PR gate`", "`617-case nightly suite`", and Iteration 7 "`score >= baseline - 10pp`", conflicting with inputs SD-30's "`L0 ... ~80`", "`L1 full 617→~750`", and "layered bootstrap 95% CI + paired comparison" gate — suggested fix: replace the old X8/Iteration-7 gate text with the SD-30 L0/L1/L2 thresholds and bootstrap/paired-comparison rule.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md]** Authority annotation — says "there are no remaining protocol/security items still marked proposal" and "Message length ceiling: finalized", conflicting with main spec §8.8 / Patch A note saying "What remains [proposal, pending confirmation] is now down to exactly two items: P6 ... and the message-length cap" — suggested fix: restore P6 and the message-length cap to pending status in iter-1 until the Coordinator gets explicit user confirmation.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md]** S1.3 Backend enabler — says "Vision recognition reuses the main loop's LLM (all three BYOK provider families support vision)" while the same story's D4 tree says "BYOK without vision, or no BYOK at all, both fall back to platform Gemini"; authoritative SD-26 D1/D4 says the baseline is an independent vision call and only BYOK `vision_capable` uses the user's key — suggested fix: delete the main-loop/all-three-support-vision claim and make S1.3 consistently follow the D4 decision tree.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md]** S1.13 vs `iter-0.md` S0.1 — S0.1 gates any PR touching "`apps/agent/**`", while S1.13 gates only prompt/model-config/guardrail files; authoritative SD-30 describes the PR gate as prompt/model/guardrail-change scoped — suggested fix: pick one path-filter contract and update S0.1/S1.13 plus CI files to the same rule.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-2.md]** header story count vs main spec §③ — iter-2 says "Story count: 10" after adding S2.10, while the main spec still says Iteration 2 has "9" stories and "Iterations 2 and 3 (9 each)" — suggested fix: update the main iteration train and sizing note to 10, or move S2.10 out of this iteration if the main plan's 9-story envelope is authoritative.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md]** header story count vs main spec §③ — iter-3 says "Story count: 10" after adding S3.10, while the main spec still says Iteration 3 has "9" stories and "Iterations 2 and 3 (9 each)" — suggested fix: update the main iteration train and sizing note to 10, or move S3.10 out of this iteration if the main plan's 9-story envelope is authoritative.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md]** header story count vs main spec §③ — iter-4 says "Story count: 9" after adding S4.8/S4.9, while the main spec still says Iteration 4 has "7" stories — suggested fix: update the main iteration train/story-count note to 9, or move the phase-2 image-search stories out of this iteration if the main train is authoritative.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md]** S4.8 vision supply — says "all three BYOK provider families ... must support vision input" while also saying it reuses iter-1's decision tree; iter-1 S1.3 says "BYOK without vision, or no BYOK at all, both fall back to platform Gemini", and authoritative SD-26 D4 says the same fallback applies — suggested fix: replace the "must support vision" requirement with "use BYOK only when capability-probed vision-capable, otherwise platform Gemini by quota tier."

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md]** S4.8 offline A/B matrix — text says `{Gemini, Qwen3, Voyage} × {emb-only, LLM-only, hybrid}` but then calls this "six combinations, or four if Qwen3-VL turns out unavailable"; the stated matrix is 9 combinations, or 6 if Qwen is unavailable — suggested fix: correct the matrix cardinality and AC expectations so the eval runner knows which cells must be run.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md]** S4.8 evaluation-set scale — AC targets "100-150 labeled pairs" but defines "10 anime titles × 10 shot-angles × two query modalities", which equals 200 pairs — suggested fix: either change the target to 200 or adjust the fixture structure to fit the authoritative SD-30 L3 "100-150" target.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md]** S4.9 real2real fast-path unlock — unlocks when "accumulated check-in photo count crosses a preset threshold", but authoritative SD-26 D2 says `user_checkin` photos enter the index only after flywheel-3 human review, and SD-23 says UGC catalog suggestions must not auto-write — suggested fix: require human-reviewed/approved check-in photos before real2real eligibility, or defer the unlock mechanism behind the DD-7 review-pipeline trigger.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-5.md]** header story count vs main spec §③ — iter-5 says "Story count: 10" after adding S5.9/S5.10, while the main spec still says Iteration 5 has "8" stories — suggested fix: update the main iteration train/story-count note to 10, or move area pages/CI quality gate out if the main train is authoritative.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-5.md]** S5.7 robots AC — says "`robots.txt` explicitly allows GPTBot/ClaudeBot/PerplexityBot", conflicting with authoritative SD-27/S0.8 policy to block training crawlers "`GPTBot`/`ClaudeBot`/`Google-Extended`" while allowing search/citation/agent crawlers such as `OAI-SearchBot`/`Claude-SearchBot`/`PerplexityBot` — suggested fix: replace GPTBot/ClaudeBot with the allowed search/agent UAs and keep training crawlers blocked.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-5.md]** S5.5 root route ownership — `apps/web/src/routes/index.tsx` is already the S0.6 Landing route, but S5.5 says the App Home also changes that file and leaves coexistence/division "to be settled during pre-build refinement" — suggested fix: decide the root-route split now, for example `/` marketing vs authenticated home route, or make S5.5 explicitly replace S0.6's landing behavior.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-7.md]** header story count vs main spec §③ — iter-7 says "Story count: 9", while the main spec still says Iteration 7 has "7" stories and its note says "Iteration 7 (7, the SDK/MCP work expands)" — suggested fix: update the main iteration train/story-count note to 9, or remove/defer S7.8-S7.10 if the main train is authoritative.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-7.md]** S7.8 regression AC — requires "`score` no lower than baseline", conflicting with S7.1 and authoritative SD-30 that flat point thresholds are retired in favor of "bootstrap 95% CI + paired comparison" — suggested fix: replace the bare score comparison with the SD-30 statistical gate.

- **[docs/superpowers/specs/2026-07-06-seo-geo-plan.md]** §1 JSON-LD mapping table — the rationale says "`TouristAttraction/TouristTrip/ItemList` [are] not in Google's supported list" and "只保留实体消歧最小集", but the share-page row still assigns `/s/:id` a `TouristTrip` schema — suggested fix: remove the `TouristTrip` row or explicitly document why share pages are an exception to the contraction rule.

## P2 Findings

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md]** §④ Releasable Definition / §⑪ Verification Plan — "Visuals match the corresponding canvas" / "screenshot comparison" has no pass/fail threshold, viewport matrix, or human-approval escape hatch, so a tester cannot implement it without asking what counts as a match — suggested fix: define the comparison mode per story family, for example exact state coverage plus an allowed visual-diff threshold or explicit manual design-approval checklist.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild-spec.md]** §② SD-6 / X14 rows — edge-worker status says "Already TS + 16 test cases", while authoritative inputs SD-6 says "已是 TS + 15 用例" — suggested fix: reconcile to the authoritative count or update the source evidence before executors size S0.3.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md]** SD-6 impact note / S0.3 releasable statement — edge-worker status says "`16 test cases`" while authoritative inputs SD-6 says "`15 用例`" — suggested fix: reconcile the count to the authoritative SD-6 evidence or update the source evidence before using the number in CI sizing.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md]** S0.4 AC "`loads visible tiles within 3s under normal network conditions`" — "normal network conditions" is not a reproducible test condition, so browser tests cannot implement the 3s threshold consistently — suggested fix: specify a Playwright/network profile, fixture tile size, cache state, and viewport for the 3s assertion.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md]** S0.7 AC "`never blocks for more than 800ms even on a slow device`" — "slow device" has no concrete CPU/network profile or measurement hook, making the 800ms gate non-repeatable — suggested fix: define the emulation profile and measure either splash-removal time or first interactive route paint with one named browser/device preset.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-0.md]** S0.8 releasable statement "`aninavi.app` gets a 301 redirect ... depending on a judgment call at execution time" — the story leaves a deploy-visible behavior to executor judgment with no AC, owner, or no-op record — suggested fix: decide now between "ship redirect", "explicitly non-blocking ops TODO", or "out of scope", and add the corresponding AC or deletion.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md]** suggested dependency order vs S1.12 dependencies — top order says "S1.12 ... and S1.8 ... have a data-interface dependency", while S1.12 later says that dependency is "voided now that P3 has been cut" — suggested fix: remove the stale dependency-order note or declare the real dependency on S1.8/`daily_usage`.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md]** S1.2 hard performance AC — "warm p95 first-token latency ≤3s" lacks sample size, region, warm-up procedure, and measurement field, so teams can satisfy it with incompatible tests — suggested fix: define the exact probe count, pre-warm step, region/runtime, and timestamp pair used to compute p95.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md]** S1.3 photo-search AC — "after uploading a recognizable anime screenshot" has no named fixture or expected title/series result, so the integration test depends on subjective recognizability — suggested fix: name 1-2 fixed image fixtures, expected recognized series/title IDs, and accepted fallback behavior.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md]** S1.12 message-length AC — "beyond a configured length ceiling (e.g., 4000 characters)" uses an example value instead of a required threshold, and the same item is still pending in the main spec — suggested fix: keep it pending or set a concrete env/config key plus default value and test that exact value.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-1.md]** S1.8 AC "current 16-case baseline" — repeats the edge-worker count mismatch against authoritative SD-6's "15 用例" — suggested fix: reconcile the worker-test baseline before using it as a no-regression gate.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-2.md]** S2.9 data-integrity AC — "a random 10% sample of rows" is non-deterministic and has no seed/minimum-row rule, so repeated test runs can verify different data — suggested fix: define deterministic sampling, a minimum sample count, and behavior for small tables.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-2.md]** S2.10 TransitLeg ACs — "far enough apart to require a railway transfer" / "close enough that walking is preferable" has no distance or duration threshold, so route rendering cannot decide transit vs walking consistently — suggested fix: define the switch threshold, for example by walking-time estimate, station distance, or route segment length.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-2.md]** S2.10 accuracy AC — "20 sampled popular-anime routes" compared with "Jorudan's real-world figures" lacks the fixed sample list, capture date/time, and expected baseline values — suggested fix: check in the 20-route fixture set with frozen Jorudan comparison data or a documented manual-refresh protocol.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md]** S3.3 check-in AC — "undo within the undo window" points to a "several-second window" but never defines the duration, so browser/integration tests cannot know when undo must still work or expire — suggested fix: set the undo window in milliseconds and test just-before/just-after boundaries with a mocked clock.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md]** S3.5 environment AC — "With no clear environmental signal" does not define which signals control bright-sunlight/night/offline mode, making the default-state test under-specified — suggested fix: define the detection inputs or make these modes explicit user/test toggles until live sensing is designed.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md]** S3.9 data-integrity AC — repeats the non-deterministic "random 10% sample" migration check from S2.9, again without seed or minimum-row behavior — suggested fix: use deterministic sampling and specify small-table behavior.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-3.md]** S3.10 river/rail blockage AC — the "e.g., two stops roughly 100m apart ... ~1km detour" case has no fixed coordinate fixture or expected OSRM route, so the integration test cannot be reproduced — suggested fix: name the exact two-stop fixture, expected path/distance bounds, and offline cached-polyline behavior.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md]** S4.8 coarse-screen AC — "within an acceptable response time (the exact threshold is set by the executor based on measured data)" makes the performance gate unknowable until implementation time — suggested fix: define an initial threshold from the SD-26 scale claim, or make the first run an explicit measurement story whose output updates a later gate.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-4.md]** S4.8/S4.9 routing thresholds — "confidence falls below the threshold", "performance-regression-test threshold", and the real2real "preset threshold" are all referenced without numeric/default values — suggested fix: define config keys and default thresholds, with tests covering below/equal/above boundary behavior.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-5.md]** S5.6/S5.8 quality-gate handoff — S5.6 says new-title sitemap SLA starts after a title clears X15 with "spot count ≥ threshold", but S5.8 says an anime with zero spots passes the quality gate and no spot-count threshold is defined — suggested fix: distinguish data-validity pass from SEO-publish eligibility and set the exact spot-count/min-info threshold.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-5.md]** S5.8 quality-gate ACs — "same coordinates + same episode within a small radius" and "sudden drop or spike" have no radius or delta thresholds — suggested fix: define numeric dedupe radius and volume-drift thresholds, with boundary-case unit tests.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-5.md]** S5.10 content-quality ACs — "preset threshold (e.g. 70%)" and "minimum-density threshold" are placeholders, not executable gates — suggested fix: choose initial template-ratio and minimum-information-density values or split a measurement story before making CI blocking.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-6.md]** S6.2 hover AC — "no highlight flicker / race condition (debounced)" has no debounce interval or observable flicker criterion — suggested fix: define the debounce window and test final highlighted pin/message after a controlled rapid-hover sequence.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-6.md]** S6.5 boundary AC — says exactly 100 points is handled by "one clear rule" but does not state whether 100 enters draft-edit or stays in normal mode — suggested fix: set the boundary explicitly, for example draft-edit only at `>100`, with exactly 100 staying normal.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-6.md]** S6.5 swap AC — "same area / similar time cost" leaves "similar" undefined, so the three-candidate filter is not testable — suggested fix: define the area match and time-cost delta threshold used for nearby swap candidates.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-7.md]** S7.4 dependencies — S7.4 generates an MCP server from the public OpenAPI schema, and the top-level order puts S7.5 before S7.4, but S7.4's own dependency list omits S7.5 — suggested fix: add S7.5 as an explicit dependency of S7.4 or state that an existing pre-S7.5 schema is sufficient.

- **[docs/superpowers/specs/2026-07-06-frontend-rebuild/iter-7.md]** S7.9 implementation path — changed files add `@mcp-ui/server` while the open question admits that S7.4 is Python FastMCP and the TypeScript/Python bridge is undecided — suggested fix: choose the bridge architecture before scheduling S7.9, or split a spike/decision story ahead of the MCP Apps implementation.

- **[docs/superpowers/specs/2026-07-06-seo-geo-plan.md]** §4 New-title SLA — "catalog new title passes X15 quality gate (spot count ≥ threshold)" never defines the threshold, and S5.8 separately allows zero-spot titles to pass data quality — suggested fix: define the SEO-publish spot-count/minimum-information threshold separately from the data-validity gate.
