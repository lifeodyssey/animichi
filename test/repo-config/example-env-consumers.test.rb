# SUT: the repository-root `.env.example`. Issue #1750 retired the settings whose
# only consumer was the deleted Python agent (#1607); what is left is the local
# env sheet a developer copies to `.env`. A name documented there that no code
# reads sends the next reader to fill in a variable nothing consumes, so every
# name must appear in a tracked source file outside the example sheets and the
# test paths — a test names a setting to prove behavior, it does not read it, and
# counting the retirement contracts' own declarations as readers is what kept this
# scan green for a name it exists to catch.
#
# `.env.test.example` is deliberately out of scope: it carries the E2E live-login
# lane's operator session, and its own comments already name each reader.
require "minitest/autorun"
require "open3"

class ExampleEnvConsumersTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  EXAMPLE = ".env.example"
  ASSIGNMENT = /^(?<name>[A-Z][A-Z0-9_]*)=/
  # The example sheets document names; they are not a consumer of their own.
  DOCUMENTATION = [".env.example", ".env.test.example"].freeze
  # A test asserts a setting exists or forbids it; neither is a reader of the
  # developer sheet, so a name only a test names has no consumer.
  TEST_PATHS = [%r{(?:\A|/)tests?/}, %r{\.(?:test|spec)\.}].freeze
  NAME_TOKEN = /\b[A-Z][A-Z0-9_]{2,}\b/

  def test_every_name_in_the_example_env_file_has_a_consumer
    names = example_names
    refute_empty names, "#{EXAMPLE} declares no name — the scan would pass vacuously"
    unread = names.reject { |name| consumers.include?(name) }
    assert_empty unread,
                 "#{EXAMPLE} documents #{unread.join(', ')}, which no other tracked file reads. " \
                 "Give it a consumer or remove it (issue #1750): a name a developer fills in for " \
                 "nothing is the Python-era sheet this contract exists to prevent"
  end

  private

  def example_names
    File.read(File.join(ROOT, EXAMPLE)).each_line.filter_map { |line| line[ASSIGNMENT, :name] }.uniq
  end

  def consumers
    @consumers ||= tracked_text_files.flat_map do |path|
      File.read(File.join(ROOT, path)).scan(NAME_TOKEN)
    end.uniq
  end

  def tracked_text_files
    out, err, status = Open3.capture3("git", "ls-files", "-z", chdir: ROOT)
    assert_predicate status, :success?, "git ls-files failed: #{err}"
    out.split("\0").reject do |path|
      DOCUMENTATION.include?(path) || path.end_with?(".md") || test_path?(path) || binary?(path)
    end
  end

  def test_path?(path)
    TEST_PATHS.any? { |pattern| path.match?(pattern) }
  end

  def binary?(path)
    File.binread(File.join(ROOT, path)).include?("\0")
  end
end
