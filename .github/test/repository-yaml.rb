# The one place `.github/test` calls the YAML library. A test reads a workflow, an
# action manifest or another repository file with `load_file`, parses YAML text it
# already holds (a workflow's source, a paths-filter `filters` block, an inline
# fixture) with `parse`, and writes a mutated document back with `dump`. Documents
# come back exactly as Psych read them.
#
# `triggers` is the one statement of the rule YAML 1.1 forces on a workflow: Psych
# reads an unquoted `on:` key as the boolean `true`, where GitHub reads the string
# "on". A workflow's triggers are whichever of the two keys it has, returned as
# written: a String, an Array, a Hash, or nil when it declares none. A workflow
# that has both is refused rather than letting one of them win.
require "psych"

module RepositoryYaml
  # Psych.safe_load's defaults (plain data only: no symbols, dates or Ruby
  # objects) plus aliases, which every workflow file this suite read already allowed.
  OPTIONS = { aliases: true }.freeze

  module_function

  def load_file(path)
    parse(File.read(path))
  end

  def parse(text)
    Psych.safe_load(text, **OPTIONS)
  end

  def dump(document)
    Psych.dump(document)
  end

  def triggers(workflow)
    declared = workflow.slice(true, "on")
    raise ArgumentError, "a workflow declares its triggers twice: #{declared.keys.inspect}" if declared.size > 1
    declared.values.first
  end
end
