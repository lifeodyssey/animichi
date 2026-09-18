# frozen_string_literal: true
require 'open3'
require 'json'
require 'psych'
require_relative 'selection'

# Compare every tracked infrastructure and migration byte with the accepted
# source commit, including the marker. A self-declared manifest cannot omit A.
module ReleaseSourceClosure
  ROOT_FILES = %w[package.json pnpm-lock.yaml pnpm-workspace.yaml .pulumi.version].freeze
  NATIVE_CONTRACT = 'packages/pi-session-neon/src/contract.json'
  MIGRATION_DIRECTORIES = { 'migrations/neon' => 'migrations',
                           'packages/pi-session-neon/migrations' => 'migrator/bundle/migrations' }.freeze
  module_function

  def git(*arguments)
    output, status = Open3.capture2('git', *arguments, binmode: true)
    raise ArgumentError, 'source closure cannot be read' unless status.success?
    output
  end

  def validate(sha, root)
    paths = git('ls-tree', '-rz', '--name-only', sha, '--', 'infra', NATIVE_CONTRACT, *MIGRATION_DIRECTORIES.keys, *ROOT_FILES, *patched_dependencies(sha)).split("\0")
    ReleaseSelection.require_value(!paths.empty?, 'source closure is empty')
    ReleaseSelection.require_value((patched_dependencies(sha) - paths).empty?, 'selected dependency patch is not tracked')
    ReleaseSelection.require_value(paths.include?(NATIVE_CONTRACT), 'selected source has no native agent contract')
    paths.each { |path| validate_file(sha, root, path) }
    MIGRATION_DIRECTORIES.each { |source, sealed| validate_directory(root, paths, source, sealed) }
    true
  end

  # pnpm 11 removed the `pnpm` field from package.json; the patch map lives in
  # the workspace manifest, which is also a source-closure file.
  def patched_dependencies(sha)
    manifest = Psych.safe_load(git('show', "#{sha}:pnpm-workspace.yaml")) || {}
    manifest.fetch('patchedDependencies', {}).to_h.values
  end

  def validate_directory(root, paths, source, sealed)
    selected = paths.select { |path| path.start_with?("#{source}/") }.map { |path| path.delete_prefix("#{source}/") }.sort
    directory = File.join(root, sealed)
    actual = Dir.glob('**/*', File::FNM_DOTMATCH, base: directory).select { |path| File.file?(File.join(directory, path)) }.sort
    ReleaseSelection.require_value(selected == actual, 'selected migration chain is not the complete source chain')
  end

  def sealed_path(path)
    return 'migrator/bundle/contract.json' if path == NATIVE_CONTRACT
    pair = MIGRATION_DIRECTORIES.find { |source, _sealed| path.start_with?("#{source}/") }
    return path.sub("#{pair.first}/", "#{pair.last}/") if pair
    "foundation/#{path}"
  end

  def validate_file(sha, root, path)
    target = File.join(root, sealed_path(path))
    ReleaseSelection.require_value(File.file?(target) && !File.symlink?(target), "missing source closure file: #{path}")
    ReleaseSelection.require_value(File.binread(target) == git('show', "#{sha}:#{path}"), "source closure mismatch: #{path}")
  end
end
