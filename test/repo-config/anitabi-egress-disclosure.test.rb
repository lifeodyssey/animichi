# SUT: what a reader of this PUBLIC repository can learn about the egress
# (#1792). Two facts must not be in the tree, and the two are scanned over
# different spans — each says which, and why, so neither claims more than it
# checks:
#
#   a credential value — in any form: quoted, unquoted, a YAML mapping, a
#                      `?? "…"` fallback, a test fixture. Every value this
#                      repository's tests use is generated at run time. The
#                      scan covers EVERY tracked text file, and it is keyed off
#                      the SECRET NAMES the service holds rather than one of
#                      them: the signing key (#1792), and the ceiling store's
#                      address (#1810, #1824) — a second credential added to a
#                      scan that named only the first would be invisible to it,
#                      which is the failure this list exists to prevent.
#                      #1824 changed what that second name is: the store's
#                      credential is no longer a token of its own but the
#                      password INSIDE the Private URL, so the address itself
#                      is scanned for one (see STORE_CREDENTIAL_URL) rather
#                      than only for a key-shaped run beside the name.
#                      Nothing benign in this tree is caught (measured; the
#                      whole tree carries zero credential-shaped literals
#                      beside a mention of one of these names).
#   the egress address — the asset. The upstream allowlists one address; the
#                      repository is public, so publishing it would announce
#                      which address holds that privilege. The scan covers the
#                      surfaces the service is defined, called and operated from
#                      (ADDRESS_SURFACES), NOT the whole tree: 42 tracked files
#                      already carry IPv4-shaped text that is not an address —
#                      SVG path data, SSRF blocklists, version strings — and a
#                      scan that flags those is a scan that gets switched off.
#                      Within those surfaces it reaches EVERY file, dotfiles
#                      included: without `File::FNM_DOTMATCH` a `*` skips a
#                      leading dot, and `.oxlintrc.json` — or an `.env` that
#                      lands there later — is not scanned at all (#1806), which
#                      is the one place a key or an address most plausibly
#                      arrives. The residual (an address anywhere else, and one
#                      inside a file this scan reads as binary) is #1809's
#                      disclosure-scope item, stated there rather than implied
#                      away here.
#
# The address is pinned WITHOUT disclosing it: `check-egress-address.ts` reads
# the expected value from the operator's environment (`ANITABI_EGRESS_EXPECTED_IPV4`)
# and compares it against Fly. A hash in the tree was considered and rejected —
# the whole IPv4 space brute-forces in seconds, so a committed hash discloses
# the address while looking like it pins it.
require "minitest/autorun"
require "fileutils"
require "open3"
require "tmpdir"

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

  # The secret variables this service holds, and a credential-shaped literal:
  # no hyphens, no spaces, no words — a base64 or hex key. The check is the
  # line carrying BOTH, so it catches every shape the value arrives in —
  # `NAME="…"`, `NAME=…`, `NAME: …`, `process.env.NAME ?? "…"` — and still
  # ignores a descriptive placeholder (`current-key-value-from-fly-secrets`),
  # which is not a credential.
  #
  # The list is the service's secrets, not one of them: `INGEST_SIGNING_KEY` is
  # what the caller signs with, and `CEILING_STORE_URL` is where the counter
  # lives. `CEILING_STORE_TOKEN` was the second of those until #1824 and is gone
  # with the REST adapter that read it — a name left in this list would be a
  # scan watching a variable nothing sets any more, which reads exactly like
  # coverage.
  SECRET_VAR_MENTION = /INGEST_SIGNING_KEY|CEILING_STORE_URL/
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

  # The store's own credential, as #1824 configures it: the password inside the
  # Private URL `fly redis status` prints, not a token in a second variable. A
  # key-shaped run is the wrong net for it — a password need not be 24
  # characters of base64 — so this reads the address for what it is, and the
  # capture is the password the line would commit.
  STORE_CREDENTIAL_URL = %r{\brediss?://(?:[^\s"'`:@/]*):([^\s"'`/@]+)@}
  # What the docs and the probes write instead: the shape with its password in
  # angle brackets (`redis://<user>:<password>@<host>`) is a description of the
  # value, and `…` is the same word in prose. Neither is a value to commit.
  PLACEHOLDER_PASSWORD = /[<>…]/

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

  # What the scan REACHES is a property of its glob, not of its scanner, and
  # `Dir.glob`'s `*` does not match a leading dot: `.oxlintrc.json`, or an
  # `.env`/`.dev.vars` that lands on one of these surfaces later, was invisible
  # to the address scan entirely (#1806). The probe plants one in a throwaway
  # root — never this tree — and runs the real scan over it.
  def test_the_address_scan_reaches_a_dotfile_on_a_scanned_surface
    Dir.mktmpdir("egress-disclosure-dotfile-") do |root|
      planted = File.join(root, "apps/anitabi-egress/.env")
      FileUtils.mkdir_p(File.dirname(planted))
      # An address outside the documentation ranges, and NOT the operator's —
      # which is nowhere in this tree (see check-egress-address.ts).
      File.write(planted, "EGRESS_ADDRESS=203.0.114.9\n")
      status, output = run_address_scan(root)
      refute status.success?, "an address in a dotfile on a scanned surface must fail the address scan"
      assert_includes output, "apps/anitabi-egress/.env",
                      "the refusal must name the dotfile it found, not merely fail"
    end
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
      # The service's SECOND secret, in the shape a committed value would arrive
      # in (#1810): the same scanner, the same finding.
      "the store's address, quoted" => %(CEILING_STORE_URL="#{store_address(planted)}"),
      "the store's address, in a dotenv line" => "CEILING_STORE_URL=" + store_address(planted),
      # #1824 moved the store's credential INSIDE the address. A password is not
      # held to the signing key's shape, so these are the cases that say the URL
      # itself is what is read: the first one is too short to make a key-shaped
      # run at all, and only the address rule catches it.
      "a password no key-shaped run would have caught" => store_address_line("aB3dE5fG7hJ9"),
      "a Private URL pasted whole" => store_address_line(planted),
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
    assert_empty key_values_in_text("`CEILING_STORE_URL` (`fly secrets`, never in this tree)"),
                 "a variable NAME is not a value: the store's address has to be set without being written down"
    # The shape the docs write down, which is a description of the value.
    assert_empty key_values_in_text(%(fly secrets set CEILING_STORE_URL="redis://<user>:<password>@<host>:6379")),
                 "the Private URL's shape, with its password in angle brackets, is not a password"
    assert_empty key_values_in_text("`CEILING_STORE_URL` is `redis://…@fly-….upstash.io`"),
                 "an ellipsis stands in for the value in prose and is not one"
  end

  # The key scan reads TRACKED files — `git ls-files` — and a tracked dotfile is
  # in that list, so an `.env` committed to a scanned surface is scanned. That is
  # a property of the enumeration and not of the scanner, which is what #1806
  # found on the address side (`*` skipped dotfiles); the probe plants one in a
  # throwaway repository and runs the real scan over it, so a later rewrite of
  # this scan to a `Dir.glob` fails here instead of quietly covering less.
  def test_the_key_scan_reaches_a_dotfile_that_holds_a_credential
    Dir.mktmpdir("egress-key-dotfile-") do |root|
      planted = File.join(root, "apps/anitabi-egress/.env")
      FileUtils.mkdir_p(File.dirname(planted))
      File.write(planted, store_address_line(absent_store_token))
      track_everything(root)
      status, output = run_key_scan(root)
      refute status.success?, "a credential in a dotfile must fail the key scan"
      assert_includes output, "apps/anitabi-egress/.env",
                      "the refusal must name the dotfile it found, not merely fail"
    end
  end

  private

  # The address scan alone, over another root. Spawned rather than re-entered:
  # the root the scan reads is the contract's own constant, and the probe's
  # question is what THIS contract does over a tree that holds a dotfile.
  def run_address_scan(root)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, __FILE__,
                                      "--name", "/test_no_egress_address_on_a_surface/")
    [status, out + err]
  end

  # The key scan alone, over another root — the same probe shape, for the other
  # half of this contract.
  def run_key_scan(root)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, __FILE__,
                                      "--name", "/test_no_signing_key_value_anywhere/")
    [status, out + err]
  end

  # A credential-shaped value the scanner must flag, ASSEMBLED rather than
  # written out: a literal that is deliberately credential-shaped cannot sit in
  # the tree this contract scans — the scan would flag it, and so would
  # gitleaks, correctly.
  def absent_store_token
    "Y2VpbGluZy1zdG9y" + "ZS10b2tlbi10ZXN0"
  end

  # The store's address as a committed one would arrive: the Private URL with
  # its own password in it (#1824). The pieces are joined here for the same
  # reason `absent_store_token` is — the password must not read as a value in
  # this file either.
  def store_address(password)
    "redis://default:" + password + "@fly-store-test.upstash.io:6379"
  end

  # That address in the line shape it would be committed in — the constant IS
  # the URL, so the address itself is what has to be credential-shaped.
  def store_address_line(password)
    %(CEILING_STORE_URL=") + store_address(password) + %(")
  end

  # `git ls-files` is the key scan's subject, so the throwaway root has to be a
  # repository with the planted file tracked, not merely a directory.
  def track_everything(root)
    Open3.capture3("git", "init", "--quiet", chdir: root)
    Open3.capture3("git", "add", "-A", chdir: root)
  end

  def tracked_text_files
    out, err, status = Open3.capture3("git", "ls-files", "-z", chdir: ROOT)
    assert_predicate status, :success?, "git ls-files failed: #{err}"
    out.split("\0").reject { |path| binary?(path) }
  end

  def address_scanned_files
    ADDRESS_SURFACES.flat_map do |entry|
      path = File.join(ROOT, entry)
      next [entry] if File.file?(path)

      reach(path).map { |file| file.delete_prefix("#{ROOT}/") }
    end.reject { |path| path.split("/").include?("dist") || path.split("/").include?("node_modules") }
       .select { |path| File.file?(File.join(ROOT, path)) && !binary?(path) }
       .sort
  end

  # Every file under one scanned surface, dotfiles included. `File::FNM_DOTMATCH`
  # is the whole point: without it `*` skips a leading dot, so `.oxlintrc.json`
  # and any `.env`/`.dev.vars` that lands there is not scanned at all. The `.`
  # and `..` entries it also introduces are directories, and the caller's
  # `File.file?` drops them.
  def reach(path)
    Dir.glob(File.join(path, "**", "*"), File::FNM_DOTMATCH)
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

      line.match?(SECRET_VAR_MENTION) && credential_on?(line) ? line.strip : nil
    end
  end

  # Two nets, because the service's two secrets do not have the same shape: a
  # signing key sits beside its variable name as a key-shaped run, and the
  # store's password sits INSIDE the URL that names the store. Either is the
  # line's finding.
  def credential_on?(line)
    key_shaped?(line) || store_credential?(line)
  end

  # One line of prose can carry several runs, and the check is about the line: a
  # key-shaped run anywhere on it is the finding.
  def key_shaped?(line)
    line.scan(KEY_SHAPED_LITERAL).any? { |run| run.match?(KEY_NOT_A_PATH) }
  end

  # A `redis://` address with a password of its own in it. The placeholder forms
  # the docs and the probes use — `<password>`, `…` — are the shape written
  # down, and are not a value anybody committed.
  def store_credential?(line)
    line.scan(STORE_CREDENTIAL_URL).flatten.any? { |password| !password.match?(PLACEHOLDER_PASSWORD) }
  end

  def text_of(path)
    File.binread(File.join(ROOT, path)).force_encoding(Encoding::UTF_8).scrub
  end

  def read(path)
    File.read(File.join(ROOT, path))
  end
end
