# SUT: repository-yaml.rb — the one place `.github/test` calls the YAML library,
# and the one statement of the rule YAML 1.1 forces on a workflow: Psych reads an
# unquoted `on:` key as the boolean `true`, where GitHub reads the string "on".
require "minitest/autorun"
require "tmpdir"
require_relative "repository-yaml"

class RepositoryYamlTest < Minitest::Test
  def triggers(text)
    RepositoryYaml.triggers(RepositoryYaml.parse(text))
  end

  def load_file_holding(text)
    Dir.mktmpdir("repository-yaml-") do |dir|
      path = File.join(dir, "document.yml")
      File.write(path, text)
      RepositoryYaml.load_file(path)
    end
  end

  def test_an_unquoted_on_holding_one_event_is_the_workflows_trigger
    assert_equal "push", triggers("on: push\njobs: {}\n")
  end

  def test_an_unquoted_on_holding_a_list_is_the_workflows_triggers
    assert_equal %w[push pull_request], triggers("on: [push, pull_request]\njobs: {}\n")
  end

  def test_an_unquoted_on_holding_a_map_is_the_workflows_triggers
    assert_equal({ "push" => { "branches" => ["main"] }, "workflow_dispatch" => nil },
                 triggers("on:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs: {}\n"))
  end

  def test_a_quoted_on_is_the_workflows_trigger_too
    assert_equal({ "workflow_dispatch" => nil }, triggers(%("on":\n  workflow_dispatch:\njobs: {}\n)))
  end

  def test_a_workflow_without_an_on_key_has_no_triggers
    assert_nil triggers("jobs:\n  build:\n    runs-on: ubuntu-latest\n")
  end

  # Both spellings at once is two `on` keys to GitHub; neither may win silently.
  def test_a_workflow_declaring_its_triggers_twice_is_refused
    error = assert_raises(ArgumentError) { triggers(%(on: push\n"on": pull_request\njobs: {}\n)) }
    assert_includes error.message, "declares its triggers twice"
  end

  # failure-alert-mutation.test.rb writes each probe's workflow back with `dump`,
  # and the contract it runs reads that copy again.
  def test_triggers_survive_a_dump_and_a_second_parse
    workflow = RepositoryYaml.parse("on:\n  push:\n    branches: [main]\njobs: {}\n")
    again = RepositoryYaml.parse(RepositoryYaml.dump(workflow))
    assert_equal({ "push" => { "branches" => ["main"] } }, RepositoryYaml.triggers(again))
  end

  # A file comes back as Psych read it: nothing is renamed, so a non-workflow file
  # (pnpm-workspace.yaml, an action manifest) never meets the workflow rule above.
  def test_a_file_loads_as_psych_reads_it_with_aliases_resolved
    assert_equal({ true => "push", "shared" => ["a"], "reuse" => ["a"] },
                 load_file_holding("on: push\nshared: &shared [a]\nreuse: *shared\n"))
  end

  # Text parses with the same options as a file.
  def test_an_alias_in_text_resolves_to_its_anchor
    assert_equal({ "shared" => ["a/**"], "web" => ["a/**"] }, RepositoryYaml.parse("shared: &shared [a/**]\nweb: *shared\n"))
  end

  # What stays as strict as Psych.safe_load: anything but plain data is refused.
  def test_a_date_is_refused
    error = assert_raises(RuntimeError) { RepositoryYaml.parse("released: 2026-11-14\n") }
    assert_includes error.message, "unspecified class: Date"
  end

  def test_a_symbol_is_refused
    error = assert_raises(RuntimeError) { RepositoryYaml.parse("event: :push\n") }
    assert_includes error.message, "unspecified class: Symbol"
  end

  def test_a_ruby_object_is_refused
    error = assert_raises(RuntimeError) { RepositoryYaml.parse("step: !ruby/object:Object {}\n") }
    assert_includes error.message, "unspecified class: Object"
  end

  # Never `{}`: a contract that reads `fetch("jobs", {})` would pass vacuously
  # over a workflow file that holds nothing.
  def test_an_empty_document_is_nil
    assert_nil RepositoryYaml.parse("")
  end

  # The same two pins through a file, the path most contracts read by.
  def test_an_empty_file_is_nil
    assert_nil load_file_holding("")
  end

  def test_a_date_in_a_file_is_refused
    error = assert_raises(RuntimeError) { load_file_holding("released: 2026-11-14\n") }
    assert_includes error.message, "unspecified class: Date"
  end
end
