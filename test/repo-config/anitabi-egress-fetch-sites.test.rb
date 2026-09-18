# SUT: the upstream fetch call sites in apps/anitabi-egress/src (#1792).
# The service's security argument rests on being small enough to read in one
# sitting, and its whole upstream surface is ONE call. A second call added next
# year — a helper that fetches "just this one thing" — would be a capability
# nobody reviewed, so the count is a contract rather than a convention.
require "minitest/autorun"

class AnitabiEgressFetchSitesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  SOURCE = "apps/anitabi-egress/src"

  # A CALL, not a mention. `deps.upstreamFetch(url, …)` is the one chokepoint;
  # the global `fetch` is only ever referenced, never called, below the
  # composition root. The lookbehind keeps `upstreamFetch` from matching as a
  # bare `fetch`, and the member prefix keeps `obj.fetch(...)` in scope.
  CALL = /(?<![A-Za-z0-9_$])(?:[A-Za-z_$][\w$]*\.)?(?:upstreamFetch|fetch)\s*\(/
  # The network function itself, named rather than called.
  REFERENCE = /(?<![A-Za-z0-9_$])fetch(?![A-Za-z0-9_$])/

  def test_the_service_has_exactly_one_upstream_fetch_call_site
    found = call_sites
    assert_equal 1, found.length,
                 "the service must reach the upstream from exactly one place (found #{found.length}):\n  " \
                 "#{found.join("\n  ")}\n" \
                 "Route every upstream request through the one relay in egress-service.ts instead of adding a call."
  end

  def test_the_network_function_is_named_in_exactly_one_place
    found = code_files.flat_map do |path|
      matches_in(path, REFERENCE).map { |number, line| "#{path}:#{number}: #{line}" }
    end
    assert_equal 1, found.length,
                 "the global fetch must be injected once, at the composition root (found #{found.length}):\n  " \
                 "#{found.join("\n  ")}\n" \
                 "A second reference is a second way to reach the network."
  end

  def test_the_call_sites_are_found_at_all
    refute_empty code_files, "#{SOURCE} has no source files — this contract would pass vacuously"
  end

  private

  def call_sites
    code_files.flat_map { |path| matches_in(path, CALL).map { |number, line| "#{path}:#{number}: #{line}" } }
  end

  def code_files
    Dir.glob(File.join(ROOT, SOURCE, "**", "*.ts")).map { |path| path.delete_prefix("#{ROOT}/") }.sort
  end

  def matches_in(path, pattern)
    code_lines(path).each_with_index
                    .select { |line, _| line.match?(pattern) }
                    .map { |line, index| [index + 1, line.strip] }
  end

  # Comment lines carry no behaviour: these files discuss `fetch` in prose.
  def code_lines(path)
    File.readlines(File.join(ROOT, path), chomp: true)
        .reject { |line| line.lstrip.start_with?("//", "*", "/*") }
  end
end
