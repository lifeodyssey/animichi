#!/usr/bin/env ruby
# frozen_string_literal: true

# Red / restore / green mutation probes for CI↔pre-push parity (#1114).
# Probes mutate throwaway copies only — the signed-in files stay pristine.

require_relative "ci_prepush_parity_test_support"

def test_workdir_fingerprint
  nested = fingerprints_from_run("pnpm run typecheck", "infra/database-access")
  parent = fingerprints_from_run("pnpm run typecheck", "infra")
  abort "FAIL: nested workdir must differ: #{nested} vs #{parent}" if nested == parent
  abort "FAIL: got #{nested}" unless nested.include?("cmd:infra/database-access::pnpm typecheck")
  puts "PASS: working-directory is part of the fingerprint"
end

def test_ruby_c_distinct
  syn = fingerprints_from_run("ruby -c .github/scripts/foo.rb", nil)
  exe = fingerprints_from_run("ruby .github/scripts/foo.rb", nil)
  abort "FAIL: ruby -c shared execution id: #{syn} vs #{exe}" if syn == exe
  abort "FAIL: ruby -c emitted script:: #{syn}" if syn.any? { |fp| fp.start_with?("script:") }
  abort "FAIL: ruby execution missed script:: #{exe}" unless exe.include?("script:.github/scripts/foo.rb")
  puts "PASS: ruby -c vs ruby execution fingerprints"
end

def test_typos_checkpoint
  fps = fingerprints_from_run("typos", nil)
  abort "FAIL: generic run: typos must be a checkpoint, got #{fps}" unless fps.include?("cmd:typos")
  puts "PASS: generic run: command is a checkpoint"
end

def test_git_restore_is_build_plumbing
  fps = fingerprints_from_run("git restore package.json", "infra/database-access")
  abort "FAIL: hermetic build cleanup must not become a parity checkpoint: #{fps}" unless fps.empty?
  puts "PASS: git restore is hermetic build plumbing"
end

def strip_prepush_copy
  with_paths("parity-strip") do |dir, paths|
    paths.quality = File.join(dir, "quality.sh")
    File.write(paths.quality, stripped_quality)
    assert_red("strip a covered quality check from a pre-push copy", paths,
               "uncovered CI checkpoint not on the exemption list: script:.github/scripts/assert-workflow-invariants.rb")
  end
end

def add_ci_check_copy
  with_paths("parity-add") do |dir, paths|
    paths.workflows = planted_workflows(dir, extra_ci_steps)
    paths.root = dir
    assert_red("add a locally-runnable CI check without hanging it on pre-push", paths,
               "uncovered CI checkpoint not on the exemption list: script:.github/scripts/brand-new-local-check.rb")
    assert_red("generic run: command is a remainder", paths,
               "uncovered CI checkpoint not on the exemption list: cmd:typos")
  end
end

def empty_reason_copy
  with_paths("parity-reason") do |dir, paths|
    paths.exemptions = rewrite_reason(dir, CODECOV_REASON, 'reason: ""')
    assert_red("exemption with an empty reason field", paths, "exemption reason is empty")
  end
end

def waffle_reason_copy
  with_paths("parity-waffle") do |dir, paths|
    paths.exemptions = rewrite_reason(dir, CODECOV_REASON, 'reason: "cloud — not a pre-push prerequisite"')
    assert_red("exemption reason without a CI-only resource", paths, "must name a CI-only resource")
  end
end

def placeholder_reason_copy
  with_paths("parity-placeholder") do |dir, paths|
    paths.exemptions = rewrite_reason(dir, CODECOV_REASON, 'reason: "cloud: n/a — skip locally"')
    assert_red("exemption reason with a placeholder CI-only resource", paths, "must name a CI-only resource")
  end
end

def dir_scoped_copy
  extra = "      - name: Dir-scoped check\n        working-directory: infra/uncovered\n        run: pnpm run lint\n"
  with_paths("parity-dir") do |dir, paths|
    paths.workflows = planted_workflows(dir, extra)
    paths.root = dir
    assert_red("directory-scoped CI check is not covered by parent dir", paths, "cmd:infra/uncovered::pnpm lint")
  end
end

def yaml_workflow_copy
  with_paths("parity-yaml") do |dir, paths|
    paths.workflows = planted_workflows(dir, "")
    paths.root = dir
    File.write(File.join(paths.workflows, "extra-local.yaml"), YAML_ONLY_WORKFLOW)
    assert_red("merge-gating .yaml workflow is discovered", paths,
               "uncovered CI checkpoint not on the exemption list: script:.github/scripts/yaml-only-local-check.rb")
  end
end

test_workdir_fingerprint
test_ruby_c_distinct
test_typos_checkpoint
test_git_restore_is_build_plumbing
strip_prepush_copy
add_ci_check_copy
empty_reason_copy
waffle_reason_copy
placeholder_reason_copy
dir_scoped_copy
yaml_workflow_copy
assert_green("pristine tree (restore/green)", real_paths)
puts "All CI↔pre-push parity mutation probes passed."
