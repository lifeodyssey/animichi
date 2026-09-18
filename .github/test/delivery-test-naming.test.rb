# SUT: the delivery toolchain's tests are named after the program under test
# (#1776) — never after the workflow that happens to call it. `release-schema-gate`
# tested `schema-preflight.sh` and is `schema-preflight-refusals` now; the same
# mistake is a file named `cd-receipt` for `cd.yml` because `receipt.rb` happens
# to be one of its words.
#
# Two halves, and the second is why the first exists. Every test in the four homes
# declares the program it tests in its `# SUT:` header, and the filename must
# carry that program's name — so a file is judged against a declaration rather
# than against a guess, and a workflow-named file cannot pass on a coincidence of
# vocabulary. Both halves read the tree: the homes and the programs are globbed,
# so a new test joins the rule by landing, not by someone remembering to list it.
require "minitest/autorun"

class DeliveryTestNamingTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  # The four homes the toolchain lane runs (pr-verification-toolchain-lane.test.rb).
  # A new test in any of them is judged here.
  DELIVERY_TEST_GLOBS = [
    ".github/test/delivery/*.test.rb",
    "scripts/local-gates/*.test.sh",
    "scripts/delivery/*.test.sh",
    ".github/scripts/**/*.test.sh"
  ].freeze
  # The toolchain's own four roots (#1776) — the programs a delivery test may be
  # named after. A declaration that resolves outside them names something whose
  # change does not select this suite, which is exactly what the move was for.
  PROGRAM_GLOBS = [
    ".github/lib/**/*",
    ".github/scripts/**/*",
    "scripts/delivery/*",
    "scripts/local-gates/*"
  ].freeze
  SUT_LINE = /^#\s*SUT:(?<text>.*)$/
  # A path-like token: `schema-preflight.sh`, `.github/scripts/alert/failure-alert.rb`.
  SUT_PATH = %r{[\w][\w.\/-]*\.(?:rb|mjs|cjs|sh)\b}
  TEST_SUFFIX = /\.test\.(?:rb|sh)\z/

  def delivery_tests
    DELIVERY_TEST_GLOBS.flat_map { |glob| Dir.glob(File.join(ROOT, glob)) }
                       .select { |path| File.file?(path) }.sort
  end

  def programs
    @programs ||= PROGRAM_GLOBS.flat_map { |glob| Dir.glob(File.join(ROOT, glob)) }
                              .select { |path| File.file?(path) && !path.match?(TEST_SUFFIX) }
                              .map { |path| path.delete_prefix("#{ROOT}/") }.sort
  end

  # The `# SUT:` declaration and its continuation lines: from the header line that
  # starts one through every comment line it runs into, ending at the first line
  # that is not a comment. Lines before it (shebang, `frozen_string_literal`) are
  # skipped, not appended.
  def sut_declaration(path)
    lines = []
    File.foreach(path) do |line|
      match = line.match(SUT_LINE)
      lines << (match ? match[:text] : line.delete_prefix("#")) if match || (lines.any? && line.start_with?("#"))
      break if lines.any? && !match && !line.start_with?("#")
    end
    lines.join(" ")
  end

  # What a declaration names, resolved against the committed programs: a
  # declaration writes the program's own path or, as several do, its basename.
  def declared_programs(path)
    sut_declaration(path).scan(SUT_PATH).map(&:strip).filter_map do |candidate|
      programs.find { |program| program == candidate.delete_prefix("./") } ||
        programs.find { |program| File.basename(program) == File.basename(candidate) }
    end.uniq
  end

  # Suffix-less tokens, so `observations.mjs` matches a file named
  # `release-observation.test.rb` and `publish-services.sh` matches
  # `release-publish-services.test.rb`.
  def tokens(stem)
    stem.downcase.split(/[-_.]/).reject(&:empty?).map { |token| token.sub(/s\z/, "") }
  end

  # The filename carries the program's name when it runs through it as a whole
  # token — `release-archive` carries `archive.rb`, `seal-verify` carries
  # `seal.rb`, and `release-resolve` does not carry `resolver.rb`.
  def carries?(file_stem, program)
    subject = tokens(File.basename(program, ".*"))
    return false if subject.empty?
    tokens(file_stem).each_cons(subject.size).any? { |window| window == subject }
  end

  def test_every_delivery_test_declares_a_program_under_the_toolchain
    assert delivery_tests.any?, "no delivery-toolchain tests found — the homes moved?"
    refute_empty programs, "no programs under the toolchain's roots — this rule would pass vacuously"
    delivery_tests.each do |path|
      next if declared_programs(path).any?
      assert false, "#{relative(path)}: its `# SUT:` header names no program committed under the " \
                    "toolchain's roots (#{PROGRAM_GLOBS.join(', ')}). A delivery test declares the " \
                    "script or library it tests, so its filename can be held to that name (#1776)"
    end
  end

  def test_every_delivery_test_is_named_after_its_declared_program
    delivery_tests.each do |path|
      stem = File.basename(path, ".*")
      declared = declared_programs(path)
      next if declared.any? { |program| carries?(stem, program) }
      assert false, "#{relative(path)}: named after something other than its SUT. Its `# SUT:` header " \
                    "declares #{declared.join(', ')}, and the filename carries none of them — a test is " \
                    "named after the program it tests, not after the workflow that calls it (#1776)"
    end
  end

  private

  def relative(path)
    path.delete_prefix("#{ROOT}/")
  end
end
