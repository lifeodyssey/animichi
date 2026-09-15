# SUT: the wrangler.toml paths infra documentation names; every claim must resolve, and the retired
# "root wrangler.toml" must not come back.
#
# #1649 corrected the phrase in infra/src/staging-access.ts: staging's ANON_ACCESS_ENABLED lives in
# workers/edge/wrangler.toml's [env.staging.vars], and there has been no root wrangler.toml since
# bb18f68ae moved the deployment files into their owner packages. This pins the class rather than
# the sentence — a path claim that points nowhere is how the next reader is sent to a file that does
# not exist, and the docs-path gate cannot see it because it checks docs/ tokens only. The scan is
# infra/-scoped on purpose: AC3 is about current *infra* documentation.
require "minitest/autorun"

# The tracked infra text files the assertions below read, so the scan has one implementation.
# `git ls-files` failing is a scan failure, not an empty contract, and `setup` refuses an empty
# scope before any assertion runs.
module InfraTextScan
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  SCANNED_DIRECTORY = "infra/"
  TEXT_EXTENSIONS = %w[.ts .md .json .yaml .yml .toml].freeze

  def tracked_files
    @tracked_files ||= begin
      listing = `git -C "#{ROOT}" ls-files`
      raise "git ls-files failed in #{ROOT}" unless $?.success?

      listing.split("\n").select { |path| scanned?(path) }
    end
  end

  def content(path)
    File.read(File.join(ROOT, path))
  end

  def scanned?(path)
    path.start_with?(SCANNED_DIRECTORY) && TEXT_EXTENSIONS.include?(File.extname(path))
  end
end

class WranglerPathClaimsTest < Minitest::Test
  include InfraTextScan

  RETIRED_CLAIM = /\broot\s+wrangler\.toml/i
  # A negated mention ("there is no root wrangler.toml") is the correction, not the claim.
  NEGATED_CLAIM = /\b(?:no|not|never|isn't|isnt)\s+(?:\w+\s+){0,4}\broot\s+wrangler\.toml/i
  PATH_CLAIM = %r{(?<![\w.-])([\w.-]+(?:/[\w.-]+)*/wrangler\.toml)}

  def setup
    refute_empty tracked_files, "no text file under #{SCANNED_DIRECTORY} was scanned"
  end

  def test_no_file_claims_a_root_wrangler_toml
    refute claims?("there is no root wrangler.toml"), "a negated mention is the correction"
    offenders = tracked_files.select { |path| claims?(content(path)) }
    assert_empty offenders, "these files call a wrangler.toml the root one (#{offenders.join(', ')}); " \
                            "there is no root wrangler.toml — name the owner package's file instead"
  end

  def test_every_named_wrangler_toml_exists
    missing = tracked_files.flat_map { |path| unresolved_claims(path) }
    assert_empty missing, "wrangler.toml paths that are not tracked: #{missing.join(', ')}"
  end

  def claims?(text)
    text.gsub(NEGATED_CLAIM, "").match?(RETIRED_CLAIM)
  end

  def unresolved_claims(path)
    content(path).scan(PATH_CLAIM).flatten.uniq.reject { |claim| resolves?(claim, path) }
                 .map { |claim| "#{path}: #{claim}" }
  end

  # Repo-relative, or relative to the naming file — both spellings appear in infra sources.
  def resolves?(claim, path)
    [ROOT, File.dirname(File.join(ROOT, path))].any? { |base| tracked?(File.expand_path(claim, base)) }
  end

  # The index, not the working tree: a wrangler.toml that only exists on this
  # machine is not a path the next reader can check out.
  def tracked?(candidate)
    system("git", "-C", ROOT, "ls-files", "--error-unmatch", "--",
           candidate.delete_prefix("#{ROOT}/"), out: File::NULL, err: File::NULL)
  end
end
