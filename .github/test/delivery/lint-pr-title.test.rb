# SUT: .github/scripts/commits/lint-pr-title.sh — the title a squash merge will write
#
# Behavioral proof for #1858: the lint judges the title as it is when the job
# runs, through the workspace's real commitlint and the repository's own config —
# never a stub's reading of the rules. A stubbed `gh` stands in for the API and
# records what it was asked for, so every case also proves which pull request the
# script queried. The stale-payload case is the regression itself: on #1857 a
# rerun replayed the event that started the run and reported `current length is
# 73` after the title was already fixed, in text byte-identical to the first
# failure; here the event env carries the stale title and only the API's answer
# may make the lint green.
require "minitest/autorun"
require "open3"
require "fileutils"
require "tmpdir"

class LintPrTitleTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../../..", __dir__))
  SCRIPT = File.join(ROOT, ".github/scripts/commits/lint-pr-title.sh")
  COMMITLINT = File.join(ROOT, "node_modules/.bin/commitlint")
  REPO = "lifeodyssey/animichi"
  NUMBER = "1858"
  # Commitlint's own refusal text for the mutation below — the bytes the card
  # was filed for, quoted back so a changed message fails this loudly.
  OVER_LIMIT = "header-max-length"
  CURRENT_LENGTH = "current length is 73"

  def setup
    refute_nil COMMITLINT
    assert File.file?(COMMITLINT), "#{COMMITLINT} is not installed — run pnpm install first"
  end

  def test_a_seventy_three_character_title_fails_header_max_length
    lint_with_gh_returning(title(73)) do |status, out|
      refute status.success?, "a title one past the limit must fail the lint"
      assert_includes out, OVER_LIMIT, "the refusal must name header-max-length"
      assert_includes out, CURRENT_LENGTH, "the refusal must report the length commitlint measured"
    end
  end

  def test_a_seventy_two_character_title_passes
    lint_with_gh_returning(title(72)) do |status, out|
      assert status.success?, "at the limit the title is legal\n#{out}"
    end
  end

  def test_a_rerun_lints_the_title_as_it_is_now_not_as_the_event_carried_it
    # The env the pre-#1858 step would have held on a payload replay: the stale,
    # over-limit title. Only the API's answer may be read, so this is green.
    lint_with_gh_returning(title(67), stale_event_env: { "PR_TITLE" => title(73) }) do |status, out|
      assert status.success?, "the API's fixed title passes; the stale payload env must not be read\n#{out}"
      refute_includes out, CURRENT_LENGTH
      assert gh_calls.any?, "green without a fetch would be vacuous — the title must have been read"
    end
  end

  def test_the_title_is_fetched_from_the_pull_request_the_wiring_names
    lint_with_gh_returning(title(20)) do |status, _|
      assert status.success?
      assert_includes gh_calls.join("\n"), "repos/#{REPO}/pulls/#{NUMBER}",
                      "the script must query the pull request the workflow handed it"
      assert_includes gh_calls.join("\n"), "--jq .title",
                      "the script must read the title, not another field"
    end
  end

  def test_a_missing_pull_request_number_fails_closed
    lint_with_gh_returning(title(72), env: { "PR_NUMBER" => "" }) do |status, out|
      refute status.success?, "an unread title must stop the lane, not pass by absence"
      assert_includes out, "pull_request number", "the refusal must name the missing wiring"
    end
  end

  def test_a_failed_title_fetch_fails_the_lint
    lint_with_gh_returning(title(72), gh_fails: true) do |status, out|
      refute status.success?, "a title the API refused to give must not read as green"
      assert_includes out, "the API is unreachable"
    end
  end

  private

  # A conventional title of exactly `length` characters: legal except, past 72,
  # for header-max-length — so a red run names that rule and nothing else.
  def title(length)
    "ci: #{'x' * (length - 'ci: '.length)}"
  end

  def lint_with_gh_returning(fixture_title, env: {}, stale_event_env: {}, gh_fails: false)
    Dir.mktmpdir("lint-pr-title-") do |dir|
      bin = File.join(dir, "bin")
      FileUtils.mkdir_p(bin)
      calls = File.join(dir, "gh-calls.log")
      File.write(File.join(bin, "gh"), <<~STUB)
        #!/usr/bin/env bash
        printf '%s\\n' "$*" >> #{calls.inspect}
        if [ -n "${GH_STUB_FAIL:-}" ]; then
          echo "gh: the API is unreachable" >&2
          exit 1
        fi
        printf '%s\\n' #{fixture_title.inspect}
      STUB
      FileUtils.chmod(0o755, File.join(bin, "gh"))
      script_env = {
        "PR_NUMBER" => NUMBER,
        "PR_REPO" => REPO,
        "GH_TOKEN" => "stub-token",
        "GH_STUB_FAIL" => gh_fails ? "1" : "",
        "PATH" => "#{bin}:#{ENV['PATH']}"
      }.merge(stale_event_env).merge(env)
      out, err, status = Open3.capture3(script_env, "bash", SCRIPT, chdir: ROOT)
      @gh_calls = File.file?(calls) ? File.readlines(calls, chomp: true) : []
      yield(status, out + err)
    end
  end

  def gh_calls
    @gh_calls ||= []
  end
end
