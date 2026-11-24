# SUT: test/repo-config/wrangler-update-check.test.rb — the rule has to fire.
#
# The rule asserts an absence, the shape of guard that survives a rewrite by
# passing. Each probe writes one test file into a throwaway repository, tracks
# it, points the rule's TEST_REPOSITORY_ROOT there, and requires the rule to
# refuse the file by name. The committed tree is never written to.
require "minitest/autorun"
require "open3"
require "tmpdir"
require "fileutils"

class WranglerUpdateCheckMutationTest < Minitest::Test
  RULE = File.expand_path("wrangler-update-check.test.rb", __dir__)
  GIT_ENV = { "GIT_DIR" => nil, "GIT_WORK_TREE" => nil, "GIT_INDEX_FILE" => nil }.freeze
  # Starts without the switch, each in a shape a test writes, at a path the rule must read.
  REFUSED = {
    "the launcher, in a new package's test" =>
      ["workers/next/test/boot.ts", 'spawn(process.execPath, [join(root, "bin", "wrangler.js"), "dev"]);'],
    "an environment that replaces the caller's" =>
      ["apps/web/tests/dev.test.ts", %(const BIN = join(root, "bin/wrangler.js");\n) +
        'spawn(process.execPath, [BIN, "dev"], { env: { PATH: process.env.PATH } });'],
    "pnpm in between" =>
      ["packages/agent/integration-test/build.ts", 'execFile("pnpm", ["exec", "wrangler", "deploy", "--dry-run"]);'],
    "a shell command a server config runs" =>
      ["e2e/serve.config.ts", 'command: "pnpm --filter web run build && pnpm --filter web exec wrangler dev",'],
    "a test script's shell line" => ["scripts/serve.test.sh", "pnpm exec wrangler deploy --dry-run"],
    "npx" => ["apps/web/tests/npx.test.ts", 'execSync("npx wrangler dev");'],
    "the CLI module without its launcher" =>
      ["workers/api/bundle-smoke/profile.ts", 'execFile(process.execPath, [require.resolve("wrangler"), "check"]);'],
    "the switch turned off" =>
      ["workers/migrator/test/build.ts",
       'execFile("pnpm", ["exec", "wrangler"], { env: { ...process.env, WRANGLER_HIDE_BANNER: "false" } });']
  }.freeze
  ACCEPTED = {
    "a start that hides the banner" =>
      ["workers/next/test/boot.ts",
       'spawn(process.execPath, [join(root, "bin", "wrangler.js")], { env: { ...process.env, WRANGLER_HIDE_BANNER: "true" } });'],
    "a shell line that hides the banner" =>
      ["scripts/serve.test.sh", "WRANGLER_HIDE_BANNER=true pnpm exec wrangler deploy --dry-run"],
    "a test that reads a Wrangler config" => ["workers/next/test/config.test.ts", 'readFileSync("wrangler.json");']
  }.freeze

  def test_the_rule_refuses_every_start_without_the_switch
    REFUSED.each do |label, (path, source)|
      status, output = rule_over(path, source)
      refute status.success?, "mutation survived: #{label}"
      assert_includes output, path, "the refusal must name the file: #{label}"
    end
  end

  def test_the_rule_accepts_a_start_with_the_switch_and_a_file_without_a_start
    ACCEPTED.each do |label, (path, source)|
      status, output = rule_over(path, source)
      assert status.success?, "#{label} must be accepted\n#{output}"
    end
  end

  private

  def rule_over(path, source)
    Dir.mktmpdir("wrangler-update-check-mutation-") do |root|
      FileUtils.mkdir_p(File.dirname(File.join(root, path)))
      File.write(File.join(root, path), source)
      Open3.capture3(GIT_ENV, "git", "init", "--quiet", chdir: root)
      Open3.capture3(GIT_ENV, "git", "add", "-A", chdir: root)
      out, err, status = Open3.capture3(GIT_ENV.merge("TEST_REPOSITORY_ROOT" => root), RbConfig.ruby, RULE)
      [status, out + err]
    end
  end
end
