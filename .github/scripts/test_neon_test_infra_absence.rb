#!/usr/bin/env ruby
# frozen_string_literal: true

# Neon test-infra retirement absence contract (issue #1053, AC1).
#
# Asserts that no *test* workflow references the retired Neon control-plane key
# (`NEON_API_KEY`) or selects the live-Neon pytest arm (`TEST_DB=neon`), and that
# no workflow selects the Neon arm at all. The Neon test lane is hermetic:
# Python integration runs against the offline Docker Postgres arm
# (TEST_DB=docker), so CI mints no Neon DSN.
#
# Scope of this cardinal: the Neon *test-infra* retirement. NEON_API_KEY remains
# (legitimately) present in the Neon role/DSN *provisioning* workflows —
# cd.yml feeds the
# key only to the first-run Pulumi adoption imports that create the runtime
# service roles (ADR 0003, #926). That provisioning is core deploy
# infrastructure tracked under the migration-executor wave, NOT test-infra, so
# it is explicitly allowlisted here rather than asserted away.
#
# Assertions:
#   A. TEST_DB=neon / TEST_DB: neon appears in no workflow file.
#   B. NEON_API_KEY appears in no workflow file except the role-provisioning
#      allowlist below.
#   C. the retired neon-test-base refresh workflow is gone.

require "set"

ROOT = File.expand_path("../..", __dir__)
WORKFLOWS = File.join(ROOT, ".github/workflows")

# Role-provisioning workflows that legitimately consume NEON_API_KEY for the
# Neon service-role + Secrets Store DSN provisioning (ADR 0003, #926/#1001,
# #1048). These are deploy infrastructure, not test-infra; the key feeds only
# the first-run Pulumi adoption imports. See cd.yml.
ROLE_PROVISIONING_ALLOWLIST = Set.new(
  [
    "cd.yml",
  ],
).freeze

def workflow_files
  Dir.glob(File.join(WORKFLOWS, "*.yml")).sort.map do |path|
    rel = path.delete_prefix("#{WORKFLOWS}/")
    [rel, File.read(path)]
  end
end

def issues
  found = []
  workflow_files.each do |(rel, text)|
    # A. no workflow may select the live-Neon pytest arm.
    if text.include?("TEST_DB: neon") || text.include?("TEST_DB=neon")
      found << "#{rel}: TEST_DB=neon (live-Neon pytest arm) is retired"
    end
    # B. NEON_API_KEY only in the role-provisioning allowlist (minus comments).
    if text.include?("NEON_API_KEY") && !ROLE_PROVISIONING_ALLOWLIST.include?(rel)
      found << "#{rel}: NEON_API_KEY reference outside the role-provisioning allowlist"
    end
  end
  # C. the test-base refresh workflow must be deleted.
  found << "neon-test-base.yml must be deleted (test-base is data, not CI)" if File.exist?(
    File.join(WORKFLOWS, "neon-test-base.yml")
  )
  found.sort
end

list = issues
if list.empty?
  puts "OK: no test workflow references NEON_API_KEY or TEST_DB=neon; neon-test-base.yml is retired"
else
  puts list
  abort "AC1 (#1053) contract violated (#{list.length} issue(s))"
end
