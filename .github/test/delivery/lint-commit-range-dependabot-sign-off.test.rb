# SUT: .github/scripts/commits/lint-commit-range.sh — the branch's own commits, when
# Dependabot wrote them
#
# Dependabot's grouped-update headers run to about 90 characters, past the 72 the
# repository holds a header to, so the range lint refused every such pull request.
# On 2026-11-21 the owner approved one exemption: a commit whose footer carries
# Dependabot's sign-off trailer as a whole line is not held to the header length,
# and every other rule still judges it. The PR title stays held to 72
# (lint-pr-title.test.rb); the squash merge uses it as `main`'s subject, with
# ` (#N)` appended.
# Each case is a real commit in a throwaway repository, linted through the
# workspace's real commitlint and the repository's own config, as
# lint-commit-range.test.rb does.
require "minitest/autorun"
require "open3"
require "tmpdir"

class LintCommitRangeDependabotSignOffTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../../..", __dir__))
  SCRIPT = File.join(ROOT, ".github/scripts/commits/lint-commit-range.sh")
  COMMITLINT = File.join(ROOT, "node_modules/.bin/commitlint")
  SIGN_OFF = "Signed-off-by: dependabot[bot] <support@github.com>"
  # The header Dependabot wrote on PR #2084: 90 characters, every other rule met.
  GROUPED_HEADER = "build(deps): bump the github-actions-minor-patch group across 3 directories with 9 updates"
  LENGTH_RULE = "header-max-length-except-dependabot"
  LENGTH_REFUSAL = "header must not be longer than 72 characters"

  def setup
    assert File.file?(COMMITLINT), "#{COMMITLINT} is not installed — run pnpm install first"
  end

  def test_dependabot_s_signed_grouped_header_passes
    assert_accepted dependabot_commit(GROUPED_HEADER), "Dependabot's signed commit is not held to the header length"
  end

  def test_a_signed_header_past_one_hundred_characters_passes
    # Past config-conventional's own 100, so the built-in rule is off rather than
    # inherited again at 100.
    header = "build(deps): bump @cloudflare/workers-types from 5.20260916.1 to 5.20261120.1 in /infra/database-access"
    assert_accepted dependabot_commit(header), "the exemption has no length ceiling of its own"
  end

  def test_a_sign_off_followed_by_another_paragraph_still_exempts
    # commitlint opens the footer at the first `Token: value` line, so a whole-line
    # sign-off is footer wherever it stands below the header: the exemption follows
    # commitlint's footer, not git's last-paragraph trailer block.
    message = dependabot_commit(GROUPED_HEADER, "#{SIGN_OFF}\n\nA paragraph added after it.")
    assert_accepted message, "a whole-line sign-off in commitlint's footer exempts wherever it stands"
  end

  def test_the_same_header_without_the_sign_off_fails_on_its_length
    assert_refused_for_length dependabot_commit(GROUPED_HEADER, "Bumps the github-actions-minor-patch group."),
                              "without the trailer the 72 still applies"
  end

  def test_a_sign_off_quoted_inside_a_body_sentence_is_not_the_trailer
    assert_refused_for_length dependabot_commit(GROUPED_HEADER, "This message quotes #{SIGN_OFF} in prose."),
                              "the trailer is a whole line, not text inside a sentence"
  end

  def test_a_footer_line_that_runs_on_past_the_sign_off_is_not_the_trailer
    # A footer line, unlike the sentence above: a rule that searched the footer for
    # the text instead of comparing whole lines would exempt this one.
    assert_refused_for_length dependabot_commit(GROUPED_HEADER, "#{SIGN_OFF} and a human reviewer"),
                              "the trailer is the whole line, with nothing after the address"
  end

  def test_a_sign_off_naming_dependabot_without_bot_is_not_dependabot_s
    assert_refused_for_length dependabot_commit(GROUPED_HEADER, "Signed-off-by: dependabot <support@github.com>"),
                              "Dependabot signs as dependabot[bot]"
  end

  def test_a_sign_off_with_another_address_is_not_dependabot_s
    # Dependabot's author address, which is not the one its trailer carries.
    sign_off = "Signed-off-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>"
    assert_refused_for_length dependabot_commit(GROUPED_HEADER, sign_off), "Dependabot signs with <support@github.com>"
  end

  def test_a_lowercase_sign_off_key_is_not_the_exact_trailer
    assert_refused_for_length dependabot_commit(GROUPED_HEADER, SIGN_OFF.sub("Signed-off-by", "signed-off-by")),
                              "the trailer is matched exactly, key case included"
  end

  def test_a_signed_header_with_an_unknown_type_still_fails_type_enum
    header = "deps: bump the github-actions-minor-patch group across 3 directories with 9 updates"
    lint_commit(dependabot_commit(header)) do |status, out|
      refute status.success?, "the trailer exempts the header length, not the type table\n#{out}"
      assert_includes out, "type-enum"
      refute_includes out, LENGTH_REFUSAL, "the length stays exempt: only the type is refused"
    end
  end

  def test_a_signed_header_with_an_unknown_scope_still_fails_scope_enum
    header = "build(dependencies): bump the github-actions-minor-patch group across 3 directories with 9 updates"
    lint_commit(dependabot_commit(header)) do |status, out|
      refute status.success?, "the trailer exempts the header length, not the scope table\n#{out}"
      assert_includes out, "scope-enum"
      refute_includes out, LENGTH_REFUSAL, "the length stays exempt: only the scope is refused"
    end
  end

  def test_an_unsigned_seventy_two_character_header_still_passes
    assert_accepted "fix(catalog): keep the egress ceilings across restarts and name refusals",
                    "at the limit an ordinary commit is legal"
  end

  private

  # Dependabot's commit shape, cut from PR #2084's down to one update: the header,
  # a body, the `updated-dependencies` YAML block and, last, the given line.
  def dependabot_commit(header, last_line = SIGN_OFF)
    <<~MESSAGE
      #{header}

      Updates `actions/checkout` from 6.0.1 to 6.0.2
      - [Release notes](https://github.com/actions/checkout/releases)

      ---
      updated-dependencies:
      - dependency-name: actions/checkout
        dependency-version: 6.0.2
        dependency-type: direct:production
        update-type: version-update:semver-patch
      ...

      #{last_line}
    MESSAGE
  end

  def assert_accepted(message, why)
    lint_commit(message) { |status, out| assert status.success?, "#{why}\n#{out}" }
  end

  # Every refused case keeps the 90-character header, so the refusal must be the
  # length rule's, reporting that length.
  def assert_refused_for_length(message, why)
    lint_commit(message) do |status, out|
      refute status.success?, "#{why}\n#{out}"
      assert_includes out, "#{LENGTH_REFUSAL}, current length is 90"
      assert_includes out, LENGTH_RULE
    end
  end

  # One commit on a branch cut from a seeded `origin/main`, linted the way the
  # `commits` job lints a pull request: the script runs from the checkout root,
  # with GIT_DIR pointing its range at the fixture.
  def lint_commit(message)
    Dir.mktmpdir("lint-commit-range-dependabot-") do |repo|
      git(repo, "init", "--initial-branch=main")
      commit(repo, "chore: seed the fixture")
      git(repo, "branch", "origin/main")
      commit(repo, message)
      out, err, status = Open3.capture3({ "GIT_DIR" => File.join(repo, ".git") }, "bash", SCRIPT, chdir: ROOT)
      yield(status, out + err)
    end
  end

  def commit(repo, message)
    git(repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.com",
        "commit", "--allow-empty", "-m", message)
  end

  def git(repo, *args)
    _, err, status = Open3.capture3("git", "-C", repo, *args)
    flunk("git #{args.join(' ')} failed: #{err}") unless status.success?
  end
end
