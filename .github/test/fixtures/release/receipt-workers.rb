# frozen_string_literal: true

module ReleaseReceiptWorkersFixture
  module_function

  def workers
    observed = %w[catalog edge migrator users web].map { |unit| worker(unit) }
    observed.find { |worker| worker['unit'] == 'edge' }['containers'] << { 'application_id' => 'agent' }
    observed
  end

  def worker(unit)
    { 'unit' => unit, 'script_name' => "#{unit}-staging", 'containers' => [],
      'version_id' => '11111111-1111-4111-8111-111111111111',
      'deployment_id' => '22222222-2222-4222-8222-222222222222' }
  end
end
