# frozen_string_literal: true

require "fileutils"
require "stringio"
require "tmpdir"
require_relative "ci_prepush_parity"

ORIGINAL_STDOUT = $stdout
ORIGINAL_STDERR = $stderr
CODECOV_REASON = 'reason: "OIDC: codecov-action — coverage upload authenticates with GitHub OIDC"'
YAML_ONLY_WORKFLOW = <<~YAML
  on:
    pull_request:
  jobs:
    extra:
      runs-on: ubuntu-latest
      steps:
        - run: ruby .github/scripts/yaml-only-local-check.rb
YAML

def swap_stdio
  out = StringIO.new
  $stdout = $stderr = out
  out
end

def parity_exit(paths)
  found = parity_violations(paths)
  puts(found.empty? ? "CI↔pre-push parity: remainder is fully exempted with reasons" : found.sort)
  found.empty? ? 0 : 1
end

def run_parity(paths)
  out = swap_stdio
  rc = parity_exit(paths)
  [out.string, rc]
ensure
  $stdout = ORIGINAL_STDOUT
  $stderr = ORIGINAL_STDERR
end

def real_paths
  default_parity_paths
end

def copy_workflows(src, dst)
  Dir.mkdir(dst)
  Dir.glob(File.join(src, "*.{yml,yaml}")).each { |path| FileUtils.cp(path, dst) }
end

def assert_red(label, paths, fragment)
  text, rc = run_parity(paths)
  abort "FAIL: #{label} must be rejected, got exit #{rc}:\n#{text}" if rc.zero?
  abort "FAIL: #{label} expected #{fragment.inspect}:\n#{text}" unless text.include?(fragment)
  puts "PASS: #{label} rejected (#{fragment})"
end

def assert_green(label, paths)
  text, rc = run_parity(paths)
  abort "FAIL: #{label} must pass, got exit #{rc}:\n#{text}" unless rc.zero?
  abort "FAIL: #{label} missing summary:\n#{text}" unless text.include?("remainder is fully exempted")
  puts "PASS: #{label}"
end

def with_paths(prefix)
  Dir.mktmpdir(prefix) { |dir| yield dir, real_paths.dup }
end

def planted_workflows(dir, extra)
  wf_dir = File.join(dir, ".github", "workflows")
  FileUtils.mkdir_p(File.dirname(wf_dir))
  copy_workflows(real_paths.workflows, wf_dir)
  path = File.join(wf_dir, "reusable-static-quality.yml")
  anchor = "      - name: Ruby syntax check workflow meta scripts\n"
  source = File.read(path)
  abort "FAIL: static-quality insertion anchor missing" unless source.include?(anchor)
  File.write(path, source.sub(anchor, "#{extra}#{anchor}"))
  wf_dir
end

def extra_ci_steps
  "      - name: Brand-new locally-runnable check\n" \
    "        run: ruby .github/scripts/brand-new-local-check.rb\n" \
    "      - name: Generic typos check\n" \
    "        run: typos\n"
end

def stripped_quality
  File.read(real_paths.quality).lines.reject do |line|
    line.strip == 'run ruby "$GS/assert-workflow-invariants.rb"'
  end.join
end

def rewrite_reason(dir, from, to)
  copy = File.join(dir, "exemptions.yml")
  File.write(copy, File.read(real_paths.exemptions).sub(from, to))
  copy
end
