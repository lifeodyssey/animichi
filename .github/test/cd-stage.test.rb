# SUT: cd.yml keeps ordered foundation, migration, service publication and smoke in each environment lock.
require "minitest/autorun"
require "psych"

class CdStageTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  def setup
    @cd = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/cd.yml")), aliases: true)
  end

  def steps(job)
    @cd.fetch("jobs").fetch(job).fetch("steps")
  end

  def step(job, name)
    steps(job).find { |item| item["name"] == name }.tap { |item| refute_nil item, name }
  end

  def position(job, name)
    steps(job).index(step(job, name))
  end

  CHAIN = ["Retire the migrator container application", "Publish the selected migrator", "Preview the selected native migration graph", "Apply database access", "Apply topology",
           "Apply the selected migration chain", "Verify the promoted catalog schema", "Publish the selected services", "Smoke the release"].freeze

  def test_each_environment_runs_the_complete_ordered_chain
    %w[stage promote-production].each do |job|
      positions = CHAIN.map { |name| position(job, name) }
      assert_equal positions.sort, positions
      CHAIN.each { |name| refute step(job, name).key?("if"), "#{job}: #{name} must not omit a snapshot unit" }
    end
  end

  # The Prisma flip (#1625) meets a staging database still carrying the retired Atlas chain's
  # objects, and the baseline would CREATE onto them (42710). The owner approved rebuilding
  # staging, and a deploy happens only in CD, so the rebuild is a step of the staging job: after
  # the migrator it would be refused by is published, before that migrator's preview. The step
  # carries no `if:` — the script's own gate (reset-staging-baseline.test.sh) makes every later
  # run a no-op, and a workflow condition could only skip the cutover it exists for.
  RESET = "Rebuild a staging schema stranded on the Atlas chain".freeze

  def test_staging_rebuilds_a_stranded_schema_between_the_publish_and_the_preview
    reset = step("stage", RESET)
    assert_equal "bash infra/database-access/reset-staging-baseline.sh", reset["run"]
    refute reset.key?("if"), "the script's gate decides whether to rebuild, not the workflow"
    assert_operator position("stage", "Publish the selected migrator"), :<, position("stage", RESET)
    assert_operator position("stage", RESET), :<, position("stage", "Preview the selected native migration graph")
  end

  def test_only_the_staging_environment_runs_the_rebuild
    assert_equal "staging", @cd.dig("jobs", "stage", "environment")
    holders = @cd.fetch("jobs").select { |_id, job| job.to_s.include?("reset-staging") }.keys
    assert_equal ["stage"], holders
  end

  def test_no_affected_package_filter
    refute_match(/needs\.plan|fromJSON/, @cd.to_s)
  end

  # (#1865) The generated provider SDKs do not travel in git: the directory's
  # `.gitignore` excludes `sdks/` and reproduces them from Pulumi.yaml's pinned
  # `packages:` with `pulumi install`. A hydrated snapshot whose SDK was sealed
  # elsewhere still resolves `@pulumi/neon` through pnpm's store minus the SDK's
  # gitignored `bin/`, and the apply dies on `Cannot find module './utilities'`
  # — so each lane that applies database access materialises the SDKs itself,
  # before the frozen install packs them and before the apply runs.
  MATERIALISE = "Materialise the generated provider SDKs"
  SDK_DIR = "release/foundation/infra/database-access"

  # Match on behaviour: a step that uses pulumi/actions to run `up` against
  # the database-access directory.  The old name-based match (`item["name"] ==
  # "Apply database access"`) missed lanes whose step carried a different label
  # but identical workload (#1866).
  def apply_jobs
    @cd.fetch("jobs").select do |_id, job|
      job["steps"].any? do |item|
        item["uses"].to_s.start_with?("pulumi/actions@") &&
          item.dig("with", "command") == "up" &&
          item.dig("with", "work-dir") == SDK_DIR
      end
    end.keys.sort
  end

  # A third lane whose step name differs but whose workload is identical must
  # still be caught by apply_jobs.  The old name-based filter let it escape
  # because the label "Apply the database access stack" ≠ "Apply database access"
  # (#1866).
  def test_behaviour_matching_catches_lanes_regardless_of_step_name
    payload = Psych.safe_load(<<~YAML)
      jobs:
        promote-production:
          steps:
            - name: Materialise the generated provider SDKs
              working-directory: #{SDK_DIR}
              run: pulumi install --no-dependencies --non-interactive
            - name: Install sealed foundation dependencies
              run: |
                pnpm install --dir release/foundation --frozen-lockfile --ignore-scripts
                pnpm install --dir release/foundation/infra/database-access --frozen-lockfile
            - name: Apply database access
              uses: pulumi/actions@v7.0.0
              with:
                command: up
                stack-name: lifeodyssey/prod
                work-dir: #{SDK_DIR}
        stage:
          steps:
            - name: Materialise the generated provider SDKs
              working-directory: #{SDK_DIR}
              run: pulumi install --no-dependencies --non-interactive
            - name: Install sealed foundation dependencies
              run: |
                pnpm install --dir release/foundation --frozen-lockfile --ignore-scripts
                pnpm install --dir release/foundation/infra/database-access --frozen-lockfile
            - name: Apply database access
              uses: pulumi/actions@v7.0.0
              with:
                command: up
                stack-name: lifeodyssey/staging
                work-dir: #{SDK_DIR}
        third-lane:
          steps:
            - name: Materialise the generated provider SDKs
              working-directory: #{SDK_DIR}
              run: pulumi install --no-dependencies --non-interactive
            - name: Install sealed foundation dependencies
              run: |
                pnpm install --dir release/foundation --frozen-lockfile --ignore-scripts
                pnpm install --dir release/foundation/infra/database-access --frozen-lockfile
            - name: Apply the database access stack
              uses: pulumi/actions@v7.0.0
              with:
                command: up
                stack-name: lifeodyssey/staging
                work-dir: #{SDK_DIR}
    YAML
    original = @cd
    @cd = payload
    begin
      assert_equal %w[promote-production stage third-lane], apply_jobs,
                   "behaviour matching must catch a lane whose step is named differently"
    ensure
      @cd = original
    end
  end

  # The "Apply topology" step also uses pulumi/actions with `up`, but targets
  # release/foundation/infra (not database-access).  It must not be pulled into
  # apply_jobs — widening the match to catch every Pulumi step would break the
  # guard in the other direction (#1866).
  def test_non_database_access_pulumi_steps_are_excluded
    refute apply_jobs.include?("select"), "the 'select' job has no pulumi/actions steps"
    # Both stage and promote-production have an 'Apply topology' step that uses
    # pulumi/actions@... with `up` and work-dir: release/foundation/infra —
    # that is NOT SDK_DIR, so it must not count.
    %w[stage promote-production].each do |job|
      topology = steps(job).find { |s| s["name"] == "Apply topology" }
      assert topology, "#{job} must have an 'Apply topology' step"
      assert topology["uses"].to_s.start_with?("pulumi/actions@"), "#{job}: Apply topology uses pulumi/actions"
      refute_equal SDK_DIR, topology.dig("with", "work-dir"),
                   "#{job}: Apply topology targets infra, not database-access — must not match apply_jobs"
    end
  end

  def test_each_lane_that_applies_database_access_materialises_the_generated_sdks_first
    assert_equal %w[promote-production stage], apply_jobs,
                 "the lanes running 'pulumi up' against #{SDK_DIR} moved — the materialisation rule below pins them so it cannot pass vacuously"
    apply_jobs.each do |job|
      materialise = steps(job).find { |item| item["name"] == MATERIALISE }
      assert materialise, "#{job}: runs 'pulumi up' against #{SDK_DIR} without the '#{MATERIALISE}' step " \
                          "that materialises the generated provider SDKs (#1865)"
      assert_equal SDK_DIR, materialise["working-directory"]
      assert_equal "pulumi install --no-dependencies --non-interactive", materialise["run"],
                   "#{job}: the materialisation must reproduce Pulumi.yaml's pinned packages without running a second, unfrozen dependency install"
      refute materialise["if"], "#{job}: #{MATERIALISE} must not be skippable"
      refute materialise["continue-on-error"], "#{job}: #{MATERIALISE} must fail the lane when it fails"
      assert_operator position(job, MATERIALISE), :<, position(job, "Install sealed foundation dependencies"),
                     "#{job}: the SDKs must be materialised before the frozen install packs them into pnpm's store"
      assert_operator position(job, MATERIALISE), :<, position(job, "Apply database access"),
                     "#{job}: materialise the generated provider SDKs before 'Apply database access' (#1865)"
    end
  end

  # (#1865) The root foundation install keeps scripts suppressed, but the
  # database-access install must both stay frozen — the directory carries its
  # own lockfile — and let the SDK's own `postinstall` (`tsc`, allowlisted by
  # its `pnpm-workspace.yaml`) build the gitignored `bin/` into the store copy.
  def test_the_database_access_install_stays_frozen_and_lets_the_sdk_build
    apply_jobs.each do |job|
      lines = step(job, "Install sealed foundation dependencies")["run"].split("\n")
      assert_equal 2, lines.length, "#{job}: unexpected foundation install shape"
      assert_equal "pnpm install --dir release/foundation --frozen-lockfile --ignore-scripts", lines[0]
      assert_equal "pnpm install --dir release/foundation/infra/database-access --frozen-lockfile", lines[1],
                   "#{job}: the database-access install must stay frozen; the directory carries its own lockfile (#1865)"
      refute_match(/--ignore-scripts/, lines[1],
                   "#{job}: suppressing scripts leaves the SDK's store copy without its gitignored `bin/`, " \
                   "and the apply dies on \"Cannot find module './utilities'\" (#1865)")
    end
  end

  def test_only_read_only_observation_and_receipt_upload_follow_smoke
    %w[stage promote-production].each do |job|
      after = steps(job).drop(position(job, "Smoke the release") + 1)
      assert_equal 2, after.length
      assert_equal "Record observed deployment identities", after.first["name"]
      assert_match %r{\Aactions/upload-artifact@}, after.last["uses"]
      refute_match(/wrangler deploy|publish-services|migrate-through-worker|command.*up/, after.to_s)
    end
  end
end
