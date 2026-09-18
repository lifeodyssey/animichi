# SUT: failure-alert-recipient.test.rb against mutations of the audience it guards
# (#1718 AC2). Each probe copies the scripts, the libraries and the `gh` stub into a
# throwaway root, mutates the copy and runs the committed recipient contract against
# it; the committed tree is never written. A probe that survives is a guard that
# would pass with its subject deleted. The checks are named in this file rather than
# in failure-alert-mutation.test.rb so every #678 suite keeps its own count.
require "minitest/autorun"
require "open3"
require "fileutils"
require "tmpdir"

class FailureAlertRecipientMutationTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  # Never this file: a probe runs the contract it guards, and a contract that ran
  # its own mutation suite would recurse.
  CONTRACT = %w[failure-alert-recipient.test.rb].freeze
  NOBODY = "notifies nobody"
  NOT_GREEN = "must not look green"
  HARD_CODED = "not a hard-coded login"
  ASSIGNMENT = "'assignees' => FailureAlert::Recipient.logins"
  DELIVERY = "FailureAlert::Recipient.confirm(issue, payload)"
  DERIVATION = "[FailureAlert::Api.repo.split('/').first]"

  # Everything the contract executes: the committed alerter, its libraries and the
  # `gh` stub it is driven against. The contract file itself is run from the
  # committed tree; only TEST_REPOSITORY_ROOT moves.
  def with_root
    Dir.mktmpdir("failure-alert-recipient-") do |dir|
      # The fixtures live with the contracts that use them now (#1776), so the
      # copy's parent is the moved home; `cp_r` creates the leaf, not the chain.
      FileUtils.mkdir_p(File.join(dir, ".github/test/delivery"))
      %w[scripts lib].each do |part|
        FileUtils.cp_r(File.join(ROOT, ".github", part), File.join(dir, ".github", part))
      end
      FileUtils.cp_r(File.join(ROOT, ".github/test/delivery/fixtures"), File.join(dir, ".github/test/delivery/fixtures"))
      yield dir
    end
  end

  # The recipient contract is a delivery-toolchain test now, in its own
  # directory (#1776); this twin stayed with the wiring contracts.
  def contract_path
    File.join(ROOT, ".github/test/delivery", CONTRACT.first)
  end

  def contract(dir)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => dir }, RbConfig.ruby,
                                      contract_path)
    status.success? ? "" : out + err
  end

  def probe(label, consequence)
    with_root do |dir|
      yield dir
      message = contract(dir)
      refute_empty message, "mutation survived: #{label}"
      assert_includes message, consequence, "mutation must name its consequence: #{label}"
    end
  end

  def edit(dir, path, needle, replacement)
    file = File.join(dir, ".github", path)
    source = File.read(file)
    refute_nil source[needle], "mutation needle missing: #{path}"
    File.write(file, source.sub(needle, replacement))
  end

  def test_rejects_an_alert_that_was_published_to_nobody
    probe("the create payload without an assignee", NOBODY) do |dir|
      edit(dir, "scripts/alert/failure-alert.rb", ASSIGNMENT, "'assignees' => []")
    end
  end

  def test_rejects_an_alert_that_trusts_a_dropped_audience
    probe("the published audience left unverified", NOT_GREEN) do |dir|
      edit(dir, "scripts/alert/failure-alert.rb", DELIVERY, "nil")
    end
  end

  def test_rejects_a_recipient_written_into_the_alerter
    probe("the owner spelled out instead of read from the repository", HARD_CODED) do |dir|
      edit(dir, "lib/alert/recipient.rb", DERIVATION, "['lifeodyssey']")
    end
  end
end
