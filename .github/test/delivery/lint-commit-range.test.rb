# SUT: .github/scripts/commits/lint-commit-range.sh — the branch's own commits
#
# AC3 of #1858, as its own program: the merge-base range lint still fails on a
# bad commit subject — a separate check from the title lint, never merged into
# it. The fixture is a real throwaway git repository; the lint runs through the
# workspace's real commitlint and the repository's own config (the script's
# working directory is the checkout root, exactly as the job runs it), with
# GIT_DIR pointing the range at the fixture the way the job's checkout points it
# at the branch.
require "minitest/autorun"
require "open3"
require "fileutils"
require "tmpdir"

class LintCommitRangeTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../../..", __dir__))
  SCRIPT = File.join(ROOT, ".github/scripts/commits/lint-commit-range.sh")
  COMMITLINT = File.join(ROOT, "node_modules/.bin/commitlint")

  def setup
    assert File.file?(COMMITLINT), "#{COMMITLINT} is not installed — run pnpm install first"
  end

  def test_a_bad_commit_subject_in_the_range_fails_the_lint
    in_fixture_repo do |repo|
      seed(repo, "a.txt", "chore: seed the fixture")
      branch(repo, "origin/main")
      seed(repo, "b.txt", "fix: wip")
      lint(repo) do |status, out|
        refute status.success?, "a subject the repository rejects must fail the range lint"
        assert_includes out, "outcome-not-generic", "the refusal must name the rule"
      end
    end
  end

  def test_a_range_of_valid_subjects_passes
    in_fixture_repo do |repo|
      seed(repo, "a.txt", "chore: seed the fixture")
      branch(repo, "origin/main")
      seed(repo, "b.txt", "fix: probe the branch's own subject")
      lint(repo) do |status, out|
        assert status.success?, "a branch of valid messages is green\n#{out}"
      end
    end
  end

  def test_a_subject_main_already_carries_is_not_the_branch_s_own
    in_fixture_repo do |repo|
      seed(repo, "a.txt", "fix: wip")
      branch(repo, "origin/main")
      seed(repo, "b.txt", "fix: probe the branch's own subject")
      lint(repo) do |status, out|
        assert status.success?,
               "the range is the branch's own commits from the merge base; main's merged subject is not one\n#{out}"
      end
    end
  end

  def test_an_empty_range_lints_nothing_and_passes
    in_fixture_repo do |repo|
      seed(repo, "a.txt", "chore: seed the fixture")
      branch(repo, "origin/main")
      lint(repo) do |status, out|
        assert status.success?, "a branch at the merge base adds zero commits; nothing to read\n#{out}"
      end
    end
  end

  private

  def in_fixture_repo
    Dir.mktmpdir("lint-commit-range-") do |dir|
      repo = File.join(dir, "repo")
      FileUtils.mkdir_p(repo)
      git(repo, "init", "--initial-branch=main")
      git(repo, "config", "user.email", "fixture@example.com")
      git(repo, "config", "user.name", "fixture")
      yield repo
    end
  end

  def seed(repo, name, message)
    File.write(File.join(repo, name), "#{message}\n")
    git(repo, "add", name)
    git(repo, "commit", "-m", message)
  end

  def branch(repo, name)
    git(repo, "branch", name)
  end

  def git(repo, *args)
    out, err, status = Open3.capture3("git", "-C", repo, *args)
    flunk("git #{args.join(' ')} failed: #{err}") unless status.success?
    out
  end

  def lint(repo)
    out, err, status = Open3.capture3({ "GIT_DIR" => File.join(repo, ".git") }, "bash", SCRIPT, chdir: ROOT)
    yield(status, out + err)
  end
end
