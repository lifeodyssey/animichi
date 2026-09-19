# SUT: how apps/anitabi-egress/src may reach the network (#1792, #1824).
# The service's security argument rests on being small enough to read in one
# sitting, and its whole upstream surface is ONE call. A second call added next
# year — a helper that fetches "just this one thing" — would be a capability
# nobody reviewed, so the count is a contract rather than a convention.
#
# Two nets hold it, and each says what it can see:
#
#   the IMPORT — nothing reaches the network without a module, so every
#     specifier this source may hold is reviewed in ALLOWED_IMPORTS, and
#     `node:http` (the one module serving BOTH the inbound server and an
#     outbound client) is held by the composition root alone.
#   the CLIENT HALF — inside that file the client verbs are refused in the form
#     they arrive in: named as a member (`https.request`, and equally
#     `const dial = http.request`), or bound out of a network module under any
#     alias (`import { request as dial } from "node:http"`). A call-shaped
#     pattern sees neither the bare reference nor the alias — which is how the
#     first version of this rule could be walked around (#1806).
#
# THE STORE'S SOCKET (#1824) is the second destination these nets had to take a
# position on. The ceiling's counter is the Redis `fly redis create`
# provisions, reached over TCP, so `node:net` is a module this source holds
# legitimately — and it is held the way `node:http` is: by the composition root
# ALONE. The store module takes its connection as an injected seam, exactly as
# the relay takes its fetch, so the allowance below is a fact about one file
# and one reviewed dial rather than about the package.
#
# The residual is stated rather than implied away: a member reached through a
# name computed at run time (`http[verb](…)`) is not text this scan can read.
# The import net is what keeps that small — the module it comes from is still
# one this list reviewed.
require "minitest/autorun"

class AnitabiEgressFetchSitesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  SOURCE = "apps/anitabi-egress/src"

  # The one file permitted to hold a socket module: the composition root, whose
  # whole subject is the outbound surface. Named once so the import net, the
  # client-half net and the probes below cannot drift apart.
  DIAL_COMPOSITION_ROOT = "start-egress-server.ts"

  # A socket module named by its specifier — the shape an import writes, and the
  # only shape the composition root's own dial is permitted in.
  DIAL_MODULE_SPECIFIER = %r{["'](?:node:)?(?:net|tls)["']}

  # Every module specifier this source may contain, and which module may hold
  # it. `:everywhere` is the deployed service — bundled from server.ts, plus
  # the capture it builds its URLs from; a named module is one that never ships
  # in that bundle. A specifier added anywhere here is a reviewed edit to this
  # map, which is the point: a call-shaped regex cannot see an alias or a
  # dynamic import, but nothing reaches the network without a module.
  ALLOWED_IMPORTS = {
    # The HMAC and the constant-time signature comparison.
    "node:crypto" => :everywhere,
    # The INBOUND server the composition root listens on. It is the one module
    # that serves an outbound client too, so it is held by the one file whose
    # whole subject is binding that server; every other module would be
    # acquiring a client (`http.request`, `https.get`) it has no reason to hold.
    "node:http" => [DIAL_COMPOSITION_ROOT],
    # The ceiling store's TCP dial (#1824). Fly Redis answers RESP over a
    # socket and nothing else, so this module is unavoidable for the counter —
    # and it is held exactly as `node:http` is, by the composition root alone.
    # `redis-tcp-ceiling-store.ts` takes its connection as an injected seam, so
    # an import there would be the store opening a destination of its own.
    "node:net" => [DIAL_COMPOSITION_ROOT],
    # The operator's address guard, which is not part of the deployed bundle:
    # it shells out to the read-only `fly ips list` to read the live address.
    "node:child_process" => ["check-egress-address.ts"],
  }.freeze

  # Every way a module specifier reaches this source: static import /
  # export-from, dynamic `import()`, `require()`, and the runtime builtin lookup
  # that skips both.
  SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|getBuiltinModule\s*\(\s*)["']([^"']+)["']/

  # The client verbs of a network module. `createServer` is deliberately absent:
  # listening is what this service is allowed to do with these modules.
  CLIENT_VERB = /(?<![A-Za-z0-9_$])(?:request|get|connect|createConnection|resolve|lookup)(?![A-Za-z0-9_$])/

  # The client half named as a member of the module that holds it. Matched
  # WITHOUT requiring a call: `const dial = http.request` is the same
  # capability as calling it, one line earlier.
  OUTBOUND_CLIENT_MEMBER = /
    (?<![A-Za-z0-9_$])
    (?:https?|net|tls|dns|undici)
    \s*\.\s*
    (?:request|get|connect|createConnection|resolve|lookup)
    (?![A-Za-z0-9_$])
  /x

  # A network module named by its specifier — the shape every import, dynamic
  # import, require and builtin lookup writes.
  NETWORK_MODULE_SPECIFIER = /["'](?:node:)?(?:https?|net|tls|dns|undici)["']/

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

  def test_the_client_half_of_a_network_module_is_named_nowhere
    offenders = code_files.flat_map do |path|
      matches_in(path) { |line| outbound_client_line?(line, path) }.map { |number, line| "#{path}:#{number}: #{line}" }
    end
    assert_empty(offenders,
                 "the upstream is reached through the injected deps.upstreamFetch, never through a client this " \
                 "service names itself — as a member call, a bare reference it could call later, or a name bound " \
                 "out of a network module. A second egress path is a second capability:\n  #{offenders.join("\n  ")}")
  end

  # The rule's own subject, over a line rather than over the tree: a bypass has
  # to be refused in every form it can arrive in, and the composition root's one
  # inbound import has to survive. The tree scanned above contains no bypass in
  # either version of this rule, so only these lines can tell the two apart.
  # The path is a module with no dial allowance, which is the rule everything
  # but the composition root is held to.
  def test_the_client_half_is_refused_in_every_form_a_bypass_takes
    {
      "a member call" => %(await https.request({ host: "evil.test" });),
      "a member reference aliased into a local" => "const dial = http.request;",
      "a destructured import" => %(import { request } from "node:http";),
      "a renamed destructured import" => %(import { request as dial } from "node:http";),
      "a destructured require" => %(const { request: dial } = require("node:http");),
      "the runtime builtin lookup" => %(const dial = getBuiltinModule("node:http").request;),
      "the store's socket module, somewhere it may not be" => %(import { createConnection } from "node:net";),
      "a TLS socket, which this service has no destination for" => %(import { connect } from "node:tls";),
    }.each do |shape, line|
      assert outbound_client_line?(line, "#{SOURCE}/redis-tcp-ceiling-store.ts"), "#{shape} must be refused: #{line}"
    end
  end

  # The one dial the composition root is permitted (#1824), and the reason the
  # allowance is a fact about that file: the same import one module over is a
  # bypass, and the probe above says so. This is the pair that keeps the
  # exception from widening into "the package may hold a socket".
  def test_the_store_s_socket_module_is_permitted_at_the_composition_root_and_nowhere_else
    line = %(import { createConnection, type Socket } from "node:net";)
    refute outbound_client_line?(line, "#{SOURCE}/#{DIAL_COMPOSITION_ROOT}"),
           "the composition root dials the ceiling store's TCP connection, exactly as it binds the inbound server"
    assert outbound_client_line?(line, "#{SOURCE}/egress-service.ts"),
           "the same import anywhere else is a second outbound capability"
  end

  def test_the_inbound_server_module_reaches_the_composition_root_and_nothing_else
    assert allowed_import?("#{SOURCE}/#{DIAL_COMPOSITION_ROOT}", "node:http"),
           "the composition root binds the one inbound server this service listens on"
    ["egress-service.ts", "request-signature.ts", "upstream-operations.ts"].each do |file|
      refute allowed_import?("#{SOURCE}/#{file}", "node:http"),
             "#{file} may not hold node:http: its client half is an outbound destination nothing reviewed"
    end
  end

  def test_the_store_s_socket_module_reaches_the_composition_root_and_nothing_else
    assert allowed_import?("#{SOURCE}/#{DIAL_COMPOSITION_ROOT}", "node:net"),
           "the composition root dials the ceiling store's TCP connection (#1824)"
    ["redis-tcp-ceiling-store.ts", "egress-service.ts", "upstream-ceiling.ts"].each do |file|
      refute allowed_import?("#{SOURCE}/#{file}", "node:net"),
             "#{file} may not hold node:net: the store takes its connection as an injected seam, the way the " \
             "relay takes its fetch"
    end
  end

  def test_the_inbound_import_this_service_legitimately_holds_is_not_a_bypass
    refute outbound_client_line?(inbound_import, "#{SOURCE}/#{DIAL_COMPOSITION_ROOT}"),
           "binding the server to listen on is the one thing node:http is permitted for here"
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
      matches_in(path) { |line| line.match?(REFERENCE) }.map { |number, line| "#{path}:#{number}: #{line}" }
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

  # The composition root's own import of the module this contract singles out.
  def inbound_import
    code_lines("#{SOURCE}/start-egress-server.ts").find { |line| line.include?("node:http") }
  end

  # Whether a line names the client half of a network module, in either of the
  # two forms it can arrive in. `path` is what makes the rule per-file rather
  # than per-package: the composition root's own socket import is the one
  # reviewed dial (#1824), and every other file is held to the rule as written.
  # The scan and the probe test share this method on purpose: a probe against a
  # rule the scan does not use proves nothing.
  def outbound_client_line?(line, path)
    return false if permitted_dial?(line, path)

    line.match?(OUTBOUND_CLIENT_MEMBER) || (line.match?(NETWORK_MODULE_SPECIFIER) && line.match?(CLIENT_VERB))
  end

  # The one line that names a socket module where the socket is actually
  # dialed. It is deliberately narrow — a specifier, in one named file — so the
  # allowance cannot spread to a member call (`net.connect(…)`) or to a second
  # import somewhere else, both of which the rule above still refuses.
  def permitted_dial?(line, path)
    File.basename(path) == DIAL_COMPOSITION_ROOT && line.match?(DIAL_MODULE_SPECIFIER)
  end

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
    code_files.flat_map do |path|
      matches_in(path) { |line| line.match?(CALL) }.map { |number, line| "#{path}:#{number}: #{line}" }
    end
  end

  def code_files
    Dir.glob(File.join(ROOT, SOURCE, "**", "*.ts")).map { |path| path.delete_prefix("#{ROOT}/") }.sort
  end

  def matches_in(path)
    code_lines(path).each_with_index
                    .select { |line, _| yield(line) }
                    .map { |line, index| [index + 1, line.strip] }
  end

  # Comment lines carry no behaviour: these files discuss `fetch` in prose.
  def code_lines(path)
    File.readlines(File.join(ROOT, path), chomp: true)
        .reject { |line| line.lstrip.start_with?("//", "*", "/*") }
  end
end
