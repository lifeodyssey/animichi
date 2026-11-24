# SUT: every place a test starts the Wrangler CLI sets WRANGLER_HIDE_BANNER=true.
#
# Wrangler's banner asks registry.npmjs.org for Wrangler's latest version on
# every command and keeps the answer for an hour under os.tmpdir(). CI starts
# each job with an empty temp directory, so every lane whose tests started
# Wrangler asked npm. The switch skips the banner and its check. The release
# build's runner sets it for every build it makes, the sealed-bundle tests'
# builds included, and `.github/test/delivery/release-wrangler-build.test.rb`
# holds that; this rule holds each start a test makes itself, and it reads the
# tree rather than a list, so a start added later is held too.
#
# A test file is a tracked script, TypeScript or JavaScript source under a test
# directory (`test/`, `tests/`, `*-test/`, `bundle-smoke/`), a `*.test.*` or
# `*.spec.*` file, or a file of the e2e package. A start is a line that names
# Wrangler's launcher (`bin/wrangler.js`), its CLI module (`resolve("wrangler")`),
# or `exec wrangler` or `npx wrangler`, written as an argv array or as a shell
# command. A file with a start must set the switch.
#
# What a scan of text cannot see: it reads files, not calls, so a file that sets
# the switch for one start and gives another an environment without it passes;
# and a start behind a package script (`pnpm run dev`) names no Wrangler where
# it starts.
require "minitest/autorun"
require "open3"

class WranglerUpdateCheckTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  TEST_FILE = %r{(?:\A|/)(?:tests?|[^/]+-test|bundle-smoke)/|\.(?:test|spec)\.[^/]+\z|\Ae2e/}
  SOURCE = /\.(?:[cm]?[jt]s|sh)\z/
  START = /wrangler\.js(?!on)|resolve\(\s*["']wrangler["']\s*\)|\b(?:exec|npx)["']?\s*,?\s*["']?wrangler\b/
  SWITCH = /WRANGLER_HIDE_BANNER["']?\s*[:=]\s*["']?true\b/
  # A linked worktree's hooks export GIT_DIR, which would point git at another index than ROOT's.
  GIT_ENV = { "GIT_DIR" => nil, "GIT_WORK_TREE" => nil, "GIT_INDEX_FILE" => nil }.freeze

  def test_every_test_that_starts_wrangler_hides_its_banner
    offenders = files_that_start_wrangler.reject { |path| read(path).match?(SWITCH) }
    assert_empty offenders, <<~MESSAGE
      These test files start Wrangler without WRANGLER_HIDE_BANNER=true, so its banner asks
      registry.npmjs.org for Wrangler's latest version on every run. Set the switch in the
      environment each start gets:
        #{offenders.join("\n  ")}
    MESSAGE
  end

  private

  def files_that_start_wrangler
    tracked.grep(TEST_FILE).grep(SOURCE).select { |path| read(path).match?(START) }
  end

  def tracked
    out, err, status = Open3.capture3(GIT_ENV, "git", "ls-files", "-z", chdir: ROOT)
    assert status.success?, "git ls-files failed: #{err}"
    out.split("\0")
  end

  def read(path)
    File.read(File.join(ROOT, path))
  end
end
