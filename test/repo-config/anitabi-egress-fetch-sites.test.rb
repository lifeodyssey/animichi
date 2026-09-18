# SUT: how apps/anitabi-egress/src may reach the network (#1792).
# The service's security argument rests on being small enough to read in one
# sitting, and its whole upstream surface is ONE call. A second call added next
# year — a helper that fetches "just this one thing" — would be a capability
# nobody reviewed, so the count is a contract rather than a convention.
#
# A count is only as good as its pattern, and a regex cannot see an alias:
# `const dial = https.request; dial(…)` matches no call-shaped check. So the
# boundary is drawn where a bypass cannot avoid it — the IMPORT. Nothing
# reaches the network without a module; every module this service may hold is
# reviewed in ALLOWED_IMPORTS, and the named outbound clients are refused as a
# second net over the one case the allowlist cannot separate (node:http serves
# both the inbound server and an outbound client).
require "minitest/autorun"

class AnitabiEgressFetchSitesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  SOURCE = "apps/anitabi-egress/src"

  # Every module specifier this source may contain, and which module may hold
  # it. `:everywhere` is the deployed service — bundled from server.ts, plus
  # the capture it builds its URLs from; a named module is one that never ships
  # in that bundle. A specifier added anywhere here is a reviewed edit to this
  # map, which is the point: a call-shaped regex cannot see an alias or a
  # dynamic import, but nothing reaches the network without a module.
  ALLOWED_IMPORTS = {
    # The HMAC and the constant-time signature comparison.
    "node:crypto" => :everywhere,
    # The INBOUND server the composition root listens on; its client half
    # (`http.request`, `http.get`) is refused by OUTBOUND_CLIENT_CALL below.
    "node:http" => :everywhere,
    # The operator's address guard, which is not part of the deployed bundle:
    # it shells out to the read-only `fly ips list` to read the live address.
    "node:child_process" => ["check-egress-address.ts"],
  }.freeze

  # Every way a module specifier reaches this source: static import /
  # export-from, dynamic `import()`, `require()`, and the runtime builtin lookup
  # that skips both.
  SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|getBuiltinModule\s*\(\s*)["']([^"']+)["']/

  # The client half of the modules a service may hold. `node:http` is permitted
  # above because the service LISTENS on it; this is the half that dials out.
  OUTBOUND_CLIENT_CALL = /(?<![A-Za-z0-9_$])(?:https?|net|tls|dns|undici)\s*\.\s*(?:request|get|connect|createConnection|resolve|lookup)\s*\(/

  # A CALL, not a mention. `deps.upstreamFetch(url, …)` is the one chokepoint;
  # the global `fetch` is only ever referenced, never called, below the
  # composition root. The lookbehind keeps `upstreamFetch` from matching as a
  # bare `fetch`, and the member prefix keeps `obj.fetch(...)` in scope.
  CALL = /(?<![A-Za-z0-9_$])(?:[A-Za-z_$][\w$]*\.)?(?:upstreamFetch|fetch)\s*\(/
  # The network function itself, named rather than called.
  REFERENCE = /(?<![A-Za-z0-9_$])fetch(?![A-Za-z0-9_$])/

  def test_every_imported_module_is_one_this_service_has_reviewed
    offenders = code_files.flat_map do |path|
      specifiers_in(path)
        .reject { |_, specifier| allowed_import?(path, specifier) }
        .map { |number, specifier| "#{path}:#{number}: #{specifier}" }
    end
    assert_empty(offenders,
                 "a module this source imports is not on the reviewed list. The import is where this boundary " \
                 "holds — a call-shaped check cannot see an alias or a dynamic import — so a new one is a " \
                 "deliberate edit to ALLOWED_IMPORTS, and an upstream request belongs on the one relay in " \
                 "egress-service.ts instead:\n  #{offenders.join("\n  ")}")
  end

  def test_no_module_dials_out_through_another_client
    offenders = code_files.flat_map do |path|
      matches_in(path, OUTBOUND_CLIENT_CALL).map { |number, line| "#{path}:#{number}: #{line}" }
    end
    assert_empty(offenders,
                 "the upstream is reached through the injected deps.upstreamFetch, never through a client this " \
                 "service dials itself — a second egress path is a second capability:\n  #{offenders.join("\n  ")}")
  end

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

  def test_the_scans_found_real_source_to_look_at
    refute_empty code_files, "#{SOURCE} has no source files — this contract would pass vacuously"
    refute_empty found_specifiers, "no module specifiers were found — the import check would pass vacuously"
  end

  private

  def allowed_import?(path, specifier)
    return true if relative?(specifier)

    permitted = ALLOWED_IMPORTS[specifier]
    permitted == :everywhere || (permitted.is_a?(Array) && permitted.include?(File.basename(path)))
  end

  def relative?(specifier)
    specifier.match?(%r{\A\.\.?/})
  end

  def found_specifiers
    code_files.flat_map { |path| specifiers_in(path) }
  end

  def specifiers_in(path)
    code_lines(path).each_with_index.flat_map do |line, index|
      line.scan(SPECIFIER).flatten.map { |specifier| [index + 1, specifier] }
    end
  end

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
