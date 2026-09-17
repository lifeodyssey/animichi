# frozen_string_literal: true

module ReleaseReceiptWorkersFixture
  module_function

  # #1606: the agent image left the snapshot with the edge container it belonged to, so
  # every Worker a new snapshot deploys is observed with an empty container list. A Worker
  # that still reports one is built per test, to prove the receipt refuses it.
  def workers
    %w[catalog edge migrator users web].map { |unit| worker(unit) }
  end

  def worker(unit)
    { 'unit' => unit, 'script_name' => "#{unit}-staging", 'containers' => [],
      'version_id' => '11111111-1111-4111-8111-111111111111',
      'deployment_id' => '22222222-2222-4222-8222-222222222222' }
  end
end
