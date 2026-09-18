# SUT: what a reader of this PUBLIC repository can learn about the egress
# (#1792). Two facts must not be in the tree, and the two are scanned over
# different spans — each says which, and why, so neither claims more than it
# checks:
#
#   the signing key  — a value, in any form: quoted, unquoted, a YAML mapping,
#                      a `?? "…"` fallback, a test fixture. Every key this
#                      repository's tests use is generated at run time. The scan
#                      covers EVERY tracked text file: keyed off the variable's
#                      name, nothing benign in this tree is caught (measured;
#                      the whole tree carries zero key-shaped literals beside a
#                      mention of the variable).
#   the egress address — the asset. The upstream allowlists one address; the
#                      repository is public, so publishing it would announce
#                      which address holds that privilege. The scan covers the
#                      surfaces the service is defined, called and operated from
#                      (ADDRESS_SURFACES), NOT the whole tree: 42 tracked files
#                      already carry IPv4-shaped text that is not an address —
#                      SVG path data, SSRF blocklists, version strings — and a
#                      scan that flags those is a scan that gets switched off.
#                      The residual (an address anywhere else) is #1809's
#                      disclosure-scope item, stated there rather than implied
#                      away here.
#
# The address is pinned WITHOUT disclosing it: `check-egress-address.ts` reads
# the expected value from the operator's environment (`ANITABI_EGRESS_EXPECTED_IPV4`)
# and compares it against Fly. A hash in the tree was considered and rejected —
# the whole IPv4 space brute-forces in seconds, so a committed hash discloses
# the address while looking like it pins it.
require "minitest/autorun"
require "open3"

class AnitabiEgressDisclosureTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  # Where the address would have to be written down to define, call, or operate
  # the service: the service itself, its caller, the operator runbooks, and the
  # CI and IaC that carry its configuration. An address on one of these is a
  # live destination or a live disclosure; anywhere else it is one we cannot
  # tell apart from the SVG path data above, which is why the span stops here.
  ADDRESS_SURFACES = ["apps/anitabi-egress", "workers/catalog/src", "docs/ops", ".github", "infra"].freeze

  # RFC 5737 documentation ranges, plus the loopback and unspecified addresses a
  # test binds or calls — none of which is an egress address.
  DOCUMENTATION_RANGES = [/\A192\.0\.2\./, /\A198\.51\.100\./, /\A203\.0\.113\./, /\A127\./, /\A0\.0\.0\.0\z/].freeze
  IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/

  # The key variable, and a credential-shaped literal: no hyphens, no spaces, no
  # words — a base64 or hex key. The check is the line carrying BOTH, so it
  # catches every shape the value arrives in — `KEY="…"`, `KEY=…`, `KEY: …`,
  # `process.env.KEY ?? "…"` — and still ignores a descriptive placeholder
  # (`current-key-value-from-fly-secrets`), which is not a key.
  KEY_MENTION = /INGEST_SIGNING_KEY/
  # `/` is in base64's alphabet and in every file path, so the run alone cannot
  # tell a key from a path: `workers/catalog/wrangler` is 24 characters of that
  # alphabet, and `docs/ops/secrets.md` names it on the line carrying the
  # variable. What separates them is what a generated key has and a path does
  # not — an uppercase letter, a digit, `+` or `=`. Measured over this tree, the
  # discriminator changes exactly that one line's verdict.
  KEY_SHAPED_LITERAL = %r{[A-Za-z0-9+/=]{24,}}
  KEY_NOT_A_PATH = %r{[A-Z0-9+=]}
  # The one documented form that looks like an assignment but generates a value.
  KEY_GENERATOR = /openssl rand/

  def test_no_egress_address_on_a_surface_that_defines_or_operates_the_service
    offenders = address_scanned_files.flat_map { |path| addresses_in(path) }
    assert_empty(offenders,
                 "the egress address is the asset the upstream allowlists, and this repository is public. " \
                 "Keep it in the operator's environment (ANITABI_EGRESS_EXPECTED_IPV4) and read the live value " \
                 "from `fly ips list`; only RFC 5737 documentation addresses belong in tests:\n  " \
                 "#{offenders.join("\n  ")}")
  end

  def test_no_signing_key_value_anywhere_in_the_tree
    offenders = tracked_text_files.flat_map { |path| key_values_in(path) }
    assert_empty(offenders,
                 "a signing key value must never be in the tree, in any form — not as a default, not as a " \
                 "fixture, not unquoted. Generate one in the test (`crypto.getRandomValues` / `randomBytes`) or " \
                 "read it from the environment:\n  #{offenders.join("\n  ")}")
  end

  def test_the_expected_address_comes_from_outside_the_tree
    check = File.read(File.join(ROOT, "apps/anitabi-egress/src/check-egress-address.ts"))
    guard = File.read(File.join(ROOT, "apps/anitabi-egress/src/egress-address-guard.ts"))
    assert_includes check, "process.env",
                    "the expected address must reach the guard from the operator's environment or CI secret"
    assert_includes guard, "EXPECTED_ADDRESS_VAR",
                    "the guard's subject is the environment-supplied address, not a committed one"
    assert_empty addresses_in_text(guard),
                 "the guard itself must carry no address — the address lives outside the tree"
  end

  def test_the_address_scanner_permits_a_documentation_address_and_flags_a_real_one
    assert_empty addresses_in_text('const EGRESS = "203.0.113.9";'),
                 "RFC 5737 documentation addresses are the only IPv4 literals these tests may carry"
    assert_equal ["203.0.114.9"], addresses_in_text('const EGRESS = "203.0.114.9";'),
                 "an address just outside the documentation ranges must be flagged — the scanner can fail"
  end

  def test_the_key_scanner_flags_every_shape_the_value_reaches_the_tree_in
    # The fixtures are assembled, never written out: a literal that is
    # deliberately key-shaped cannot sit in the tree it is scanning — the
    # scanner above would flag it, and so would gitleaks, correctly.
    planted = "YW5pdGFiaS1lZ3Jl" + "c3MtdGVzdC1rZXk="
    {
      "a quoted assignment" => %(INGEST_SIGNING_KEY="#{planted}"),
      "an unquoted assignment" => "INGEST_SIGNING_KEY=" + planted,
      "a YAML mapping" => "INGEST_SIGNING_KEY: " + planted,
      "a fallback default" => %(process.env.INGEST_SIGNING_KEY ?? "#{planted}"),
    }.each do |shape, line|
      refute_empty key_values_in_text(line), "#{shape} must be flagged"
    end
    assert_empty key_values_in_text(%(INGEST_SIGNING_KEY="$(openssl rand -base64 48)")),
                 "the documented generator is the one assignment that makes a value rather than carrying one"
    assert_empty key_values_in_text(%(INGEST_SIGNING_KEY="current-key-value-from-fly-secrets")),
                 "a descriptive placeholder is not a key"
    # A PATH is the same alphabet as base64 — `/` is in both — so a path is the
    # shape this flags when it should not. `secrets.md` names the caller's
    # binding and the file it lands in on the line carrying the variable, and
    # `workers/catalog/wrangler` is 24 characters of that alphabet. A scan that
    # calls a file path a signing key is a scan that gets switched off.
    assert_empty key_values_in_text("`INGEST_SIGNING_KEY` (owner-set, `fn::secret`) -> " \
                                    "`workers/catalog/wrangler.toml` binding"),
                 "a file path is not a key: it is lowercase words joined by slashes, and a key is not"
  end

  private

  def tracked_text_files
    out, err, status = Open3.capture3("git", "ls-files", "-z", chdir: ROOT)
    assert_predicate status, :success?, "git ls-files failed: #{err}"
    out.split("\0").reject { |path| binary?(path) }
  end

  def address_scanned_files
    ADDRESS_SURFACES.flat_map do |entry|
      path = File.join(ROOT, entry)
      File.file?(path) ? [entry] : Dir.glob(File.join(path, "**", "*")).map { |file| file.delete_prefix("#{ROOT}/") }
    end.reject { |path| path.split("/").include?("dist") || path.split("/").include?("node_modules") }
       .select { |path| File.file?(File.join(ROOT, path)) && !binary?(path) }
       .sort
  end

  def binary?(path)
    # A generated or binary file is not text a reader reads; the null byte is
    # the cheapest honest test for it.
    File.binread(File.join(ROOT, path)).include?("\0")
  end

  def addresses_in(path)
    addresses_in_text(text_of(path)).map { |address| "#{path}: #{address}" }
  end

  # The scanner's own subject, over a string rather than a file.
  def addresses_in_text(text)
    text.scan(IPV4).reject { |address| DOCUMENTATION_RANGES.any? { |range| address.match?(range) } }
  end

  def key_values_in(path)
    text_of(path).each_line.with_index(1).filter_map do |line, number|
      "#{path}:#{number}: a key-shaped literal" if key_values_in_text(line).any?
    end
  end

  def key_values_in_text(text)
    text.each_line.filter_map do |line|
      next if line.match?(KEY_GENERATOR)

      line.match?(KEY_MENTION) && key_shaped?(line) ? line.strip : nil
    end
  end

  # One line of prose can carry several runs, and the check is about the line: a
  # key-shaped run anywhere on it is the finding.
  def key_shaped?(line)
    line.scan(KEY_SHAPED_LITERAL).any? { |run| run.match?(KEY_NOT_A_PATH) }
  end

  def text_of(path)
    File.binread(File.join(ROOT, path)).force_encoding(Encoding::UTF_8).scrub
  end

  def read(path)
    File.read(File.join(ROOT, path))
  end
end
