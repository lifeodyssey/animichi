# SUT: the egress image's build stage (`apps/anitabi-egress/Dockerfile`), and
# the patch files `pnpm-workspace.yaml` declares, which that stage must carry.
#
# The lockfile records a hash of every patch `patchedDependencies` names, and a
# frozen install reads every one of those files, even under `--filter` for a
# package that never installs the patched dependency. The build stage copies
# only what its install needs, so a patch added for another package (#1751) left
# `docker build` stopping with "Failed to read patch file", and no lane builds
# this image to notice. This contract reads the two files and checks that each
# patch reaches the build stage at its own path before the stage's first install.
require "minitest/autorun"
require "psych"

class AnitabiEgressImageBuildTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  DOCKERFILE = "apps/anitabi-egress/Dockerfile"
  WORKSPACE_MANIFEST = "pnpm-workspace.yaml"

  def test_every_workspace_patch_reaches_the_build_stage_before_its_install
    refute_empty patch_files, "#{WORKSPACE_MANIFEST} declares no patch, so this contract would pass vacuously; " \
                              "if the last patch went, remove its COPY from #{DOCKERFILE} and this file with it"
    patch_files.each do |patch|
      landings = copies_before_install.filter_map { |source, dest| landing_of(patch, source, dest) }
      assert_includes landings, File.join(workdir, patch), missing_message(patch)
    end
  end

  private

  # The patch files, as paths from the repository root, which is the build context.
  def patch_files
    Psych.safe_load(read(WORKSPACE_MANIFEST)).fetch("patchedDependencies", {}).values
  end

  # The build stage's instructions, one per line, from its FROM to the next one.
  def build_stage
    @build_stage ||= begin
      lines = read(DOCKERFILE).gsub("\\\n", " ").lines.map(&:strip).reject { |line| line.empty? || line.start_with?("#") }
      start = lines.index { |line| line.match?(/\AFROM\s.*\sAS\s+build\z/i) }
      refute_nil start, "#{DOCKERFILE} has no `AS build` stage; point this contract at the stage that installs"
      lines.drop(start + 1).take_while { |line| !line.match?(/\AFROM\s/i) }
    end
  end

  # Each [source, destination] the stage copies from the build context before
  # its first `pnpm install`. A `--from` copy reads another stage, not the context.
  def copies_before_install
    install = build_stage.index { |line| line.match?(/\ARUN\s.*\bpnpm\s+install\b/) }
    refute_nil install, "#{DOCKERFILE}'s build stage runs no `pnpm install`, so it reads no patch"
    build_stage.first(install).grep(/\ACOPY\s/i).grep_v(/--from=/).flat_map do |line|
      *sources, dest = line.split.drop(1).reject { |token| token.start_with?("--") }
      sources.map { |source| [source, dest] }
    end
  end

  # The directory the stage's relative destinations resolve against.
  def workdir
    build_stage.grep(/\AWORKDIR\s/i).first.to_s.split.last || "/"
  end

  # Where one COPY puts `patch` in the image, or nil when it does not carry it.
  # Docker copies a file into a directory under its own name, and a directory's
  # CONTENTS into the destination.
  def landing_of(patch, source, dest)
    source = File.expand_path(source, "/").delete_prefix("/")
    into = File.expand_path(dest, workdir)
    return File.join(into, patch.delete_prefix("#{source}/")) if source.empty? || patch.start_with?("#{source}/")
    return unless source == patch

    dest.end_with?("/") || dest == "." ? File.join(into, File.basename(patch)) : into
  end

  def missing_message(patch)
    "#{DOCKERFILE}'s build stage does not copy #{patch} to that same path before its first `pnpm install`. " \
      "A frozen install reads every patch #{WORKSPACE_MANIFEST} names under `patchedDependencies`, even with " \
      "`--filter` for a package that never installs the patched dependency, so `docker build` stops with " \
      "\"Failed to read patch file\". Copy the patch, or a directory holding it, to its own path ahead of the install."
  end

  def read(path)
    File.read(File.join(ROOT, path))
  end
end
