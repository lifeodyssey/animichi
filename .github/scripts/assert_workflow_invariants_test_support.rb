# frozen_string_literal: true

require "open3"
require "tmpdir"
require_relative "assert-workflow-invariants"

SCRIPT = File.join(__dir__, "assert-workflow-invariants.rb")

def run_assert(dir)
  out, err, status = Open3.capture3(RbConfig.ruby, SCRIPT, dir)
  [status.exitstatus, out + err]
end

# A fixture dir must contain every REQUIRED_CONTEXTS owner workflow or the
# owner-presence check fires; seed_owners regenerates every owner workflow
# straight from the table (jobs named exactly like their contexts), so the
# fixtures stay in sync when REQUIRED_CONTEXTS changes and each fixture is
# limited to the violation it is testing.
def seed_owners(dir)
  REQUIRED_CONTEXTS.group_by { |_ctx, owner| owner }.each do |owner, pairs|
    if owner == "review-gate.yml"
      seed_review_owner(dir)
      next
    end
    # Explicit indentation (no heredoc): a squiggly heredoc dedents by its
    # least-indented line and would land the job keys at column 0, making
    # `jobs:` parse empty and every seeded owner "produce nothing".
    jobs = pairs.map do |ctx, _owner|
      id = ctx.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")
      "  #{id}:\n" \
        "    name: #{ctx}\n" \
        "    runs-on: ubuntu-latest\n" \
        "    timeout-minutes: 5\n" \
        "    steps:\n" \
        "      - run: echo ok\n"
    end.join
    File.write(File.join(dir, owner), <<~YAML)
      name: #{File.basename(owner, ".yml")}
      on:
        pull_request:
        push:
          branches: [main]
        merge_group:
          branches: [main]
      permissions:
        contents: read
      concurrency:
        group: ${{ github.workflow }}-${{ github.event.merge_group.head_ref || github.head_ref || github.ref }}
        cancel-in-progress: ${{ github.event_name == 'pull_request' }}
      jobs:
      #{jobs}
    YAML
  end
end

def seed_review_owner(dir)
  File.write(File.join(dir, "review-gate.yml"), <<~YAML)
    name: review-gate
    on:
      pull_request_target:
      workflow_run:
        workflows: [CI]
        types: [completed]
    permissions:
      contents: read
    concurrency:
      group: review-${{ github.event.pull_request.number || github.event.workflow_run.head_sha }}
      cancel-in-progress: true
    jobs:
      refresh:
        name: Trusted review refresh
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
          - run: collect-target && post_with_retry pending && finish-status workflow_run.event
  YAML
end

def green_fixture(name)
  Dir.mktmpdir("b7-green-#{name}") do |dir|
    seed_owners(dir)
    yield dir
    rc, out = run_assert(dir)
    abort "FAIL: #{name} fixture must pass, got exit #{rc}:\n#{out}" unless rc.zero?
    abort "FAIL: #{name} missing one-line summary:\n#{out}" unless out.include?("all invariants hold")
  end
  puts "PASS: #{name}"
end

def red_fixture(name, expected_lines)
  Dir.mktmpdir("b7-red-#{name}") do |dir|
    seed_owners(dir)
    yield dir
    rc, out = run_assert(dir)
    abort "FAIL: #{name} fixture must fail, got exit #{rc}:\n#{out}" if rc.zero?
    expected_lines.each do |line|
      abort "FAIL: #{name} expected #{line.inspect} in output:\n#{out}" unless out.include?(line)
    end
  end
  puts "PASS: #{name} fails with #{expected_lines.size} expected violation line(s)"
end
# frozen_string_literal: true
