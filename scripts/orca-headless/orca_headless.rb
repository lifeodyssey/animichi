# frozen_string_literal: true

module OrcaHeadless
  CommandResult = Struct.new(:stdout, :stderr, :exit_code)
  InspectionResult = Struct.new(:payload, :exit_code)
  CleanupContext = Struct.new(:input, :reader, :store, :gateway, :process_observer, :launch)
  StatusContext = Struct.new(:input, :reader, :store, :gateway)
  RunnerContext = Struct.new(:state, :timeout, :process, :clock, :hold, :store)
  StartContext = Struct.new(:input, :store, :gateway, :model, :runtime_id,
                            :terminal, :task, :dispatch, :dispatch_response)
end

require_relative "orca_headless/atomic_file"
require_relative "orca_headless/command_gateway"
require_relative "orca_headless/cleanup"
require_relative "orca_headless/cleanup_commands"
require_relative "orca_headless/cleanup_guard"
require_relative "orca_headless/cleanup_workflow"
require_relative "orca_headless/evidence_reader"
require_relative "orca_headless/errors"
require_relative "orca_headless/executable_resolver"
require_relative "orca_headless/model_command"
require_relative "orca_headless/native_process_observer"
require_relative "orca_headless/receipt_store"
require_relative "orca_headless/response_verifier"
require_relative "orca_headless/runner"
require_relative "orca_headless/runner_config"
require_relative "orca_headless/runner_workflow"
require_relative "orca_headless/state_input"
require_relative "orca_headless/start_commands"
require_relative "orca_headless/start_input"
require_relative "orca_headless/start"
require_relative "orca_headless/start_workflow"
require_relative "orca_headless/status"
require_relative "orca_headless/status_evidence"
require_relative "orca_headless/status_workflow"
require_relative "orca_headless/cli"
