# frozen_string_literal: true

require "open3"
require "tmpdir"

ROOT = File.expand_path("../..", __dir__)
CONTRACT = File.join(ROOT, ".github/scripts/test_secret_scan_contract.rb")

def mutation(path, needle, replacement, env_key, label)
  Dir.mktmpdir("secret-scan-mutation-") do |dir|
    copy = File.join(dir, File.basename(path))
    source = File.read(path)
    changed = source.sub(needle, replacement)
    abort "mutation needle missing: #{label}" if changed == source
    File.write(copy, changed)
    _out, _err, status = Open3.capture3({ env_key => copy }, RbConfig.ruby, CONTRACT)
    abort "mutation survived: #{label}" if status.success?
  end
end

action = File.join(ROOT, ".github/actions/secret-scan/action.yml")
ci = File.join(ROOT, ".github/workflows/pr-verification.yml")
cross = File.join(ROOT, ".github/workflows/reusable-cross-stack-e2e.yml")
digest = "sha256:e1b35e12a8c6fa8901f060459cfb6b2fc4c484d3afbe3b029733a3bbfab07055"
mutation(action, digest, "sha256:" + ("0" * 64), "SECRET_SCAN_ACTION", "image digest drift")
range = "--log-opts=" + "$" + "{{ steps.range.outputs.range }}"
mutation(action, range, "--log-opts=HEAD^..HEAD", "SECRET_SCAN_ACTION", "resolved range bypass")
mutation(action, "/github/workspace", "*", "SECRET_SCAN_ACTION", "workspace trust widened")
author = "github.event.pull_request.user.login != 'dependabot[bot]'"
mutation(ci, author, "github.repository_owner != 'dependabot[bot]'", "SECRET_SCAN_CI", "Dependabot author guard removed")
mutation(ci, "./.github/actions/secret-scan", "gitleaks/gitleaks-action@deadbeef", "SECRET_SCAN_CI", "legacy scan action restored")
anchor = "    steps:\n"
injected = "    permissions:\n      pull-requests: read\n    steps:\n      - uses: dorny/paths-filter@deadbeef\n        id: f\n"
mutation(cross, anchor, injected, "SECRET_SCAN_CROSS_STACK", "duplicate cross-stack routing restored")
puts "Secret scan mutation probes: digest, range, eval identity, action, and routing weakening rejected"
