# frozen_string_literal: true

module OrcaHeadless
  ModelPlan = Struct.new(:argv, :stdin_path, :stdout_path, :stderr_path)

  module ModelCommand
    module_function

    def build(input)
      return codex(input) if input.provider == "codex"

      grok(input)
    end

    def codex(input)
      result = File.join(input.state_dir, "result.md")
      argv = [input.agent, "exec", "--model", input.model, "-c",
              "model_reasoning_effort=\"#{input.effort}\"", "--approve-for-me",
              "--json", "--output-last-message", result, "-"]
      plan(input, argv, "prompt.txt")
    end

    def grok(input)
      prompt = File.join(input.state_dir, "prompt.txt")
      argv = [input.agent, "--model", input.model, "--reasoning-effort", input.effort,
              "--prompt-file", prompt, "--output-format", "streaming-messages-json"]
      plan(input, argv, "empty.stdin")
    end

    def plan(input, argv, stdin_name)
      ModelPlan.new(argv, File.join(input.state_dir, stdin_name),
                    File.join(input.state_dir, "events.jsonl"),
                    File.join(input.state_dir, "stderr.log"))
    end
  end
end
