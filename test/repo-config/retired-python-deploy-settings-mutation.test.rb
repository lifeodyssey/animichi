# SUT: test/repo-config/retired-python-deploy-settings.test.rb. Every probe
# copies the contract and the two files it reads into a throwaway tree, plants
# one retired setting back, and runs the copied contract; the committed files
# are never written to.
#
# Each probe plants a different shape — a Secrets Store binding, a plain var,
# and an entry in the runtime-secrets program's vendor list — because the
# contract's job is to catch the setting wherever a reintroduction would land.
require "fileutils"
require "minitest/autorun"
require "open3"
require "tmpdir"

class RetiredPythonDeploySettingsMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = "test/repo-config/retired-python-deploy-settings.test.rb"
  WRANGLER = "workers/edge/wrangler.toml"
  RUNTIME_SECRETS = "infra/database-access/runtime-secrets.ts"
  CONSEQUENCE = "reintroduce a setting whose only consumer"

  def with_tree
    Dir.mktmpdir("retired-python-deploy-settings-") do |root|
      [CONTRACT, WRANGLER, RUNTIME_SECRETS].each do |relative|
        FileUtils.mkdir_p(File.join(root, File.dirname(relative)))
        FileUtils.cp(File.join(ROOT, relative), File.join(root, relative))
      end
      yield root
    end
  end

  def run_contract(root)
    out, err, status = Open3.capture3({ "TEST_REPOSITORY_ROOT" => root }, RbConfig.ruby, File.join(root, CONTRACT))
    [status, out + err]
  end

  def reject_tree(root, label)
    status, output = run_contract(root)
    refute status.success?, "mutation survived: #{label}\n#{output}"
    assert_includes output, CONSEQUENCE, "mutation must name its consequence: #{label}"
  end

  def plant(root, relative, needle, replacement)
    path = File.join(root, relative)
    source = File.read(path)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{needle}"
    File.write(path, changed)
  end

  def test_accepts_an_unmutated_copy
    with_tree do |root|
      status, output = run_contract(root)
      assert status.success?, "an unmutated copy must pass\n#{output}"
    end
  end

  def test_rejects_a_retired_secret_binding_in_the_edge_config
    with_tree do |root|
      plant(root, WRANGLER, "\n[[env.staging.secrets_store_secrets]]\nbinding = \"TURNSTILE_SECRET\"",
            "\n[[env.staging.secrets_store_secrets]]\nbinding = \"ZEN_GO_API_KEY\"\n" \
            "store_id = \"66c9bb0faef644b4a0671bb7d90d98bd\"\nsecret_name = \"ZEN_GO_API_KEY\"\n" \
            "\n[[env.staging.secrets_store_secrets]]\nbinding = \"TURNSTILE_SECRET\"")
      reject_tree(root, "a retired secret binding reintroduced")
    end
  end

  def test_rejects_a_retired_var_in_the_edge_config
    with_tree do |root|
      plant(root, WRANGLER, "[env.staging.vars]\n", "[env.staging.vars]\nAPP_ENV = \"staging\"\n")
      reject_tree(root, "a retired var reintroduced")
    end
  end

  def test_rejects_a_retired_provider_key_in_the_runtime_secrets_program
    with_tree do |root|
      plant(root, RUNTIME_SECRETS, "  \"MIMO_API_KEY\", \"INGEST_SIGNING_KEY\",",
            "  \"MIMO_API_KEY\", \"LOGFIRE_TOKEN\", \"INGEST_SIGNING_KEY\",")
      reject_tree(root, "a retired provider key reintroduced in the program")
    end
  end
end
