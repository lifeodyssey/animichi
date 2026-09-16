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

  private

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
