# SUT: the pre-push gate's routing table and the workspace it has to cover.
#
# `scripts/local-gates/pre-push-affected.sh` routes a changed path by joining
# `pnpm ls` output against its table of buckets. A package that falls out of
# that table stops being gated while every suite stays green (#1687), so the
# table's domain is pinned here against the workspace itself: the
# `pnpm-workspace.yaml` globs resolved against the tree, never a list kept in
# this file. `package-test-segments.test.rb` reads the workspace the same way.
require "minitest/autorun"
require "psych"

class PrePushRoutingTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  GATE = "scripts/local-gates/pre-push-affected.sh"
  # The declared block: `ROUTES='`, one `<directory> <bucket>…` row per line,
  # closed by a line holding only a quote.
  ROUTING_TABLE = /^ROUTES='\n(.*?)^'\n/m
  BUCKETS = %w[package agent].freeze

  def gate_source
    File.read(File.join(ROOT, GATE))
  end

  def declared_routes
    gate_source[ROUTING_TABLE, 1].to_s.lines.each_with_object({}) do |line, routes|
      directory, *buckets = line.split
      routes[directory] = buckets if directory
    end
  end

  def workspace_directories
    globs = Psych.safe_load(File.read(File.join(ROOT, "pnpm-workspace.yaml")))["packages"]
    globs.flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
         .map { |path| File.dirname(path).delete_prefix("#{ROOT}/") }.sort
  end

  def misplaced_rows
    declared_routes.reject { |_, buckets| !buckets.empty? && (buckets - BUCKETS).empty? }
  end

  def test_the_gate_declares_its_routing_table
    assert_match ROUTING_TABLE, gate_source,
                 "#{GATE}: no `ROUTES='…'` block — there is nothing left to check a package against"
  end

  def test_every_workspace_package_has_a_routing_row
    unrouted = workspace_directories - declared_routes.keys
    assert_empty unrouted,
                 "#{GATE}: #{unrouted.join(', ')} is in the workspace but in no routing row, so a change " \
                 "there is gated by nothing while every suite stays green"
  end

  def test_routing_rows_name_only_workspace_packages
    stale = declared_routes.keys - workspace_directories
    assert_empty stale, "#{GATE}: routing rows for directories no workspace package lives in: #{stale.join(', ')}"
  end

  def test_routing_rows_declare_known_buckets
    assert_empty misplaced_rows.keys,
                 "#{GATE}: every routing row needs at least one of #{BUCKETS.join(', ')}; these do not: " \
                 "#{misplaced_rows.keys.join(', ')}"
  end
end
