# frozen_string_literal: true

require_relative "card_reconcile_fixtures"

# A scratch git repository in a tmpdir: a bare `origin` and a work clone whose `main` carries one
# commit. Every read runs real git, so the fixture is the same kind of read the tool makes.
module GitFixture
  COMMIT_DATE = "2026-09-16T12:00:00+00:00".freeze

  module_function

  def with_repo
    Dir.mktmpdir do |dir|
      origin = File.join(dir, "origin.git")
      repo = File.join(dir, "work")
      git("init", "-q", "--bare", "--initial-branch=main", origin)
      git("init", "-q", "--initial-branch=main", repo)
      seed(repo, origin)
      yield File.realpath(repo), origin
    end
  end

  def command
    Orca::CardReconcile::Command.new
  end

  def git(*args)
    command.capture(["git", *args], "git fixture")
  end

  def write(path, content)
    File.write(path, content)
    path
  end

  def seed(repo, origin)
    git("-C", repo, "config", "user.email", "tests@example.test")
    git("-C", repo, "config", "user.name", "Tests")
    write(File.join(repo, "first.txt"), "first\n")
    git("-C", repo, "add", "-A")
    dated_commit(repo, "first")
    git("-C", repo, "remote", "add", "origin", origin)
    git("-C", repo, "push", "-q", "-u", "origin", "main")
  end

  def dated_commit(repo, name)
    env = { "GIT_AUTHOR_DATE" => COMMIT_DATE, "GIT_COMMITTER_DATE" => COMMIT_DATE }
    system(env, "git", "-C", repo, "commit", "-qm", name, out: File::NULL, err: File::NULL)
  end
end
