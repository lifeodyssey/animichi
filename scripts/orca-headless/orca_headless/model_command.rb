# frozen_string_literal: true

module OrcaHeadless
  ModelPlan = Struct.new(:argv, :stdin_path, :stdout_path, :stderr_path)

  module ModelCommand
    module_function

    def build(input)
      return codex(input) if input.provider == "codex"
      return grok(input) if input.provider == "grok"
      return pi(input) if input.provider == "pi"
      return claude(input) if input.provider == "claude"
      return kimi(input) if input.provider == "kimi"

      raise InputError, "unsupported provider: #{input.provider}"
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

    # Print mode with non-TTY stdio keeps pi out of its TUI and Chat UI; --approve trusts
    # project-local files for this run so no trust prompt can block the worker. pi reads the
    # pinned prompt file on stdin as its initial message and prints its response as plain text.
    def pi(input)
      argv = [input.agent, "--print", "--model", input.model,
              "--thinking", input.effort, "--approve"]
      plan(input, argv, "prompt.txt", "output.txt")
    end

    # Print mode with non-TTY stdio keeps claude out of its interactive UI and skips the
    # workspace trust dialog. bypassPermissions is the narrowest of the CLI's permission modes
    # that cannot block on a prompt while still letting the worker edit files and run its gates;
    # claude reads the pinned prompt file on stdin and prints its plain-text answer to output.txt.
    def claude(input)
      argv = [input.agent, "--print", "--model", input.model, "--effort", input.effort,
              "--permission-mode", "bypassPermissions"]
      plan(input, argv, "prompt.txt", "output.txt")
    end

    # kimi's -p is its only non-interactive mode, and it takes the prompt as an ARGUMENT: it
    # refuses stdin ("option '-p, --prompt <prompt>' argument missing") and refuses to combine
    # with --auto or --yolo ("Cannot combine --prompt with --yolo"). Prompt mode is already
    # non-interactive and already tool-capable - a probe run created a file and read it back,
    # exit 0, with nothing to approve - so no permission flag is needed or accepted. The model
    # kimi has no per-invocation effort flag - --help carries none and the binary declares no
    # KIMI_* effort variable - so effort is a property of the model alias in ~/.kimi-code/config.toml.
    # `kimi-code/k3-256k` there has default_effort = "high", NOT max. The lane therefore selects
    # `kimi-code/k3-256k-max`, an alias over the same upstream `k3-256k` whose only difference is
    # default_effort = "max". Selecting the plain alias would silently run a rung below what the
    # receipt claims; the effort recorded here names what that alias sets.
    #
    # The preamble is published only after Orca creates the Dispatch, so the argv built here
    # cannot carry the text. `sh -c` reads the pinned file at exec time. The script passes the
    # executable, the model and the path as positional parameters and never interpolates them,
    # so no path and no byte of the prompt can be read as shell; the private file stays the
    # byte-exact record of what the worker was asked to run.
    def kimi(input)
      prompt = File.join(input.state_dir, "prompt.txt")
      script = 'exec "$0" -m "$1" --output-format text -p "$(cat "$2")"'
      argv = ["/bin/sh", "-c", script, input.agent, input.model, prompt]
      plan(input, argv, "empty.stdin", "output.txt")
    end

    def plan(input, argv, stdin_name, stdout_name = "events.jsonl")
      ModelPlan.new(argv, File.join(input.state_dir, stdin_name),
                    File.join(input.state_dir, stdout_name),
                    File.join(input.state_dir, "stderr.log"))
    end
  end
end
