# frozen_string_literal: true
# The specs and cases the always-run e2e lane deliberately does not run, each
# with a reason, all checked by test/repo-config/e2e-spec-coverage.test.rb.
# Policy data rather than derivation: a repair card deletes its own entry
# (#1570 is the open one), so this file changes when a spec is parked, opted
# out or repaired — never because the gate's regexes or the workflow changed.

module E2eLaneExclusions
  # Deliberately outside the always-run lane. Named, never patterned: a pattern
  # broad enough to swallow the next spec is the defect the contract
  # (test/repo-config/e2e-spec-coverage.test.rb) exists to catch. Each entry
  # says who runs it, if anyone (#1702 AC2).
  EXEMPT = {
    "seed.spec.ts" =>
      "playwright-test-generator's zero-assertion scaffold: every project but the " \
      "MCP-only `seed` project ignores it (playwright.config.ts), so it runs nowhere by design",
    "visual/mockup.spec.ts" =>
      "opt-in visual project: `make visual-check` runs it (--project=visual --grep @visual)",
    "visual/summary.spec.ts" =>
      "opt-in visual project: `make visual-check` runs it (--project=visual --grep @visual)",
    "visual/units.spec.ts" =>
      "opt-in visual project: `make visual-check` runs it (--project=visual --grep @visual)",
    "web-neon-login.spec.ts" =>
      "live Neon Auth round-trip: it has its own lane, `pnpm --filter animichi-e2e run " \
      "test:login`, which is local-only because no PR job may hold the QA identity " \
      "(.github/test/workflow-credentials.test.rb); #1701 made the spec fail-closed instead " \
      "of self-skipping, so the browser job reports it as NOT RUN rather than as a lane " \
      "this gate derives",
  }.freeze

  # Cases the lane deliberately does not run. A file-level check cannot see a
  # case-level filter, so the filter is pinned here — an undeclared one and a
  # declared-but-absent one are both failures (#1702).
  LANE_EXCLUDED_CASES = {
    "@perf-mobile-cold" =>
      "timed cold-start budgets: opt-in through `test:perf-mobile-cold`, because the " \
      "promotion gate forbids timing asserts in a lane that runs on every PR",
  }.freeze

  # Not out of the lane by choice: each of these has never run, and its
  # assertions no longer hold against current main. The failures below were
  # measured in the emitted-Worker lane (`E2E_SERVE_EMITTED_WORKER=1`, #1702);
  # each ends by naming its repair owner as `#N owns the repair`, and
  # `test_every_known_failing_reason_names_a_repair_owner`
  # (test/repo-config/e2e-spec-coverage.test.rb) refuses an entry without that
  # clause, so a spec parked here always names a repair card.
  # Whether the card exists or is still open is not checked: that needs GitHub,
  # and this contract stays offline.
  KNOWN_FAILING = {
    "web-map-spike.spec.ts" =>
      "#237's colours are repaired (the fixture derives them from map-style.ts) and the " \
      "canvas does paint them — measured, 8 of 9 samples are the style background — but the " \
      "9th lands on the app's OWN route polyline (#c1440e, map-layers.ts), so " \
      "`backgroundPixels == sampledPixels` cannot hold; #1570 owns the repair",
  }.freeze
end
