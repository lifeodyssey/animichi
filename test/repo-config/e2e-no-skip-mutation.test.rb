# SUT: test/repo-config/e2e-no-skip.test.rb — the rule has to fire.
#
# The contract asserts the absence of something, which is exactly the shape of
# guard that survives a rewrite by passing. Every probe copies the tree it reads
# into a throwaway root, injects one skip construct, and requires the contract to
# refuse it (the committed files are never written to). A guard that cannot fail
# is not evidence (#1690).
require "minitest/autorun"
require "open3"
require "tmpdir"
require "fileutils"

class E2eNoSkipMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = File.join(ROOT, "test/repo-config/e2e-no-skip.test.rb")
  FIXTURE_FILES = %w[e2e/playwright.config.ts e2e/package.json e2e/reporters/no-skipped-tests.ts].freeze
  CONSEQUENCE = "can skip themselves"
  # The live lane's env-file flag, as the contract names it (#1813). The
  # mutations below drop it from a copy of the real command.
  ENV_FILE_FLAG = "--env-file-if-exists=../.env.test"

  # Every spelling Playwright accepts for a skipped or quarantined case.
  SKIP_MUTATIONS = {
    "a body-level test.skip" => %(test("x", async () => {\n  test.skip(!ready, "no creds");\n});\n),
    "a declaration-level test.skip" => %(test.skip("x", async () => {});\n),
    "a test.fixme" => %(test.fixme("x", async () => {});\n),
    "a test.describe.skip" => %(test.describe.skip("x", () => {});\n),
    "a describe.skip" => %(describe.skip("x", () => {});\n)
  }.freeze

  def test_the_rule_rejects_every_skip_spelling
    SKIP_MUTATIONS.each do |label, source|
      run_contract_with_spec(source, label) do |status, output|
        refute(status.success?, "mutation survived: #{label}")
        assert_includes(output, CONSEQUENCE, "mutation must name its consequence: #{label}")
      end
    end
  end

  def test_the_rule_accepts_a_real_spec
    run_contract_with_spec %(test("x", async () => { await expect(page).toHaveURL(/\\/chat/); });\n), "plain" do |status, output|
      assert(status.success?, "a spec without a skip must be accepted\n#{output}")
    end
  end

  # The exemption is a directory, not a licence: the same skip inside the
  # always-run tree is refused, and the opt-in visual tree is where it belongs.
  def test_the_rule_exempts_only_the_opt_in_visual_suite
    with_temp_root do |root|
      write_fixtures(root)
      visual_spec = File.join(root, "e2e/visual/mockup.spec.ts")
      FileUtils.mkdir_p(File.dirname(visual_spec))
      File.write(visual_spec, SKIP_MUTATIONS.fetch("a body-level test.skip"))
      status, output = run_contract(root)
      assert(status.success?, "the opt-in visual suite's skips must stay exempt\n#{output}")
    end
  end

  # The live lane's properties (#1813). Widening that assertion from an
  # exact-string pin to facts about the command is only an improvement if the
  # facts can still fail: a pin that blocked a repair traded for an assertion
  # that cannot fail would be the same defect, one layer up.
  def test_the_rule_rejects_a_lane_that_stopped_loading_the_env_file
    with_temp_root do |root|
      write_fixtures(root)
      rewrite_live_login(root) { |source| source.sub(" #{ENV_FILE_FLAG}", "") }
      status, output = run_contract(root)
      refute(status.success?, "mutation survived: the lane's env-file flag was dropped")
      assert_includes(output, ENV_FILE_FLAG, "the refusal must name the flag the lane must carry")
    end
  end

  # The other half of the property: `--env-file` REQUIRES the file, and the lane
  # must run unchanged on a machine that has none.
  def test_the_rule_rejects_a_lane_that_made_the_env_file_required
    with_temp_root do |root|
      write_fixtures(root)
      rewrite_live_login(root) { |source| source.sub("--env-file-if-exists=", "--env-file=") }
      status, = run_contract(root)
      refute(status.success?, "mutation survived: the env file was made required")
    end
  end

  private

  # The fixture lane's own command, rewritten in place. Text, not a JSON round
  # trip, so the fixture differs from the committed file by the mutation alone.
  def rewrite_live_login(root)
    path = File.join(root, "e2e/package.json")
    File.write(path, yield(File.read(path)))
  end

  def run_contract_with_spec(source, label)
    with_temp_root do |root|
      write_fixtures(root)
      File.write(File.join(root, "e2e/probe-#{label.tr(" .", "--")}.spec.ts"), source)
      yield(*run_contract(root))
    end
  end

  def write_fixtures(root)
    FIXTURE_FILES.each do |relative|
      target = File.join(root, relative)
      FileUtils.mkdir_p(File.dirname(target))
      FileUtils.cp(File.join(ROOT, relative), target)
    end
  end

  def run_contract(root)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, CONTRACT)
    [status, out + err]
  end

  def with_temp_root
    Dir.mktmpdir("e2e-no-skip-mutation-") { |dir| yield dir }
  end
end
